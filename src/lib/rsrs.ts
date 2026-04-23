export interface RsrsCandleInput {
    high: number;
    low: number;
    close: number;
    volume: number;
}

export interface RsrsMetrics {
    beta: number;
    zScore: number;
    r2: number;
    rsrsFinal: number;
    dynamicLongThreshold: number;
    dynamicShortThreshold: number;
    bollingerUpper: number;
    bollingerMid: number;
    bollingerLower: number;
    volumeMA: number;
    rsrsROC: number;
    rsrsAcceleration: number;
    adaptiveWindow: number;
    method: string;
}

interface CalculateRsrsOptions {
    fallbackOnInsufficientHistory?: boolean;
}

const EFFICIENCY_LOOKBACK = 10;
const FAST_WINDOW = 12;
const SLOW_WINDOW = 30;
const STANDARDIZATION_WINDOW = 100;
const MIN_HISTORY_SAMPLE = 10;
const BOLLINGER_WINDOW = 20;
const BOLLINGER_STD_DEV_MULTIPLIER = 2;
const VOLUME_MA_WINDOW = 20;

export function calculateRsrsMetrics(
    candles: RsrsCandleInput[],
    options: CalculateRsrsOptions = {},
): RsrsMetrics | null {
    if (candles.length < 40) {
        return null;
    }

    const highs = candles.map((candle) => candle.high);
    const lows = candles.map((candle) => candle.low);
    const closes = candles.map((candle) => candle.close);
    const volumes = candles.map((candle) => candle.volume);

    const efficiencyRatio = calculateEfficiencyRatio(closes, EFFICIENCY_LOOKBACK);
    const adaptiveWindow = Math.round(SLOW_WINDOW - (SLOW_WINDOW - FAST_WINDOW) * Math.pow(efficiencyRatio, 2));
    const windowSize = Math.max(FAST_WINDOW, Math.min(SLOW_WINDOW, adaptiveWindow));

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

        const tlsResult = getTLSData(windowLows, windowHighs);
        const wlsResult = getWLSData(windowLows, windowHighs, windowVolumes);

        betas.push(0.7 * wlsResult.beta + 0.3 * tlsResult.beta);
        r2s.push(Math.max(wlsResult.r2, tlsResult.r2));
    }

    if (betas.length === 0) {
        return null;
    }

    const currentBeta = betas[betas.length - 1];
    const currentR2 = r2s[r2s.length - 1];
    const historyBetas = betas.slice(
        Math.max(0, betas.length - STANDARDIZATION_WINDOW - 1),
        betas.length - 1,
    );

    if (historyBetas.length < MIN_HISTORY_SAMPLE) {
        return options.fallbackOnInsufficientHistory
            ? buildFallbackMetrics({
                currentBeta,
                currentR2,
                closes,
                volumes,
                adaptiveWindow: windowSize,
            })
            : null;
    }

    const median = calculateMedian(historyBetas);
    const mad = calculateMAD(historyBetas);
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
    const { upper, middle, lower } = calculateSimpleBollingerBands(closes, BOLLINGER_WINDOW);

    return {
        beta: currentBeta,
        zScore: correctedZScore,
        r2: currentR2,
        rsrsFinal,
        dynamicLongThreshold,
        dynamicShortThreshold,
        bollingerUpper: upper,
        bollingerMid: middle,
        bollingerLower: lower,
        volumeMA: calculateVolumeMA(volumes, VOLUME_MA_WINDOW),
        rsrsROC,
        rsrsAcceleration,
        adaptiveWindow: windowSize,
        method: 'VW-TLS + Median/MAD',
    };
}

function buildFallbackMetrics(input: {
    currentBeta: number;
    currentR2: number;
    closes: number[];
    volumes: number[];
    adaptiveWindow: number;
}): RsrsMetrics {
    const lastClose = input.closes[input.closes.length - 1];
    const { upper, middle, lower } = calculateSimpleBollingerBands(input.closes, BOLLINGER_WINDOW);

    return {
        beta: input.currentBeta,
        zScore: 0,
        r2: input.currentR2,
        rsrsFinal: 0,
        dynamicLongThreshold: 0,
        dynamicShortThreshold: 0,
        bollingerUpper: Number.isFinite(upper) ? upper : lastClose,
        bollingerMid: Number.isFinite(middle) ? middle : lastClose,
        bollingerLower: Number.isFinite(lower) ? lower : lastClose,
        volumeMA: calculateVolumeMA(input.volumes, VOLUME_MA_WINDOW),
        rsrsROC: 0,
        rsrsAcceleration: 0,
        adaptiveWindow: input.adaptiveWindow,
        method: 'VW-TLS (insufficient data)',
    };
}

function calculateSimpleBollingerBands(closes: number[], window: number): { upper: number; middle: number; lower: number } {
    const recentCloses = closes.slice(-window);
    const mean = recentCloses.reduce((sum, close) => sum + close, 0) / recentCloses.length;
    const stdDev = Math.sqrt(
        recentCloses.reduce((sum, close) => sum + Math.pow(close - mean, 2), 0) / recentCloses.length,
    );

    return {
        upper: mean + BOLLINGER_STD_DEV_MULTIPLIER * stdDev,
        middle: mean,
        lower: mean - BOLLINGER_STD_DEV_MULTIPLIER * stdDev,
    };
}

function calculateVolumeMA(volumes: number[], window: number): number {
    const recentVolumes = volumes.slice(-window);
    return recentVolumes.reduce((sum, volume) => sum + volume, 0) / recentVolumes.length;
}

function getTLSData(xValues: number[], yValues: number[]): { beta: number; r2: number } {
    const n = xValues.length;
    if (n === 0) {
        return { beta: 0, r2: 0 };
    }

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

    const r2 = ssTotal === 0 ? 0 : 1 - (ssResidual / ssTotal);
    return { beta, r2: Math.max(0, r2) };
}

function getWLSData(xValues: number[], yValues: number[], weights: number[]): { beta: number; r2: number } {
    const n = xValues.length;
    if (n === 0 || weights.length !== n) {
        return { beta: 0, r2: 0 };
    }

    const totalWeight = weights.reduce((a, b) => a + b, 0);
    if (totalWeight === 0) {
        return { beta: 0, r2: 0 };
    }

    const normalizedWeights = weights.map((weight) => weight / totalWeight);
    const xMean = xValues.reduce((sum, x, index) => sum + x * normalizedWeights[index], 0);
    const yMean = yValues.reduce((sum, y, index) => sum + y * normalizedWeights[index], 0);

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

    const r2 = ssTotal === 0 ? 0 : 1 - (ssResidual / ssTotal);
    return { beta, r2: Math.max(0, r2) };
}

function calculateMedian(values: number[]): number {
    if (values.length === 0) {
        return 0;
    }

    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0
        ? (sorted[mid - 1] + sorted[mid]) / 2
        : sorted[mid];
}

function calculateMAD(values: number[]): number {
    if (values.length === 0) {
        return 0;
    }

    const median = calculateMedian(values);
    const deviations = values.map((value) => Math.abs(value - median));
    return calculateMedian(deviations);
}

function calculateEfficiencyRatio(closes: number[], period: number): number {
    if (closes.length < period + 1) {
        return 0.5;
    }

    const recent = closes.slice(-period - 1);
    const direction = Math.abs(recent[recent.length - 1] - recent[0]);

    let volatility = 0;
    for (let index = 1; index < recent.length; index++) {
        volatility += Math.abs(recent[index] - recent[index - 1]);
    }

    return volatility === 0 ? 1 : direction / volatility;
}
