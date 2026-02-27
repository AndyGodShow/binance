/**
 * 高级技术指标计算模块
 * 包含 ATR、Rolling Std、Beta、Hurst 等机构级量化指标
 */

export interface OHLC {
    time: number;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
}

/**
 * 计算 ATR (Average True Range) - 平均真实波幅
 * 用于测量市场波动率，替代固定阈值
 * 
 * @param candles OHLC 数据数组
 * @param period 计算周期，默认 14
 * @returns ATR 值数组
 */
export function calculateATR(candles: OHLC[], period: number = 14): number[] {
    if (candles.length < period + 1) {
        return [];
    }

    const trueRanges: number[] = [];

    // 计算 True Range
    for (let i = 1; i < candles.length; i++) {
        const high = candles[i].high;
        const low = candles[i].low;
        const prevClose = candles[i - 1].close;

        const tr = Math.max(
            high - low,                    // 当前最高 - 最低
            Math.abs(high - prevClose),    // 当前最高 - 前收盘
            Math.abs(low - prevClose)      // 当前最低 - 前收盘
        );

        trueRanges.push(tr);
    }

    // 计算移动平均（Wilder's Smoothing）
    const atrValues: number[] = [];

    // 第一个 ATR 是简单平均
    let atr = trueRanges.slice(0, period).reduce((a, b) => a + b, 0) / period;
    atrValues.push(atr);

    // 后续使用 Wilder's Smoothing
    for (let i = period; i < trueRanges.length; i++) {
        atr = (atr * (period - 1) + trueRanges[i]) / period;
        atrValues.push(atr);
    }

    return atrValues;
}

/**
 * 获取最新的 ATR 值
 */
export function getLatestATR(candles: OHLC[], period: number = 14): number | null {
    const atrValues = calculateATR(candles, period);
    return atrValues.length > 0 ? atrValues[atrValues.length - 1] : null;
}

/**
 * 计算滚动标准差 (Rolling Standard Deviation)
 * 用于测量价格波动的统计分布
 * 
 * @param values 价格或收益率数组
 * @param window 滚动窗口大小
 * @returns 标准差数组
 */
export function calculateRollingStd(values: number[], window: number): number[] {
    if (values.length < window) {
        return [];
    }

    const stdValues: number[] = [];

    for (let i = window - 1; i < values.length; i++) {
        const subset = values.slice(i - window + 1, i + 1);
        const mean = subset.reduce((a, b) => a + b, 0) / window;

        const variance = subset.reduce((sum, val) => {
            return sum + Math.pow(val - mean, 2);
        }, 0) / window;

        stdValues.push(Math.sqrt(variance));
    }

    return stdValues;
}

/**
 * 计算 Beta 系数 - 相对于 BTC 的相关性
 * Beta > 1: 比 BTC 波动更大
 * Beta < 1: 比 BTC 波动更小
 * Beta ≈ 1: 跟随 BTC
 * 
 * @param assetReturns 标的资产收益率数组
 * @param btcReturns BTC 收益率数组
 * @returns Beta 系数
 */
export function calculateBeta(assetReturns: number[], btcReturns: number[]): number {
    const n = Math.min(assetReturns.length, btcReturns.length);

    if (n < 2) {
        return 1.0; // 默认值
    }

    // 计算均值
    const assetMean = assetReturns.slice(0, n).reduce((a, b) => a + b, 0) / n;
    const btcMean = btcReturns.slice(0, n).reduce((a, b) => a + b, 0) / n;

    // 计算协方差和方差
    let covariance = 0;
    let btcVariance = 0;

    for (let i = 0; i < n; i++) {
        const assetDiff = assetReturns[i] - assetMean;
        const btcDiff = btcReturns[i] - btcMean;

        covariance += assetDiff * btcDiff;
        btcVariance += btcDiff * btcDiff;
    }

    covariance /= n;
    btcVariance /= n;

    // Beta = Cov(asset, btc) / Var(btc)
    return btcVariance !== 0 ? covariance / btcVariance : 1.0;
}

/**
 * 计算相关系数 (Correlation)
 */
export function calculateCorrelation(x: number[], y: number[]): number {
    const n = Math.min(x.length, y.length);

    if (n < 2) {
        return 0;
    }

    const xMean = x.slice(0, n).reduce((a, b) => a + b, 0) / n;
    const yMean = y.slice(0, n).reduce((a, b) => a + b, 0) / n;

    let numerator = 0;
    let xVariance = 0;
    let yVariance = 0;

    for (let i = 0; i < n; i++) {
        const xDiff = x[i] - xMean;
        const yDiff = y[i] - yMean;

        numerator += xDiff * yDiff;
        xVariance += xDiff * xDiff;
        yVariance += yDiff * yDiff;
    }

    const denominator = Math.sqrt(xVariance * yVariance);

    return denominator !== 0 ? numerator / denominator : 0;
}

/**
 * 计算 Hurst 指数 - 趋势强度测量
 * H > 0.5: 趋势性（持续性）
 * H = 0.5: 随机游走
 * H < 0.5: 均值回归
 * 
 * @param prices 价格序列
 * @param maxLag 最大滞后期
 * @returns Hurst 指数
 */
export function calculateHurst(prices: number[], maxLag: number = 20): number {
    const n = prices.length;

    if (n < maxLag * 2) {
        return 0.5; // 默认值：随机游走
    }

    const lags: number[] = [];
    const rsByLag: number[] = [];

    // 对不同的时间跨度计算 R/S
    for (let lag = 2; lag <= maxLag; lag++) {
        const chunks = Math.floor(n / lag);
        const rsValues: number[] = [];

        for (let i = 0; i < chunks; i++) {
            const subset = prices.slice(i * lag, (i + 1) * lag);

            // 计算对数收益率
            const returns = subset.slice(1).map((p, idx) =>
                Math.log(p / subset[idx])
            );

            if (returns.length === 0) continue;

            const mean = returns.reduce((a, b) => a + b, 0) / returns.length;

            // 计算累计偏差
            let cumulativeDeviation = 0;
            const deviations: number[] = [];

            for (const ret of returns) {
                cumulativeDeviation += ret - mean;
                deviations.push(cumulativeDeviation);
            }

            const range = Math.max(...deviations) - Math.min(...deviations);

            // 计算标准差
            const variance = returns.reduce((sum, ret) =>
                sum + Math.pow(ret - mean, 2), 0
            ) / returns.length;

            const std = Math.sqrt(variance);

            if (std !== 0 && range !== 0) {
                rsValues.push(range / std);
            }
        }

        if (rsValues.length > 0) {
            const avgRS = rsValues.reduce((a, b) => a + b, 0) / rsValues.length;
            lags.push(Math.log(lag));
            rsByLag.push(Math.log(avgRS));
        }
    }

    // 线性回归求斜率（即 Hurst 指数）
    if (lags.length < 2) {
        return 0.5;
    }

    const n_lags = lags.length;
    const lagMean = lags.reduce((a, b) => a + b, 0) / n_lags;
    const rsMean = rsByLag.reduce((a, b) => a + b, 0) / n_lags;

    let numerator = 0;
    let denominator = 0;

    for (let i = 0; i < n_lags; i++) {
        numerator += (lags[i] - lagMean) * (rsByLag[i] - rsMean);
        denominator += Math.pow(lags[i] - lagMean, 2);
    }

    const hurst = denominator !== 0 ? numerator / denominator : 0.5;

    // 限制范围在 [0, 1]
    return Math.max(0, Math.min(1, hurst));
}

/**
 * 计算价格收益率序列
 */
export function calculateReturns(prices: number[]): number[] {
    const returns: number[] = [];

    for (let i = 1; i < prices.length; i++) {
        returns.push((prices[i] - prices[i - 1]) / prices[i - 1]);
    }

    return returns;
}

/**
 * 将 K线数据转换为收盘价数组
 */
export function extractClosePrices(candles: OHLC[]): number[] {
    return candles.map(c => c.close);
}

// ========== 🔥 Volatility Squeeze 相关指标 ==========

export interface BollingerBands {
    upper: number[];
    middle: number[];
    lower: number[];
    bandwidth: number[]; // (upper - lower) / middle
}

export interface KeltnerChannels {
    upper: number[];
    middle: number[];
    lower: number[];
}

export interface SqueezeData {
    isSqueezeOn: boolean;
    squeezeStrength: number; // 0-1, BB收缩程度
    squeezeDuration: number; // 已持续的K线数
}

export interface MomentumData {
    momentum: number[];
    color: ('cyan' | 'blue' | 'red' | 'yellow')[];
}

/**
 * 计算布林带 (Bollinger Bands)
 * 
 * @param prices 价格数组
 * @param period 周期，默认 20
 * @param stdDevMultiplier 标准差倍数，默认 2
 * @returns 布林带数据
 */
export function calculateBollingerBands(
    prices: number[],
    period: number = 20,
    stdDevMultiplier: number = 2
): BollingerBands {
    const upper: number[] = [];
    const middle: number[] = [];
    const lower: number[] = [];
    const bandwidth: number[] = [];

    if (prices.length < period) {
        return { upper, middle, lower, bandwidth };
    }

    for (let i = period - 1; i < prices.length; i++) {
        const subset = prices.slice(i - period + 1, i + 1);
        const sma = subset.reduce((a, b) => a + b, 0) / period;

        // 计算标准差
        const variance = subset.reduce((sum, val) =>
            sum + Math.pow(val - sma, 2), 0
        ) / period;
        const stdDev = Math.sqrt(variance);

        const upperBand = sma + stdDevMultiplier * stdDev;
        const lowerBand = sma - stdDevMultiplier * stdDev;

        upper.push(upperBand);
        middle.push(sma);
        lower.push(lowerBand);
        bandwidth.push(sma > 0 ? (upperBand - lowerBand) / sma : 0);
    }

    return { upper, middle, lower, bandwidth };
}

/**
 * 计算肯特纳通道 (Keltner Channels)
 * 
 * @param candles OHLC 数据
 * @param period 周期，默认 20
 * @param atrMultiplier ATR 倍数，默认 1.5
 * @returns 肯特纳通道数据
 */
export function calculateKeltnerChannels(
    candles: OHLC[],
    period: number = 20,
    atrMultiplier: number = 1.5
): KeltnerChannels {
    const upper: number[] = [];
    const middle: number[] = [];
    const lower: number[] = [];

    if (candles.length < period + 1) {
        return { upper, middle, lower };
    }

    // 计算 ATR
    const atrValues = calculateATR(candles, period);

    // 计算中轨 (EMA)
    const closes = candles.map(c => c.close);
    const emaValues: number[] = [];

    // 简单移动平均作为第一个 EMA
    let ema = closes.slice(0, period).reduce((a, b) => a + b, 0) / period;
    emaValues.push(ema);

    // 计算 EMA
    const multiplier = 2 / (period + 1);
    for (let i = period; i < closes.length; i++) {
        ema = (closes[i] - ema) * multiplier + ema;
        emaValues.push(ema);
    }

    // 计算上下轨
    const startIndex = period - 1;
    for (let i = 0; i < emaValues.length; i++) {
        const atr = atrValues[i] || 0;
        middle.push(emaValues[i]);
        upper.push(emaValues[i] + atrMultiplier * atr);
        lower.push(emaValues[i] - atrMultiplier * atr);
    }

    return { upper, middle, lower };
}

/**
 * 检测 Squeeze 状态
 * 
 * @param bb 布林带数据
 * @param kc 肯特纳通道数据
 * @returns Squeeze 检测结果
 */
export function detectSqueeze(bb: BollingerBands, kc: KeltnerChannels): SqueezeData {
    const length = Math.min(bb.upper.length, kc.upper.length);

    if (length === 0) {
        return { isSqueezeOn: false, squeezeStrength: 0, squeezeDuration: 0 };
    }

    // 检查最新的 Squeeze 状态
    const latestIdx = length - 1;
    const bbUpper = bb.upper[latestIdx];
    const bbLower = bb.lower[latestIdx];
    const kcUpper = kc.upper[latestIdx];
    const kcLower = kc.lower[latestIdx];

    // Squeeze On: BB 在 KC 内部
    const isSqueezeOn = bbUpper < kcUpper && bbLower > kcLower;

    // 计算挤压强度 (0-1)
    const bbWidth = bbUpper - bbLower;
    const kcWidth = kcUpper - kcLower;
    const squeezeStrength = kcWidth > 0 ? Math.min(1, bbWidth / kcWidth) : 0;

    // 计算持续时间（向前查找）
    let squeezeDuration = 0;
    if (isSqueezeOn) {
        for (let i = latestIdx; i >= 0; i--) {
            const wasSqueezeOn = bb.upper[i] < kc.upper[i] && bb.lower[i] > kc.lower[i];
            if (wasSqueezeOn) {
                squeezeDuration++;
            } else {
                break;
            }
        }
    }

    return { isSqueezeOn, squeezeStrength, squeezeDuration };
}

/**
 * 计算简化版动能柱 (Momentum Histogram)
 * 使用价格相对于 KC 中轨的偏离度
 * 
 * @param prices 价格数组
 * @param kcMid KC 中轨数组
 * @returns 动能数据
 */
export function calculateMomentumHistogram(
    prices: number[],
    kcMid: number[]
): MomentumData {
    const momentum: number[] = [];
    const color: ('cyan' | 'blue' | 'red' | 'yellow')[] = [];

    const length = Math.min(prices.length, kcMid.length);

    for (let i = 0; i < length; i++) {
        const mom = prices[i] - kcMid[i];
        momentum.push(mom);

        // 确定颜色（需要至少2个值来判断趋势）
        if (i === 0) {
            color.push(mom > 0 ? 'cyan' : 'red');
        } else {
            const prevMom = momentum[i - 1];
            if (mom > 0) {
                color.push(mom > prevMom ? 'cyan' : 'blue');
            } else {
                color.push(mom < prevMom ? 'red' : 'yellow');
            }
        }
    }

    return { momentum, color };
}

/**
 * 计算 ADX (Average Directional Index)
 * 
 * @param candles OHLC 数据
 * @param period 周期，默认 14
 * @returns ADX 数据
 */
export function calculateADX(
    candles: OHLC[],
    period: number = 14
): { adx: number[]; plusDI: number[]; minusDI: number[] } {
    const adx: number[] = [];
    const plusDI: number[] = [];
    const minusDI: number[] = [];

    if (candles.length < period + 1) {
        return { adx, plusDI, minusDI };
    }

    // 计算 +DM, -DM, TR
    const plusDM: number[] = [];
    const minusDM: number[] = [];
    const tr: number[] = [];

    for (let i = 1; i < candles.length; i++) {
        const high = candles[i].high;
        const low = candles[i].low;
        const prevHigh = candles[i - 1].high;
        const prevLow = candles[i - 1].low;
        const prevClose = candles[i - 1].close;

        const upMove = high - prevHigh;
        const downMove = prevLow - low;

        plusDM.push(upMove > downMove && upMove > 0 ? upMove : 0);
        minusDM.push(downMove > upMove && downMove > 0 ? downMove : 0);

        const trueRange = Math.max(
            high - low,
            Math.abs(high - prevClose),
            Math.abs(low - prevClose)
        );
        tr.push(trueRange);
    }

    // 平滑 +DM, -DM, TR (Wilder's smoothing)
    const smoothPlusDM: number[] = [];
    const smoothMinusDM: number[] = [];
    const smoothTR: number[] = [];

    let sumPlusDM = plusDM.slice(0, period).reduce((a, b) => a + b, 0);
    let sumMinusDM = minusDM.slice(0, period).reduce((a, b) => a + b, 0);
    let sumTR = tr.slice(0, period).reduce((a, b) => a + b, 0);

    smoothPlusDM.push(sumPlusDM);
    smoothMinusDM.push(sumMinusDM);
    smoothTR.push(sumTR);

    for (let i = period; i < plusDM.length; i++) {
        sumPlusDM = sumPlusDM - sumPlusDM / period + plusDM[i];
        sumMinusDM = sumMinusDM - sumMinusDM / period + minusDM[i];
        sumTR = sumTR - sumTR / period + tr[i];

        smoothPlusDM.push(sumPlusDM);
        smoothMinusDM.push(sumMinusDM);
        smoothTR.push(sumTR);
    }

    // 计算 +DI, -DI
    for (let i = 0; i < smoothTR.length; i++) {
        plusDI.push(smoothTR[i] > 0 ? (smoothPlusDM[i] / smoothTR[i]) * 100 : 0);
        minusDI.push(smoothTR[i] > 0 ? (smoothMinusDM[i] / smoothTR[i]) * 100 : 0);
    }

    // 计算 DX 和 ADX
    const dx: number[] = [];
    for (let i = 0; i < plusDI.length; i++) {
        const sum = plusDI[i] + minusDI[i];
        const diff = Math.abs(plusDI[i] - minusDI[i]);
        dx.push(sum > 0 ? (diff / sum) * 100 : 0);
    }

    // ADX 是 DX 的移动平均
    if (dx.length >= period) {
        let adxValue = dx.slice(0, period).reduce((a, b) => a + b, 0) / period;
        adx.push(adxValue);

        for (let i = period; i < dx.length; i++) {
            adxValue = (adxValue * (period - 1) + dx[i]) / period;
            adx.push(adxValue);
        }
    }

    return { adx, plusDI, minusDI };
}

/**
 * 计算带宽百分位
 * 
 * @param bandwidth 当前带宽值
 * @param bandwidthHistory 历史带宽数组
 * @returns 百分位 (0-100)
 */
export function calculateBandwidthPercentile(
    bandwidth: number,
    bandwidthHistory: number[]
): number {
    if (bandwidthHistory.length === 0) {
        return 50;
    }

    const sorted = [...bandwidthHistory].sort((a, b) => a - b);
    const rank = sorted.filter(b => b < bandwidth).length;

    return (rank / sorted.length) * 100;
}
