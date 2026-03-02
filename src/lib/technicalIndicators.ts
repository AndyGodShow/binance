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
            // 优先使用真实的历史数据，如果不存在则使用模拟数据
            fundingRate: current.fundingRate
                ? current.fundingRate
                : (priceChangePercentVal * 0.01).toFixed(6),

            openInterest: current.openInterest
                ? current.openInterest
                : (parseFloat(current.volume) * 500).toFixed(2),

            openInterestValue: current.openInterest
                ? (parseFloat(current.openInterest) * parseFloat(current.close)).toFixed(2) //如果有真实OI(张数/币数)，则计算价值
                : (parseFloat(current.quoteVolume) * 500).toFixed(2),

            change15m,
            change1h,
            change4h,
            atr,
            volumeMA,
            cvd,
            cvdSlope,
            // 如果有真实OI数据，计算真实的 oiChangePercent
            oiChangePercent: (current.openInterest && klines[currentIndex - 1]?.openInterest)
                ? ((parseFloat(current.openInterest) - parseFloat(klines[currentIndex - 1].openInterest!)) / parseFloat(klines[currentIndex - 1].openInterest!) * 100)
                : Math.abs(priceChangePercentVal) * (current.volume && volumeMA ? parseFloat(current.volume) / volumeMA : 1) * 20, // Fallback to simulation

            volumeChangePercent: current.volume && volumeMA ? ((parseFloat(current.volume) - volumeMA) / volumeMA) * 100 : 0,
        };

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
}
