import { calculateADX, calculateATR, calculateEMA } from './indicators.ts';
import type { OHLC } from './types.ts';
import type { WeiShenDirectionalCandidate, WeiShenSignalGrade } from './weiShenTypes.ts';

type Direction = 'long' | 'short';

export function getLastValue(values: number[]): number | null {
    if (values.length === 0) {
        return null;
    }

    const lastValue = values[values.length - 1];
    return Number.isFinite(lastValue) ? lastValue : null;
}

export function getBar(klines: OHLC[], offsetFromEnd = 0): OHLC | null {
    const index = klines.length - 1 - offsetFromEnd;
    if (index < 0 || index >= klines.length) {
        return null;
    }

    return klines[index] ?? null;
}

export function average(values: number[]): number {
    if (values.length === 0) {
        return 0;
    }

    return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function clamp(value: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, value));
}

export function round(value: number, digits = 4): number {
    if (!Number.isFinite(value)) {
        return 0;
    }

    const factor = Math.pow(10, digits);
    return Math.round(value * factor) / factor;
}

export function gradeWeight(grade: WeiShenSignalGrade): number {
    switch (grade) {
        case 'A':
            return 3;
        case 'B':
            return 2;
        default:
            return 1;
    }
}

export function lastClose(klines: OHLC[]): number {
    return getBar(klines)?.close ?? 0;
}

export function closes(klines: OHLC[]): number[] {
    return klines.map((kline) => kline.close).filter(Number.isFinite);
}

export function quoteVolumes(klines: OHLC[]): number[] {
    return klines
        .map((kline) => kline.quoteVolume ?? (kline.close * kline.volume))
        .filter(Number.isFinite);
}

export function latestEma(klines: OHLC[], period: number): number | null {
    const series = calculateEMA(closes(klines), period);
    return getLastValue(series);
}

export function emaLookbackSlopePct(klines: OHLC[], period: number, lookback: number): number {
    const series = calculateEMA(closes(klines), period);
    if (series.length <= lookback) {
        return 0;
    }

    const current = series[series.length - 1];
    const previous = series[series.length - 1 - lookback];
    if (!Number.isFinite(current) || !Number.isFinite(previous) || previous === 0) {
        return 0;
    }

    return ((current - previous) / previous) * 100;
}

export function percentageChangeByBars(klines: OHLC[], lookback: number): number {
    if (klines.length <= lookback) {
        return 0;
    }

    const current = lastClose(klines);
    const previous = klines[klines.length - 1 - lookback]?.close ?? 0;
    if (!Number.isFinite(current) || !Number.isFinite(previous) || previous === 0) {
        return 0;
    }

    return ((current - previous) / previous) * 100;
}

export function donchianHigh(klines: OHLC[], lookback: number): number {
    const window = klines.slice(Math.max(0, klines.length - 1 - lookback), Math.max(0, klines.length - 1));
    if (window.length === 0) {
        return 0;
    }

    return Math.max(...window.map((kline) => kline.high));
}

export function donchianLow(klines: OHLC[], lookback: number): number {
    const window = klines.slice(Math.max(0, klines.length - 1 - lookback), Math.max(0, klines.length - 1));
    if (window.length === 0) {
        return 0;
    }

    return Math.min(...window.map((kline) => kline.low));
}

export function averagePriorVolumeRatio(klines: OHLC[], lookback: number): number {
    const volumeSeries = quoteVolumes(klines);
    if (volumeSeries.length < 2) {
        return 0;
    }

    const current = volumeSeries[volumeSeries.length - 1];
    const history = volumeSeries.slice(Math.max(0, volumeSeries.length - 1 - lookback), volumeSeries.length - 1);
    const volumeAverage = average(history);
    if (!Number.isFinite(current) || !Number.isFinite(volumeAverage) || volumeAverage <= 0) {
        return 0;
    }

    return current / volumeAverage;
}

export function sumVolume(klines: OHLC[], barCount: number): number {
    return quoteVolumes(klines)
        .slice(Math.max(0, klines.length - barCount))
        .reduce((sum, value) => sum + value, 0);
}

export function latestAtr(klines: OHLC[], period: number): number {
    const atrSeries = calculateATR(klines, period);
    return getLastValue(atrSeries) ?? 0;
}

export function atrExpansionRatio(klines: OHLC[], period: number): number {
    const atrSeries = calculateATR(klines, period);
    if (atrSeries.length < 4) {
        return 0;
    }

    const current = atrSeries[atrSeries.length - 1];
    const baseline = average(atrSeries.slice(Math.max(0, atrSeries.length - 6), atrSeries.length - 1));
    if (!Number.isFinite(current) || !Number.isFinite(baseline) || baseline <= 0) {
        return 0;
    }

    return current / baseline;
}

export function getAdx(klines: OHLC[]): { adx: number; plusDI: number; minusDI: number } {
    const computed = calculateADX(klines, 14);
    return {
        adx: getLastValue(computed.adx) ?? 0,
        plusDI: getLastValue(computed.plusDI) ?? 0,
        minusDI: getLastValue(computed.minusDI) ?? 0,
    };
}

export function directionalTrendReady(
    klines: OHLC[],
    direction: Direction,
    fastPeriod: number,
    midPeriod: number,
): { ready: boolean; emaFast: number; emaMid: number; currentPrice: number } {
    const emaFast = latestEma(klines, fastPeriod) ?? 0;
    const emaMid = latestEma(klines, midPeriod) ?? 0;
    const currentPrice = lastClose(klines);

    const ready = direction === 'long'
        ? currentPrice > emaFast && emaFast > emaMid
        : currentPrice < emaFast && emaFast < emaMid;

    return { ready, emaFast, emaMid, currentPrice };
}

export function buildEmptyCandidate(reason: string): WeiShenDirectionalCandidate {
    return {
        eligible: false,
        grade: 'C',
        confidenceScore: 70,
        passed: [],
        failed: [reason],
        blockedReasons: [],
        stopLossPrice: 0,
        invalidationPrice: 0,
        suggestedRiskPct: 0,
    };
}
