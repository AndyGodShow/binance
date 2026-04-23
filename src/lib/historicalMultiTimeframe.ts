import type { KlineData } from '../app/api/backtest/klines/route.ts';
import { calculateEMA } from './indicators.ts';
import { logger } from './logger.ts';
import type { OHLC, TickerData } from './types.ts';
import type { DeepPartial, StrategyParameterConfigMap } from './strategyParameters.ts';
import {
    calculateBreakoutMetrics,
    calculatePercentageChange,
    deriveTrendStructure,
} from './marketStructure.ts';
import {
    buildWeiShenContext,
    getWeiShenTimeframes,
    isWeiShenStrategy,
} from './weiShenStrategy.ts';

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
    | 'strategyContexts'
>;

export type HistoricalTickerOverrides = Partial<HistoricalOverrideFields>;

interface HistoricalMultiTimeframeOptions {
    strategyId: string;
    symbol: string;
    startTime: number;
    endTime: number;
    baseInterval: string;
    baseKlines: KlineData[];
    parameterOverrides?: DeepPartial<StrategyParameterConfigMap>;
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

function toSupportedInterval(interval: string): SupportedInterval {
    return interval as SupportedInterval;
}

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

    return calculatePercentageChange(currentClose, pastClose);
}

export function getRequiredHistoricalIntervals(
    strategyId: string,
    parameterOverrides?: DeepPartial<StrategyParameterConfigMap>,
): SupportedInterval[] {
    if (!MULTIFRAME_STRATEGIES.has(strategyId)) {
        return [];
    }

    if (strategyId === 'strong-breakout') {
        return ['5m', '15m', '1h', '4h', '1d'];
    }

    if (TREND_STRUCTURE_STRATEGIES.has(strategyId)) {
        return ['5m', '15m', '1h', '4h'];
    }

    if (isWeiShenStrategy(strategyId)) {
        const timeframes = getWeiShenTimeframes(parameterOverrides);
        return [
            toSupportedInterval(timeframes.signalInterval),
            toSupportedInterval(timeframes.confirmInterval),
            toSupportedInterval(timeframes.dailyFilterInterval),
        ];
    }

    return ['15m', '1h', '4h'];
}

function toOHLCSeries(klines: KlineData[]): OHLC[] {
    return klines.map((kline) => ({
        time: kline.closeTime,
        open: Number.parseFloat(kline.open),
        high: Number.parseFloat(kline.high),
        low: Number.parseFloat(kline.low),
        close: Number.parseFloat(kline.close),
        volume: Number.parseFloat(kline.volume),
        quoteVolume: Number.parseFloat(kline.quoteVolume),
        takerBuyQuoteVolume: Number.parseFloat(kline.takerBuyQuoteVolume),
    }));
}

function sliceSeriesUpTo(
    sourceKlines: KlineData[],
    sourceSeries: OHLC[],
    timestamp: number,
): OHLC[] {
    const index = findLatestIndexAtOrBefore(sourceKlines, timestamp);
    if (index < 0) {
        return [];
    }

    return sourceSeries.slice(0, index + 1);
}

export async function buildHistoricalTickerOverrides(
    options: HistoricalMultiTimeframeOptions
): Promise<Map<number, HistoricalTickerOverrides>> {
    const requiredIntervals = getRequiredHistoricalIntervals(options.strategyId, options.parameterOverrides);
    if (requiredIntervals.length === 0 || options.baseKlines.length === 0) {
        return new Map();
    }

    const fetchStartTime = Math.max(0, options.startTime - HISTORICAL_LOOKBACK_BUFFER_MS);
    const intervalData = new Map<SupportedInterval, KlineData[]>();
    const isWeiShen = isWeiShenStrategy(options.strategyId);
    const weiShenTimeframes = isWeiShen
        ? getWeiShenTimeframes(options.parameterOverrides)
        : null;

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

    const btcIntervalData = new Map<SupportedInterval, KlineData[]>();
    if (isWeiShen) {
        const btcIntervals: SupportedInterval[] = [
            toSupportedInterval(weiShenTimeframes!.signalInterval),
            toSupportedInterval(weiShenTimeframes!.confirmInterval),
            toSupportedInterval(weiShenTimeframes!.dailyFilterInterval),
        ];
        for (const interval of btcIntervals) {
            if (options.symbol === 'BTCUSDT' && interval === options.baseInterval) {
                btcIntervalData.set(interval, options.baseKlines);
                continue;
            }

            if (options.symbol === 'BTCUSDT' && intervalData.has(interval)) {
                btcIntervalData.set(interval, intervalData.get(interval) || []);
                continue;
            }

            try {
                const klines = await options.fetchRangeData(
                    'BTCUSDT',
                    interval,
                    fetchStartTime,
                    options.endTime,
                );
                btcIntervalData.set(interval, klines);
            } catch (error) {
                logger.warn('Historical wei-shen BTC context fetch failed', {
                    symbol: options.symbol,
                    strategyId: options.strategyId,
                    interval,
                    error: error instanceof Error ? error.message : String(error),
                });
                btcIntervalData.set(interval, []);
            }
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
    const ohlcIntervalData = new Map<SupportedInterval, OHLC[]>(
        Array.from(intervalData.entries()).map(([interval, klines]) => [interval, toOHLCSeries(klines)]),
    );
    const btcOhlcIntervalData = new Map<SupportedInterval, OHLC[]>(
        Array.from(btcIntervalData.entries()).map(([interval, klines]) => [interval, toOHLCSeries(klines)]),
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

                const gmmaShortValues = gmmaShortSeries.map((series) => series[trendIndex] ?? null);
                const gmmaLongValues = gmmaLongSeries.map((series) => series[trendIndex] ?? null);
                const multiValues = multiEmaSeries.map((series) => series[trendIndex] ?? null);

                Object.assign(
                    currentOverrides,
                    deriveTrendStructure({
                        currentPrice,
                        ema20,
                        ema60,
                        ema100,
                        gmmaShortValues,
                        gmmaLongValues,
                        multiEmaValues: multiValues,
                    }),
                );
            }
        }

        if (dailyKlines.length > 0) {
            const completedDailyIndex = findLatestIndexAtOrBefore(dailyKlines, timestamp - 1);
            if (completedDailyIndex >= 20) {
                const breakoutWindow = dailyKlines.slice(completedDailyIndex - 20, completedDailyIndex + 1);
                const breakoutHigh = Math.max(...breakoutWindow.map(parseHigh));
                const breakoutMetrics = calculateBreakoutMetrics(currentPrice, breakoutHigh);
                if (breakoutMetrics) {
                    Object.assign(currentOverrides, breakoutMetrics);
                }
            }
        }

        if (isWeiShen) {
            const signalInterval = toSupportedInterval(weiShenTimeframes!.signalInterval);
            const confirmInterval = toSupportedInterval(weiShenTimeframes!.confirmInterval);
            const dailyInterval = toSupportedInterval(weiShenTimeframes!.dailyFilterInterval);
            const symbol1hKlines = intervalData.get(signalInterval) || options.baseKlines;
            const symbol4hKlines = intervalData.get(confirmInterval) || [];
            const symbol1dKlines = intervalData.get(dailyInterval) || [];
            const btc1hKlines = btcIntervalData.get(signalInterval) || [];
            const btc4hKlines = btcIntervalData.get(confirmInterval) || [];
            const btc1dKlines = btcIntervalData.get(dailyInterval) || [];
            const symbol1hSeries = ohlcIntervalData.get(signalInterval) || toOHLCSeries(symbol1hKlines);
            const symbol4hSeries = ohlcIntervalData.get(confirmInterval) || toOHLCSeries(symbol4hKlines);
            const symbol1dSeries = ohlcIntervalData.get(dailyInterval) || toOHLCSeries(symbol1dKlines);
            const btc1hSeries = btcOhlcIntervalData.get(signalInterval) || toOHLCSeries(btc1hKlines);
            const btc4hSeries = btcOhlcIntervalData.get(confirmInterval) || toOHLCSeries(btc4hKlines);
            const btc1dSeries = btcOhlcIntervalData.get(dailyInterval) || toOHLCSeries(btc1dKlines);
            const weiShenContext = buildWeiShenContext({
                symbol: options.symbol,
                signal1h: sliceSeriesUpTo(symbol1hKlines, symbol1hSeries, timestamp),
                confirm4h: sliceSeriesUpTo(symbol4hKlines, symbol4hSeries, timestamp),
                daily1d: sliceSeriesUpTo(symbol1dKlines, symbol1dSeries, timestamp),
                btc1h: sliceSeriesUpTo(btc1hKlines, btc1hSeries, timestamp),
                btc4h: sliceSeriesUpTo(btc4hKlines, btc4hSeries, timestamp),
                btc1d: sliceSeriesUpTo(btc1dKlines, btc1dSeries, timestamp),
                fallbackQuoteVolume24hUsd: Number.parseFloat(baseKline.quoteVolume),
                parameterOverrides: options.parameterOverrides,
            });

            if (weiShenContext) {
                currentOverrides.strategyContexts = {
                    weiShen: weiShenContext,
                };
            }
        }

        overrides.set(timestamp, currentOverrides);
    });

    return overrides;
}
