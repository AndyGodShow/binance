import { KlineData } from '@/app/api/backtest/klines/route';
import { TickerData } from './types';
import {
    calculateBollingerBands,
    calculateKeltnerChannels,
    detectSqueeze,
    calculateMomentumHistogram,
    calculateADX,
    calculateBandwidthPercentile,
    OHLC
} from './indicators';
import { calculateVolumeProfile } from './volumeProfile';

/**
 * 从K线数据计算技术指标
 */
export class TechnicalIndicators {
    /**
     * 计算ATR (Average True Range)
     */
    static calculateATR(klines: KlineData[], period: number = 14): number {
        if (klines.length < period + 1) return 0;

        const trueRanges: number[] = [];

        for (let i = 1; i < klines.length; i++) {
            const high = parseFloat(klines[i].high);
            const low = parseFloat(klines[i].low);
            const prevClose = parseFloat(klines[i - 1].close);

            const tr = Math.max(
                high - low,
                Math.abs(high - prevClose),
                Math.abs(low - prevClose)
            );

            trueRanges.push(tr);
        }

        // 取最后period个TR的平均值
        const recentTR = trueRanges.slice(-period);
        const atr = recentTR.reduce((sum, tr) => sum + tr, 0) / period;

        // 转换为百分比
        const currentPrice = parseFloat(klines[klines.length - 1].close);
        return (atr / currentPrice) * 100;
    }

    /**
     * 计算成交量移动平均
     */
    static calculateVolumeMA(klines: KlineData[], period: number = 20): number {
        if (klines.length < period) return 0;

        const recentVolumes = klines.slice(-period);
        const sum = recentVolumes.reduce((acc, k) => acc + parseFloat(k.quoteVolume), 0);
        return sum / period;
    }

    /**
     * 计算简化的CVD (Cumulative Volume Delta)
     * 使用主动买入量 - 主动卖出量
     */
    static calculateCVD(klines: KlineData[]): { cvd: number; cvdSlope: number } {
        if (klines.length < 2) return { cvd: 0, cvdSlope: 0 };

        let cvd = 0;
        const cvdHistory: number[] = [];

        klines.forEach(k => {
            const buyVolume = parseFloat(k.takerBuyQuoteVolume);
            const totalVolume = parseFloat(k.quoteVolume);
            const sellVolume = totalVolume - buyVolume;

            cvd += (buyVolume - sellVolume);
            cvdHistory.push(cvd);
        });

        // 计算CVD斜率（最近5个点的线性回归）
        const period = Math.min(5, cvdHistory.length);
        const recentCVD = cvdHistory.slice(-period);

        let slope = 0;
        if (period >= 2) {
            const avgX = (period - 1) / 2;
            const avgY = recentCVD.reduce((sum, val) => sum + val, 0) / period;

            let numerator = 0;
            let denominator = 0;

            recentCVD.forEach((y, x) => {
                numerator += (x - avgX) * (y - avgY);
                denominator += Math.pow(x - avgX, 2);
            });

            slope = denominator !== 0 ? numerator / denominator : 0;
        }

        return {
            cvd: cvdHistory[cvdHistory.length - 1],
            cvdSlope: slope
        };
    }

    static calculateRSRS(klines: KlineData[]): Partial<TickerData> | null {
        if (klines.length < 40) {
            return null;
        }

        const highs = klines.map((kline) => parseFloat(kline.high));
        const lows = klines.map((kline) => parseFloat(kline.low));
        const closes = klines.map((kline) => parseFloat(kline.close));
        const volumes = klines.map((kline) => parseFloat(kline.volume));

        const efficiencyRatio = this.calculateEfficiencyRatio(closes, 10);
        const fastWindow = 12;
        const slowWindow = 30;
        const adaptiveWindow = Math.round(slowWindow - (slowWindow - fastWindow) * Math.pow(efficiencyRatio, 2));
        const windowSize = Math.max(fastWindow, Math.min(slowWindow, adaptiveWindow));

        if (highs.length < windowSize) {
            return null;
        }

        const betas: number[] = [];
        const r2s: number[] = [];
        const rsrsFinalValues: number[] = [];

        for (let index = windowSize; index < highs.length; index++) {
            const windowHighs = highs.slice(index - windowSize, index);
            const windowLows = lows.slice(index - windowSize, index);
            const windowVolumes = volumes.slice(index - windowSize, index);

            const tlsResult = this.getTLSData(windowLows, windowHighs);
            const wlsResult = this.getWLSData(windowLows, windowHighs, windowVolumes);

            const hybridBeta = 0.7 * wlsResult.beta + 0.3 * tlsResult.beta;
            const hybridR2 = Math.max(wlsResult.r2, tlsResult.r2);

            betas.push(hybridBeta);
            r2s.push(hybridR2);
        }

        if (betas.length === 0) {
            return null;
        }

        const currentBeta = betas[betas.length - 1];
        const currentR2 = r2s[r2s.length - 1];
        const historyWindow = 100;
        const historyBetas = betas.slice(Math.max(0, betas.length - historyWindow - 1), betas.length - 1);

        if (historyBetas.length < 10) {
            return null;
        }

        const median = this.calculateMedian(historyBetas);
        const mad = this.calculateMAD(historyBetas);
        const robustZScore = mad === 0 ? 0 : 0.6745 * (currentBeta - median) / mad;
        const correctedZScore = robustZScore * currentR2;
        const rsrsFinal = correctedZScore * currentBeta;

        for (let index = 0; index < betas.length - 1; index++) {
            const historicalZScore = mad === 0 ? 0 : 0.6745 * (betas[index] - median) / mad;
            const historicalCorrectedZScore = historicalZScore * r2s[index];
            rsrsFinalValues.push(historicalCorrectedZScore * betas[index]);
        }
        rsrsFinalValues.push(rsrsFinal);

        let rsrsROC = 0;
        let rsrsAcceleration = 0;
        if (rsrsFinalValues.length >= 3) {
            const current = rsrsFinalValues[rsrsFinalValues.length - 1];
            const prev = rsrsFinalValues[rsrsFinalValues.length - 2];
            const prevPrev = rsrsFinalValues[rsrsFinalValues.length - 3];

            rsrsROC = prev !== 0 ? ((current - prev) / Math.abs(prev)) * 100 : 0;
            const prevROC = prevPrev !== 0 ? ((prev - prevPrev) / Math.abs(prevPrev)) * 100 : 0;
            rsrsAcceleration = rsrsROC - prevROC;
        }

        const sortedRsrsFinal = [...rsrsFinalValues].sort((a, b) => a - b);
        const dynamicLongThreshold = sortedRsrsFinal[Math.floor(sortedRsrsFinal.length * 0.9)] || 0;
        const dynamicShortThreshold = sortedRsrsFinal[Math.floor(sortedRsrsFinal.length * 0.1)] || 0;

        return {
            rsrs: currentBeta,
            rsrsZScore: correctedZScore,
            rsrsFinal,
            rsrsR2: currentR2,
            rsrsDynamicLongThreshold: dynamicLongThreshold,
            rsrsDynamicShortThreshold: dynamicShortThreshold,
            rsrsROC,
            rsrsAcceleration,
            rsrsAdaptiveWindow: windowSize,
            rsrsMethod: 'VW-TLS + Median/MAD',
        };
    }

    /**
     * 将K线数组转换为带技术指标的TickerData
     */
    static enrichTickerData(
        klines: KlineData[],
        currentIndex: number,
        symbol: string,
        interval: string = '1h' // 添加interval参数
    ): TickerData {
        // 获取当前K线
        const current = klines[currentIndex];
        const currentPrice = parseFloat(current.close);

        // 根据K线周期计算多周期价格变化的回看数量
        const periodsFor15m = this.calculatePeriods(interval, '15m');
        const periodsFor1h = this.calculatePeriods(interval, '1h');
        const periodsFor4h = this.calculatePeriods(interval, '4h');

        // 计算多周期价格变化
        const change15m = this.calculatePriceChange(klines, currentIndex, periodsFor15m);
        const change1h = this.calculatePriceChange(klines, currentIndex, periodsFor1h);
        const change4h = this.calculatePriceChange(klines, currentIndex, periodsFor4h);

        // 使用足够的历史数据计算指标
        const historyForIndicators = klines.slice(Math.max(0, currentIndex - 100), currentIndex + 1);

        // 计算基础技术指标
        const atr = this.calculateATR(historyForIndicators);
        const volumeMA = this.calculateVolumeMA(historyForIndicators);
        const { cvd, cvdSlope } = this.calculateCVD(historyForIndicators);
        const rsrsMetrics = this.calculateRSRS(historyForIndicators);

        // 准备 OHLC 数据格式
        const ohlcData: OHLC[] = historyForIndicators.map(k => ({
            time: k.openTime,
            open: parseFloat(k.open),
            high: parseFloat(k.high),
            low: parseFloat(k.low),
            close: parseFloat(k.close),
            volume: parseFloat(k.volume)
        }));

        const closePrices = historyForIndicators.map(k => parseFloat(k.close));

        const priceChangePercentVal = ((currentPrice - parseFloat(current.open)) / parseFloat(current.open) * 100);
        const priceChangePercent = priceChangePercentVal.toString();
        const currentOpenInterest = typeof current.openInterest === 'string' ? parseFloat(current.openInterest) : NaN;
        const previousOpenInterest = typeof klines[currentIndex - 1]?.openInterest === 'string'
            ? parseFloat(klines[currentIndex - 1].openInterest as string)
            : NaN;
        const hasRealFundingRate = typeof current.fundingRate === 'string' && Number.isFinite(parseFloat(current.fundingRate));
        const hasRealOpenInterest = Number.isFinite(currentOpenInterest);
        const hasPreviousRealOpenInterest = Number.isFinite(previousOpenInterest) && previousOpenInterest > 0;

        // 初始化增强数据
        const enhanced: TickerData = {
            symbol,
            lastPrice: current.close,
            priceChange: '0',
            priceChangePercent,
            weightedAvgPrice: current.close,
            prevClosePrice: klines[currentIndex - 1]?.close || current.open,
            highPrice: current.high,
            lowPrice: current.low,
            volume: current.volume,
            quoteVolume: current.quoteVolume,
            openTime: current.openTime,
            closeTime: current.closeTime,
            fundingRate: hasRealFundingRate ? current.fundingRate : undefined,
            openInterest: hasRealOpenInterest ? current.openInterest : undefined,

            openInterestValue: current.openInterestValue
                ? current.openInterestValue
                : hasRealOpenInterest
                ? (currentOpenInterest * parseFloat(current.close)).toFixed(2)
                : undefined,

            change15m,
            change1h,
            change4h,
            atr,
            volumeMA,
            volumeRatio: volumeMA > 0 ? parseFloat(current.quoteVolume) / volumeMA : undefined,
            cvd,
            cvdSlope,
            oiChangePercent: hasRealOpenInterest && hasPreviousRealOpenInterest
                ? ((currentOpenInterest - previousOpenInterest) / previousOpenInterest) * 100
                : undefined,

            volumeChangePercent: current.volume && volumeMA ? ((parseFloat(current.volume) - volumeMA) / volumeMA) * 100 : 0,
        };

        if (rsrsMetrics) {
            Object.assign(enhanced, rsrsMetrics);
        }

        // 🔥 计算 Bollinger Bands
        if (closePrices.length >= 20) {
            try {
                const bb = calculateBollingerBands(closePrices, 20, 2);
                if (bb.upper.length > 0) {
                    enhanced.bollingerUpper = bb.upper[bb.upper.length - 1];
                    enhanced.bollingerMid = bb.middle[bb.middle.length - 1];
                    enhanced.bollingerLower = bb.lower[bb.lower.length - 1];
                }
            } catch (error) {
                console.error(`Bollinger Bands calculation failed for ${symbol}:`, error);
            }
        }

        // 🔥 计算 Keltner Channels
        if (ohlcData.length >= 20) {
            try {
                const kc = calculateKeltnerChannels(ohlcData, 20, 1.5);
                if (kc.upper.length > 0) {
                    enhanced.keltnerUpper = kc.upper[kc.upper.length - 1];
                    enhanced.keltnerMid = kc.middle[kc.middle.length - 1];
                    enhanced.keltnerLower = kc.lower[kc.lower.length - 1];
                }

                // 🔥 计算 Squeeze 检测（需要 Bollinger 和 Keltner）
                if (enhanced.bollingerUpper && enhanced.keltnerUpper) {
                    const bb = calculateBollingerBands(closePrices, 20, 2);
                    const squeeze = detectSqueeze(bb, kc);
                    const squeezeStates = bb.upper.map((upper, index) =>
                        upper < kc.upper[index] && bb.lower[index] > kc.lower[index]
                    );

                    enhanced.squeezeStatus = squeeze.isSqueezeOn ? 'on' : 'off';
                    enhanced.squeezeDuration = squeeze.squeezeDuration;
                    enhanced.squeezeStrength = squeeze.squeezeStrength;

                    // 计算前一个 Squeeze 状态
                    let prevSqueezeStatus: 'on' | 'off' = 'off';
                    if (bb.upper.length >= 2 && kc.upper.length >= 2) {
                        const prevIdx = bb.upper.length - 2;
                        const isPrevSqueeze = bb.upper[prevIdx] < kc.upper[prevIdx] && bb.lower[prevIdx] > kc.lower[prevIdx];
                        prevSqueezeStatus = isPrevSqueeze ? 'on' : 'off';
                    }
                    enhanced.prevSqueezeStatus = prevSqueezeStatus;

                    const latestIdx = squeezeStates.length - 1;
                    let releaseBarsAgo: number | undefined;
                    for (let index = latestIdx; index >= 1; index--) {
                        if (!squeezeStates[index] && squeezeStates[index - 1]) {
                            releaseBarsAgo = latestIdx - index;
                            break;
                        }
                    }

                    let lastSqueezeDuration = squeeze.squeezeDuration;
                    let squeezeBoxHigh: number | undefined;
                    let squeezeBoxLow: number | undefined;
                    if (releaseBarsAgo !== undefined) {
                        const releaseIndex = latestIdx - releaseBarsAgo;
                        let startIndex = releaseIndex - 1;
                        while (startIndex >= 0 && squeezeStates[startIndex]) {
                            startIndex--;
                        }
                        const squeezeStart = startIndex + 1;
                        const squeezeEnd = releaseIndex - 1;
                        lastSqueezeDuration = Math.max(0, squeezeEnd - squeezeStart + 1);

                        if (lastSqueezeDuration > 0) {
                            const alignedStart = Math.max(0, historyForIndicators.length - squeezeStates.length + squeezeStart);
                            const alignedEnd = Math.min(historyForIndicators.length - 1, historyForIndicators.length - squeezeStates.length + squeezeEnd);
                            const squeezeSlice = historyForIndicators.slice(alignedStart, alignedEnd + 1);

                            if (squeezeSlice.length > 0) {
                                squeezeBoxHigh = Math.max(...squeezeSlice.map((kline) => parseFloat(kline.high)));
                                squeezeBoxLow = Math.min(...squeezeSlice.map((kline) => parseFloat(kline.low)));
                            }
                        }
                    }

                    enhanced.releaseBarsAgo = releaseBarsAgo;
                    enhanced.lastSqueezeDuration = lastSqueezeDuration;
                    enhanced.squeezeBoxHigh = squeezeBoxHigh;
                    enhanced.squeezeBoxLow = squeezeBoxLow;

                    // 计算 Bandwidth Percentile
                    if (bb.bandwidth.length > 0) {
                        const currentBandwidth = bb.bandwidth[bb.bandwidth.length - 1];
                        enhanced.bandwidthPercentile = calculateBandwidthPercentile(
                            currentBandwidth,
                            bb.bandwidth
                        );
                    }
                }

                // 🔥 计算 Momentum Histogram
                if (kc.middle.length > 0) {
                    const momentum = calculateMomentumHistogram(closePrices, kc.middle);
                    if (momentum.momentum.length > 0) {
                        enhanced.momentumValue = momentum.momentum[momentum.momentum.length - 1];
                        enhanced.momentumColor = momentum.color[momentum.color.length - 1];
                    }
                }
            } catch (error) {
                console.error(`Keltner/Squeeze calculation failed for ${symbol}:`, error);
            }
        }

        // 🔥 计算 ADX
        if (ohlcData.length >= 30) {
            try {
                const adxData = calculateADX(ohlcData, 14);
                if (adxData.adx.length > 0) {
                    enhanced.adx = adxData.adx[adxData.adx.length - 1];
                    enhanced.plusDI = adxData.plusDI[adxData.plusDI.length - 1];
                    enhanced.minusDI = adxData.minusDI[adxData.minusDI.length - 1];
                }
            } catch (error) {
                console.error(`ADX calculation failed for ${symbol}:`, error);
            }
        }

        // 🔥 计算 Volume Profile
        if (ohlcData.length >= 30) {
            try {
                const vp = calculateVolumeProfile(ohlcData, 30, symbol);
                enhanced.vah = vp.vah;
                enhanced.val = vp.val;
                enhanced.poc = vp.poc;
            } catch (error) {
                console.error(`Volume Profile calculation failed for ${symbol}:`, error);
            }
        }

        // 🔥 添加 OHLC 数据（策略可能需要）
        enhanced.ohlc = ohlcData.slice(-20); // 保留最近 20 根

        return enhanced;
    }

    /**
     * 计算需要回看的K线数量
     * @param currentInterval 当前K线周期（如 1h, 4h, 15m）
     * @param targetInterval 目标时间范围（如 15m, 1h, 4h）
     * @returns 需要回看的K线数量
     */
    private static calculatePeriods(currentInterval: string, targetInterval: string): number {
        const intervalMinutes: Record<string, number> = {
            '1m': 1,
            '5m': 5,
            '15m': 15,
            '30m': 30,
            '1h': 60,
            '4h': 240,
            '1d': 1440,
        };

        const currentMinutes = intervalMinutes[currentInterval] || 60;
        const targetMinutes = intervalMinutes[targetInterval] || 60;

        // 计算需要回看几根K线
        return Math.ceil(targetMinutes / currentMinutes);
    }

    /**
     * 计算价格变化百分比
     * @param klines K线数组
     * @param currentIndex 当前索引
     * @param periodsBack 回看的K线数量
     */
    private static calculatePriceChange(
        klines: KlineData[],
        currentIndex: number,
        periodsBack: number
    ): number {
        if (currentIndex < periodsBack) return 0;

        const current = parseFloat(klines[currentIndex].close);
        const past = parseFloat(klines[currentIndex - periodsBack].close);

        return ((current - past) / past) * 100;
    }

    private static getTLSData(xValues: number[], yValues: number[]): { beta: number; r2: number } {
        const n = xValues.length;
        if (n === 0) return { beta: 0, r2: 0 };

        const xMean = xValues.reduce((a, b) => a + b, 0) / n;
        const yMean = yValues.reduce((a, b) => a + b, 0) / n;
        const xCentered = xValues.map((x) => x - xMean);
        const yCentered = yValues.map((y) => y - yMean);

        let sxx = 0;
        let syy = 0;
        let sxy = 0;

        for (let index = 0; index < n; index++) {
            sxx += xCentered[index] * xCentered[index];
            syy += yCentered[index] * yCentered[index];
            sxy += xCentered[index] * yCentered[index];
        }

        const delta = syy - sxx;
        const discriminant = delta * delta + 4 * sxy * sxy;
        const beta = sxy === 0 ? 0 : (delta + Math.sqrt(discriminant)) / (2 * sxy);
        const alpha = yMean - beta * xMean;

        let ssTotal = 0;
        let ssResidual = 0;
        for (let index = 0; index < n; index++) {
            const predicted = alpha + beta * xValues[index];
            ssResidual += Math.pow(yValues[index] - predicted, 2);
            ssTotal += Math.pow(yValues[index] - yMean, 2);
        }

        return {
            beta,
            r2: ssTotal === 0 ? 0 : Math.max(0, 1 - (ssResidual / ssTotal)),
        };
    }

    private static getWLSData(xValues: number[], yValues: number[], weights: number[]): { beta: number; r2: number } {
        const n = xValues.length;
        if (n === 0 || weights.length !== n) return { beta: 0, r2: 0 };

        const totalWeight = weights.reduce((a, b) => a + b, 0);
        if (totalWeight === 0) return { beta: 0, r2: 0 };
        const normalizedWeights = weights.map((weight) => weight / totalWeight);

        const xMean = xValues.reduce((sum, value, index) => sum + value * normalizedWeights[index], 0);
        const yMean = yValues.reduce((sum, value, index) => sum + value * normalizedWeights[index], 0);

        let numerator = 0;
        let denominator = 0;
        let ssTotal = 0;
        let ssResidual = 0;

        for (let index = 0; index < n; index++) {
            const weight = normalizedWeights[index];
            numerator += weight * (xValues[index] - xMean) * (yValues[index] - yMean);
            denominator += weight * Math.pow(xValues[index] - xMean, 2);
            ssTotal += weight * Math.pow(yValues[index] - yMean, 2);
        }

        const beta = denominator === 0 ? 0 : numerator / denominator;
        const alpha = yMean - beta * xMean;

        for (let index = 0; index < n; index++) {
            const predicted = alpha + beta * xValues[index];
            ssResidual += normalizedWeights[index] * Math.pow(yValues[index] - predicted, 2);
        }

        return {
            beta,
            r2: ssTotal === 0 ? 0 : Math.max(0, 1 - (ssResidual / ssTotal)),
        };
    }

    private static calculateMedian(values: number[]): number {
        if (values.length === 0) return 0;
        const sorted = [...values].sort((a, b) => a - b);
        const mid = Math.floor(sorted.length / 2);
        return sorted.length % 2 === 0
            ? (sorted[mid - 1] + sorted[mid]) / 2
            : sorted[mid];
    }

    private static calculateMAD(values: number[]): number {
        if (values.length === 0) return 0;
        const median = this.calculateMedian(values);
        const deviations = values.map((value) => Math.abs(value - median));
        return this.calculateMedian(deviations);
    }

    private static calculateEfficiencyRatio(closes: number[], period: number = 10): number {
        if (closes.length < period + 1) return 0.5;

        const recent = closes.slice(-period - 1);
        const direction = Math.abs(recent[recent.length - 1] - recent[0]);
        let volatility = 0;

        for (let index = 1; index < recent.length; index++) {
            volatility += Math.abs(recent[index] - recent[index - 1]);
        }

        return volatility === 0 ? 1 : direction / volatility;
    }
}
