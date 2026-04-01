import { fetchBinanceJson } from '@/lib/binanceApi';
import { LRUCache } from '@/lib/cache';
import { logger } from '@/lib/logger';
import {
    EmaState,
    MACDState,
    RsiState,
    getLatestEMAState,
    getLatestMACDState,
    getLatestRSIState,
} from '@/lib/indicators';

const SUPPORTED_INTERVALS = ['5m', '15m', '1h', '4h', '24h'] as const;
const EMA_PERIODS = [20, 60, 100, 120, 144, 169] as const;
const RSI_PERIOD = 14;
const MACD_FAST = 12;
const MACD_SLOW = 26;
const MACD_SIGNAL = 9;
const LOOKBACK_LIMIT = 200;
const BATCH_SIZE = 20;
const BATCH_DELAY_MS = 50;

export type MarketIndicatorInterval = typeof SUPPORTED_INTERVALS[number];

interface BinanceExchangeInfoSymbol {
    symbol: string;
    contractType: string;
    status: string;
}

interface BinanceExchangeInfoResponse {
    symbols: BinanceExchangeInfoSymbol[];
}

type BinanceKline = [
    number,
    string,
    string,
    string,
    string,
    string,
    number,
    string,
    number,
    string,
    string,
    ...unknown[]
];

interface IndicatorKline {
    close: number;
    closeTime: number;
}

export interface MarketIndicatorEntry {
    symbol: string;
    interval: MarketIndicatorInterval;
    close: number;
    closeTime: number;
    ema: Record<string, EmaState>;
    allEmaRising: boolean;
    bullishStack: boolean;
    bearishStack: boolean;
    rsi: RsiState | null;
    macd: MACDState | null;
}

export interface MarketIndicatorSnapshot {
    interval: MarketIndicatorInterval;
    candleInterval: string;
    generatedAt: number;
    symbolCount: number;
    indicators: Record<string, MarketIndicatorEntry>;
}

export interface MarketIndicatorSnapshotResult {
    source: 'memory-cache' | 'live' | 'live-coalesced' | 'stale-memory-cache';
    snapshot: MarketIndicatorSnapshot;
}

const snapshotCache = new Map<MarketIndicatorInterval, { expiresAt: number; snapshot: MarketIndicatorSnapshot }>();
const staleSnapshotCache = new Map<MarketIndicatorInterval, MarketIndicatorSnapshot>();
const inflightBuilds = new Map<MarketIndicatorInterval, Promise<MarketIndicatorSnapshot>>();
const indicatorKlineCache = new LRUCache<IndicatorKline[]>(3000, 15 * 60 * 1000);
let symbolListCache: { expiresAt: number; symbols: string[] } | null = null;

function normalizeInterval(interval: string): MarketIndicatorInterval | null {
    if (interval === '1d') {
        return '24h';
    }

    return SUPPORTED_INTERVALS.includes(interval as MarketIndicatorInterval)
        ? interval as MarketIndicatorInterval
        : null;
}

function toBinanceInterval(interval: MarketIndicatorInterval): string {
    return interval === '24h' ? '1d' : interval;
}

function intervalToMs(interval: MarketIndicatorInterval): number {
    switch (interval) {
        case '5m':
            return 5 * 60 * 1000;
        case '15m':
            return 15 * 60 * 1000;
        case '1h':
            return 60 * 60 * 1000;
        case '4h':
            return 4 * 60 * 60 * 1000;
        case '24h':
            return 24 * 60 * 60 * 1000;
    }
}

function getNextBoundary(interval: MarketIndicatorInterval, now: number): number {
    const intervalMs = intervalToMs(interval);
    return (Math.floor(now / intervalMs) + 1) * intervalMs;
}

function chunkArray<T>(values: T[], size: number): T[][] {
    return Array.from(
        { length: Math.ceil(values.length / size) },
        (_, index) => values.slice(index * size, index * size + size)
    );
}

function isBinanceKline(value: unknown): value is BinanceKline {
    return Array.isArray(value) &&
        value.length >= 11 &&
        typeof value[0] === 'number' &&
        typeof value[1] === 'string' &&
        typeof value[4] === 'string' &&
        typeof value[6] === 'number';
}

async function getActivePerpetualUsdtSymbols(): Promise<string[]> {
    const now = Date.now();
    if (symbolListCache && now < symbolListCache.expiresAt) {
        return symbolListCache.symbols;
    }

    const exchangeInfo = await fetchBinanceJson<BinanceExchangeInfoResponse>('/fapi/v1/exchangeInfo', {
        revalidate: 86400,
        timeoutMs: 12000,
    });

    const symbols = exchangeInfo.symbols
        .filter((symbol) =>
            (symbol.contractType === 'PERPETUAL' || symbol.contractType === 'TRADIFI_PERPETUAL') &&
            symbol.status === 'TRADING' &&
            symbol.symbol.endsWith('USDT')
        )
        .map((symbol) => symbol.symbol);

    symbolListCache = {
        symbols,
        expiresAt: now + 24 * 60 * 60 * 1000,
    };

    return symbols;
}

function buildEntry(symbol: string, interval: MarketIndicatorInterval, klines: IndicatorKline[]): MarketIndicatorEntry | null {
    const closes = klines.map((kline) => kline.close).filter(Number.isFinite);
    if (closes.length < LOOKBACK_LIMIT) {
        return null;
    }

    const emaEntries = EMA_PERIODS.map((period) => [String(period), getLatestEMAState(closes, period)] as const);
    if (emaEntries.some(([, state]) => state === null)) {
        return null;
    }

    const ema = Object.fromEntries(
        emaEntries.map(([period, state]) => [period, state as EmaState])
    ) as Record<string, EmaState>;

    const orderedPeriods = EMA_PERIODS.map((period) => ema[String(period)]);
    const allEmaRising = orderedPeriods.every((state) => state.rising);
    const bullishStack = orderedPeriods.every((state, index) =>
        index === 0 ? true : orderedPeriods[index - 1].value > state.value
    );
    const bearishStack = orderedPeriods.every((state, index) =>
        index === 0 ? true : orderedPeriods[index - 1].value < state.value
    );

    const rsi = getLatestRSIState(closes, RSI_PERIOD);
    const macd = getLatestMACDState(closes, MACD_FAST, MACD_SLOW, MACD_SIGNAL);
    const latestKline = klines[klines.length - 1];

    return {
        symbol,
        interval,
        close: closes[closes.length - 1],
        closeTime: latestKline.closeTime,
        ema,
        allEmaRising,
        bullishStack,
        bearishStack,
        rsi,
        macd,
    };
}

async function fetchSymbolKlines(symbol: string, interval: MarketIndicatorInterval): Promise<IndicatorKline[]> {
    const cacheKey = `market-indicators:${interval}:${symbol}:${LOOKBACK_LIMIT}`;
    const cached = indicatorKlineCache.get(cacheKey);
    if (cached) {
        return cached;
    }

    const binanceInterval = toBinanceInterval(interval);
    const rawKlines = await fetchBinanceJson<unknown>(
        `/fapi/v1/klines?symbol=${symbol}&interval=${binanceInterval}&limit=${LOOKBACK_LIMIT}`,
        {
            revalidate: 60,
            timeoutMs: 12000,
        }
    );

    if (!Array.isArray(rawKlines)) {
        return [];
    }

    const klines = rawKlines
        .filter(isBinanceKline)
        .map((kline) => ({
            close: Number.parseFloat(kline[4]),
            closeTime: kline[6],
        }))
        .filter((kline) => Number.isFinite(kline.close) && Number.isFinite(kline.closeTime));

    if (klines.length > 0) {
        const ttl = Math.max(1000, getNextBoundary(interval, Date.now()) - Date.now());
        indicatorKlineCache.set(cacheKey, klines, ttl);
    }

    return klines;
}

async function buildSnapshot(
    interval: MarketIndicatorInterval,
    requestedSymbols?: string[],
): Promise<MarketIndicatorSnapshot> {
    const symbols = requestedSymbols && requestedSymbols.length > 0
        ? requestedSymbols
        : await getActivePerpetualUsdtSymbols();
    const indicatorMap: Record<string, MarketIndicatorEntry> = {};
    const symbolChunks = chunkArray(symbols, BATCH_SIZE);

    for (let index = 0; index < symbolChunks.length; index++) {
        const chunk = symbolChunks[index];
        const results = await Promise.allSettled(
            chunk.map(async (symbol) => {
                const klines = await fetchSymbolKlines(symbol, interval);
                const entry = buildEntry(symbol, interval, klines);
                return entry;
            })
        );

        results.forEach((result, resultIndex) => {
            if (result.status === 'fulfilled' && result.value) {
                indicatorMap[result.value.symbol] = result.value;
                return;
            }

            if (result.status === 'rejected') {
                logger.warn('Failed to build market indicators for symbol', {
                    symbol: chunk[resultIndex],
                    interval,
                    error: result.reason instanceof Error ? result.reason.message : String(result.reason),
                });
            }
        });

        if (index < symbolChunks.length - 1) {
            await new Promise((resolve) => setTimeout(resolve, BATCH_DELAY_MS));
        }
    }

    const snapshot: MarketIndicatorSnapshot = {
        interval,
        candleInterval: toBinanceInterval(interval),
        generatedAt: Date.now(),
        symbolCount: Object.keys(indicatorMap).length,
        indicators: indicatorMap,
    };

    if (!requestedSymbols || requestedSymbols.length === 0) {
        snapshotCache.set(interval, {
            expiresAt: getNextBoundary(interval, Date.now()),
            snapshot,
        });
        staleSnapshotCache.set(interval, snapshot);
    }

    return snapshot;
}

export async function getMarketIndicatorSnapshot(
    intervalInput: string,
    options?: { symbols?: string[] }
): Promise<MarketIndicatorSnapshotResult> {
    const interval = normalizeInterval(intervalInput);
    if (!interval) {
        throw new Error(`Unsupported interval: ${intervalInput}`);
    }

    const requestedSymbols = options?.symbols
        ?.map((symbol) => symbol.trim().toUpperCase())
        .filter(Boolean);

    const isPartialRequest = !!requestedSymbols && requestedSymbols.length > 0;

    const now = Date.now();
    const cached = snapshotCache.get(interval);
    if (cached && now < cached.expiresAt) {
        const indicators = isPartialRequest
            ? Object.fromEntries(
                Object.entries(cached.snapshot.indicators).filter(([symbol]) => requestedSymbols.includes(symbol))
            )
            : cached.snapshot.indicators;

        return {
            source: 'memory-cache',
            snapshot: {
                ...cached.snapshot,
                symbolCount: Object.keys(indicators).length,
                indicators,
            },
        };
    }

    if (isPartialRequest) {
        const snapshot = await buildSnapshot(interval, requestedSymbols);
        return {
            source: 'live',
            snapshot,
        };
    }

    const ownsInflight = !inflightBuilds.has(interval);
    if (!inflightBuilds.has(interval)) {
        inflightBuilds.set(interval, buildSnapshot(interval));
    }

    try {
        const snapshot = await inflightBuilds.get(interval)!;
        return {
            source: ownsInflight ? 'live' : 'live-coalesced',
            snapshot,
        };
    } catch (error) {
        logger.error('Failed to build market indicator snapshot', error as Error, { interval });
        const stale = staleSnapshotCache.get(interval);
        if (stale) {
            return {
                source: 'stale-memory-cache',
                snapshot: stale,
            };
        }
        throw error;
    } finally {
        if (ownsInflight) {
            inflightBuilds.delete(interval);
        }
    }
}
