import type { KlineData } from '../app/api/backtest/klines/route.ts';
import { calculateEMA } from './indicators.ts';
import { logger } from './logger.ts';
import type { TickerData } from './types.ts';

type SupportedInterval = '5m' | '15m' | '1h' | '4h' | '1d';

type HistoricalOverrideFields = Pick<
    TickerData,
    | 'change15m'
    | 'change1h'
    | 'change4h'
    | 'priceChangePercent'
    | 'ema5m20'
    | 'ema5m60'
    | 'ema5m100'
    | 'ema5mDistancePercent'
    | 'gmmaTrend'
    | 'gmmaShortScore'
    | 'gmmaLongScore'
    | 'gmmaSeparationPercent'
    | 'multiEmaTrend'
    | 'multiEmaAlignmentScore'
    | 'breakout21dHigh'
    | 'breakout21dPercent'
>;

export type HistoricalTickerOverrides = Partial<HistoricalOverrideFields>;

interface HistoricalMultiTimeframeOptions {
    strategyId: string;
    symbol: string;
    startTime: number;
    endTime: number;
    baseInterval: string;
    baseKlines: KlineData[];
    fetchRangeData: (symbol: string, interval: string, startTime: number, endTime: number) => Promise<KlineData[]>;
}

const INTERVAL_MS: Record<SupportedInterval, number> = {
    '5m': 5 * 60 * 1000,
    '15m': 15 * 60 * 1000,
    '1h': 60 * 60 * 1000,
    '4h': 4 * 60 * 60 * 1000,
    '1d': 24 * 60 * 60 * 1000,
};

const MULTIFRAME_STRATEGIES = new Set([
    'strong-breakout',
    'trend-confirmation',
    'capital-inflow',
    'rsrs-trend',
    'wei-shen-ledger',
]);

const TREND_STRUCTURE_STRATEGIES = new Set(['strong-breakout', 'trend-confirmation']);
const HISTORICAL_LOOKBACK_BUFFER_MS = 35 * 24 * 60 * 60 * 1000;
const GMMA_SHORT_PERIODS = [3, 5, 8, 10, 12, 15] as const;
const GMMA_LONG_PERIODS = [30, 35, 40, 45, 50, 60] as const;
const MULTI_EMA_PERIODS = [20, 60, 100, 120] as const;

function parseClose(kline: KlineData): number {
    return Number.parseFloat(kline.close);
}

function parseHigh(kline: KlineData): number {
    return Number.parseFloat(kline.high);
}

function buildAlignedEmaSeries(klines: KlineData[], period: number): Array<number | null> {
    const closes = klines.map(parseClose).filter(Number.isFinite);
    const rawSeries = calculateEMA(closes, period);
    const alignedSeries = Array<number | null>(klines.length).fill(null);

    for (let index = period - 1; index < klines.length; index++) {
        alignedSeries[index] = rawSeries[index - (period - 1)] ?? null;
    }

    return alignedSeries;
}

function determineOrderedTrend(values: Array<number | null>): 'bullish' | 'bearish' | 'mixed' {
    if (values.some((value) => value === null)) {
        return 'mixed';
    }

    const definedValues = values as number[];
    const bullish = definedValues.every((value, index) => index === 0 || definedValues[index - 1] > value);
    if (bullish) {
        return 'bullish';
    }

    const bearish = definedValues.every((value, index) => index === 0 || definedValues[index - 1] < value);
    if (bearish) {
        return 'bearish';
    }

    return 'mixed';
}

function calculateDirectionalAlignmentScore(values: Array<number | null>, direction: 'bullish' | 'bearish'): number {
    if (values.some((value) => value === null)) {
        return 0;
    }

    const definedValues = values as number[];
    let score = 0;
    for (let index = 1; index < definedValues.length; index++) {
        const prev = definedValues[index - 1];
        const current = definedValues[index];
        const aligned = direction === 'bullish' ? prev > current : prev < current;
        if (aligned) {
            score += 1;
        }
    }

    return score;
}

function findLatestIndexAtOrBefore(klines: KlineData[], timestamp: number): number {
    let left = 0;
    let right = klines.length - 1;
    let result = -1;

    while (left <= right) {
        const mid = Math.floor((left + right) / 2);
        if (klines[mid].closeTime <= timestamp) {
            result = mid;
            left = mid + 1;
        } else {
            right = mid - 1;
        }
    }

    return result;
}

function calculateTimeAlignedChange(klines: KlineData[], timestamp: number, lookbackMs: number): number {
    if (klines.length === 0) {
        return 0;
    }

    const currentIndex = findLatestIndexAtOrBefore(klines, timestamp);
    const pastIndex = findLatestIndexAtOrBefore(klines, timestamp - lookbackMs);

    if (currentIndex <= 0 || pastIndex < 0 || pastIndex >= currentIndex) {
        return 0;
    }

    const currentClose = parseClose(klines[currentIndex]);
    const pastClose = parseClose(klines[pastIndex]);

    if (!Number.isFinite(currentClose) || !Number.isFinite(pastClose) || pastClose <= 0) {
        return 0;
    }

    return ((currentClose - pastClose) / pastClose) * 100;
}

export function getRequiredHistoricalIntervals(strategyId: string): SupportedInterval[] {
    if (!MULTIFRAME_STRATEGIES.has(strategyId)) {
        return [];
    }

    if (strategyId === 'strong-breakout') {
        return ['5m', '15m', '1h', '4h', '1d'];
    }

    if (TREND_STRUCTURE_STRATEGIES.has(strategyId)) {
        return ['5m', '15m', '1h', '4h'];
    }

    return ['15m', '1h', '4h'];
}

export async function buildHistoricalTickerOverrides(
    options: HistoricalMultiTimeframeOptions
): Promise<Map<number, HistoricalTickerOverrides>> {
    const requiredIntervals = getRequiredHistoricalIntervals(options.strategyId);
    if (requiredIntervals.length === 0 || options.baseKlines.length === 0) {
        return new Map();
    }

    const fetchStartTime = Math.max(0, options.startTime - HISTORICAL_LOOKBACK_BUFFER_MS);
    const intervalData = new Map<SupportedInterval, KlineData[]>();

    for (const interval of requiredIntervals) {
        if (interval === options.baseInterval) {
            intervalData.set(interval, options.baseKlines);
            continue;
        }

        try {
            const klines = await options.fetchRangeData(
                options.symbol,
                interval,
                fetchStartTime,
                options.endTime
            );
            intervalData.set(interval, klines);
        } catch (error) {
            logger.warn('Historical multi-timeframe fetch failed, falling back to partial overrides', {
                symbol: options.symbol,
                strategyId: options.strategyId,
                interval,
                error: error instanceof Error ? error.message : String(error),
            });
            intervalData.set(interval, []);
        }
    }

    const overrides = new Map<number, HistoricalTickerOverrides>();
    const trend5mKlines = intervalData.get('5m') || [];
    const dailyKlines = intervalData.get('1d') || [];
    const ema20Series = trend5mKlines.length >= 20 ? buildAlignedEmaSeries(trend5mKlines, 20) : [];
    const ema60Series = trend5mKlines.length >= 60 ? buildAlignedEmaSeries(trend5mKlines, 60) : [];
    const ema100Series = trend5mKlines.length >= 100 ? buildAlignedEmaSeries(trend5mKlines, 100) : [];
    const gmmaShortSeries = GMMA_SHORT_PERIODS.map((period) =>
        trend5mKlines.length >= period ? buildAlignedEmaSeries(trend5mKlines, period) : []
    );
    const gmmaLongSeries = GMMA_LONG_PERIODS.map((period) =>
        trend5mKlines.length >= period ? buildAlignedEmaSeries(trend5mKlines, period) : []
    );
    const multiEmaSeries = MULTI_EMA_PERIODS.map((period) =>
        trend5mKlines.length >= period ? buildAlignedEmaSeries(trend5mKlines, period) : []
    );

    options.baseKlines.forEach((baseKline) => {
        const timestamp = baseKline.closeTime;
        const currentPrice = parseClose(baseKline);
        const currentOverrides: HistoricalTickerOverrides = {
            change15m: calculateTimeAlignedChange(
                intervalData.get('15m') || options.baseKlines,
                timestamp,
                INTERVAL_MS['15m']
            ),
            change1h: calculateTimeAlignedChange(
                intervalData.get('1h') || options.baseKlines,
                timestamp,
                INTERVAL_MS['1h']
            ),
            change4h: calculateTimeAlignedChange(
                intervalData.get('4h') || options.baseKlines,
                timestamp,
                INTERVAL_MS['4h']
            ),
            priceChangePercent: calculateTimeAlignedChange(
                intervalData.get('1h') || intervalData.get('15m') || options.baseKlines,
                timestamp,
                INTERVAL_MS['1d']
            ).toString(),
        };

        if (trend5mKlines.length > 0) {
            const trendIndex = findLatestIndexAtOrBefore(trend5mKlines, timestamp);
            if (trendIndex >= 0) {
                const ema20 = ema20Series[trendIndex];
                const ema60 = ema60Series[trendIndex];
                const ema100 = ema100Series[trendIndex];

                if (typeof ema20 === 'number' && Number.isFinite(ema20)) {
                    currentOverrides.ema5m20 = ema20;
                    currentOverrides.ema5mDistancePercent = ema20 > 0
                        ? ((currentPrice - ema20) / ema20) * 100
                        : undefined;
                }
                if (typeof ema60 === 'number' && Number.isFinite(ema60)) {
                    currentOverrides.ema5m60 = ema60;
                }
                if (typeof ema100 === 'number' && Number.isFinite(ema100)) {
                    currentOverrides.ema5m100 = ema100;
                }

                const gmmaShortValues = gmmaShortSeries.map((series) => series[trendIndex] ?? null);
                const gmmaLongValues = gmmaLongSeries.map((series) => series[trendIndex] ?? null);
                const multiValues = multiEmaSeries.map((series) => series[trendIndex] ?? null);

                const gmmaShortTrend = determineOrderedTrend(gmmaShortValues);
                const gmmaLongTrend = determineOrderedTrend(gmmaLongValues);
                if (!gmmaShortValues.some((value) => value === null) && !gmmaLongValues.some((value) => value === null)) {
                    const shortDefined = gmmaShortValues as number[];
                    const longDefined = gmmaLongValues as number[];
                    const shortAvg = shortDefined.reduce((sum, value) => sum + value, 0) / shortDefined.length;
                    const longAvg = longDefined.reduce((sum, value) => sum + value, 0) / longDefined.length;

                    currentOverrides.gmmaShortScore = gmmaShortTrend === 'bullish'
                        ? calculateDirectionalAlignmentScore(gmmaShortValues, 'bullish')
                        : gmmaShortTrend === 'bearish'
                        ? calculateDirectionalAlignmentScore(gmmaShortValues, 'bearish')
                        : 0;
                    currentOverrides.gmmaLongScore = gmmaLongTrend === 'bullish'
                        ? calculateDirectionalAlignmentScore(gmmaLongValues, 'bullish')
                        : gmmaLongTrend === 'bearish'
                        ? calculateDirectionalAlignmentScore(gmmaLongValues, 'bearish')
                        : 0;
                    currentOverrides.gmmaSeparationPercent = longAvg > 0
                        ? ((shortAvg - longAvg) / longAvg) * 100
                        : undefined;

                    if (
                        gmmaShortTrend === 'bullish' &&
                        gmmaLongTrend === 'bullish' &&
                        Math.min(...shortDefined) > Math.max(...longDefined)
                    ) {
                        currentOverrides.gmmaTrend = 'bullish';
                    } else if (
                        gmmaShortTrend === 'bearish' &&
                        gmmaLongTrend === 'bearish' &&
                        Math.max(...shortDefined) < Math.min(...longDefined)
                    ) {
                        currentOverrides.gmmaTrend = 'bearish';
                    } else {
                        currentOverrides.gmmaTrend = 'mixed';
                    }
                }

                const multiTrend = determineOrderedTrend(multiValues);
                currentOverrides.multiEmaTrend = multiTrend;
                currentOverrides.multiEmaAlignmentScore = multiTrend === 'bullish'
                    ? calculateDirectionalAlignmentScore(multiValues, 'bullish')
                    : multiTrend === 'bearish'
                    ? calculateDirectionalAlignmentScore(multiValues, 'bearish')
                    : 0;
            }
        }

        if (dailyKlines.length > 0) {
            const completedDailyIndex = findLatestIndexAtOrBefore(dailyKlines, timestamp - 1);
            if (completedDailyIndex >= 20) {
                const breakoutWindow = dailyKlines.slice(completedDailyIndex - 20, completedDailyIndex + 1);
                const breakoutHigh = Math.max(...breakoutWindow.map(parseHigh));

                if (Number.isFinite(breakoutHigh) && breakoutHigh > 0) {
                    currentOverrides.breakout21dHigh = breakoutHigh;
                    currentOverrides.breakout21dPercent = ((currentPrice - breakoutHigh) / breakoutHigh) * 100;
                }
            }
        }

        overrides.set(timestamp, currentOverrides);
    });

    return overrides;
}
