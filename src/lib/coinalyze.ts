import { LRUCache } from '@/lib/cache';
import { logger } from '@/lib/logger';

const COINALYZE_BASE_URL = 'https://api.coinalyze.net/v1';
const MARKET_CACHE_TTL = 6 * 60 * 60 * 1000;
const HISTORY_CACHE_TTL = 5 * 60 * 1000;
const COINALYZE_INTRADAY_RETENTION_POINTS = 1500;

const COINALYZE_INTERVALS = [
    { requestInterval: '1m', apiInterval: '1min', ms: 60 * 1000 },
    { requestInterval: '5m', apiInterval: '5min', ms: 5 * 60 * 1000 },
    { requestInterval: '15m', apiInterval: '15min', ms: 15 * 60 * 1000 },
    { requestInterval: '30m', apiInterval: '30min', ms: 30 * 60 * 1000 },
    { requestInterval: '1h', apiInterval: '1hour', ms: 60 * 60 * 1000 },
    { requestInterval: '2h', apiInterval: '2hour', ms: 2 * 60 * 60 * 1000 },
    { requestInterval: '4h', apiInterval: '4hour', ms: 4 * 60 * 60 * 1000 },
    { requestInterval: '6h', apiInterval: '6hour', ms: 6 * 60 * 60 * 1000 },
    { requestInterval: '12h', apiInterval: '12hour', ms: 12 * 60 * 60 * 1000 },
    { requestInterval: '1d', apiInterval: 'daily', ms: 24 * 60 * 60 * 1000 },
] as const;

interface CoinalyzeFutureMarket {
    symbol?: string;
    exchange?: string;
    symbol_on_exchange?: string;
    is_perpetual?: boolean;
}

interface CoinalyzeHistoryEntry {
    t?: number;
    o?: number;
    h?: number;
    l?: number;
    c?: number;
}

interface CoinalyzeHistoryResponseItem {
    symbol?: string;
    history?: CoinalyzeHistoryEntry[];
}

export interface CoinalyzeOpenInterestPoint {
    timestamp: number;
    openInterest: string;
    openInterestValue: string;
}

const futureMarketsCache = new LRUCache<CoinalyzeFutureMarket[]>(1, MARKET_CACHE_TTL);
const symbolMappingCache = new LRUCache<string | null>(1000, MARKET_CACHE_TTL);
const historyCache = new LRUCache<CoinalyzeOpenInterestPoint[]>(1000, HISTORY_CACHE_TTL);

const inflightFutureMarkets = new Map<string, Promise<CoinalyzeFutureMarket[]>>();
const inflightHistory = new Map<string, Promise<CoinalyzeOpenInterestPoint[]>>();

function getCoinalyzeApiKey(): string | null {
    const key = process.env.COINALYZE_API_KEY?.trim();
    return key ? key : null;
}

export function isCoinalyzeConfigured(): boolean {
    return Boolean(getCoinalyzeApiKey());
}

function isCoinalyzeFutureMarket(value: unknown): value is CoinalyzeFutureMarket {
    return typeof value === 'object' && value !== null;
}

function isCoinalyzeHistoryResponseItem(value: unknown): value is CoinalyzeHistoryResponseItem {
    return typeof value === 'object' && value !== null;
}

function isCoinalyzeHistoryEntry(value: unknown): value is CoinalyzeHistoryEntry {
    return typeof value === 'object' && value !== null;
}

async function fetchCoinalyzeJson<T>(
    path: string,
    params: URLSearchParams,
    revalidate: number = 300
): Promise<T> {
    const apiKey = getCoinalyzeApiKey();
    if (!apiKey) {
        throw new Error('Coinalyze API key is not configured');
    }

    params.set('api_key', apiKey);
    const url = `${COINALYZE_BASE_URL}${path}?${params.toString()}`;
    const response = await fetch(url, {
        headers: {
            Accept: 'application/json',
        },
        next: { revalidate },
        signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) {
        throw new Error(`Coinalyze request failed (${response.status}) for ${path}`);
    }

    return await response.json() as T;
}

async function loadFutureMarkets(): Promise<CoinalyzeFutureMarket[]> {
    const cacheKey = 'future-markets';
    const cached = futureMarketsCache.get(cacheKey);
    if (cached) {
        return cached;
    }

    const inflight = inflightFutureMarkets.get(cacheKey);
    if (inflight) {
        return inflight;
    }

    const request = (async () => {
        const response = await fetchCoinalyzeJson<unknown>('/future-markets', new URLSearchParams(), 6 * 60 * 60);
        const markets = Array.isArray(response)
            ? response.filter(isCoinalyzeFutureMarket)
            : [];

        futureMarketsCache.set(cacheKey, markets, MARKET_CACHE_TTL);
        return markets;
    })();

    inflightFutureMarkets.set(cacheKey, request);

    try {
        return await request;
    } finally {
        inflightFutureMarkets.delete(cacheKey);
    }
}

function guessCoinalyzeSymbol(binanceSymbol: string): string | null {
    const normalizedSymbol = binanceSymbol.toUpperCase();
    return normalizedSymbol.endsWith('USDT')
        ? `${normalizedSymbol}_PERP.A`
        : null;
}

async function resolveCoinalyzeSymbol(binanceSymbol: string): Promise<string | null> {
    if (!isCoinalyzeConfigured()) {
        return null;
    }

    const normalizedSymbol = binanceSymbol.toUpperCase();
    const cached = symbolMappingCache.get(normalizedSymbol);
    if (cached !== undefined) {
        return cached;
    }

    try {
        const markets = await loadFutureMarkets();
        const candidates = markets.filter((market) =>
            market.is_perpetual === true &&
            market.symbol_on_exchange?.toUpperCase() === normalizedSymbol &&
            typeof market.symbol === 'string'
        );

        const guessed = guessCoinalyzeSymbol(normalizedSymbol);
        const preferredMatch =
            candidates.find((market) => market.symbol === guessed) ||
            candidates.find((market) => market.symbol?.endsWith('_PERP.A')) ||
            candidates[0];

        const resolved = preferredMatch?.symbol || null;
        symbolMappingCache.set(normalizedSymbol, resolved, MARKET_CACHE_TTL);
        return resolved;
    } catch (error) {
        const guessed = guessCoinalyzeSymbol(normalizedSymbol);
        logger.warn('Failed to resolve Coinalyze market via metadata, using convention fallback', {
            symbol: normalizedSymbol,
            guessed,
            error: error instanceof Error ? error.message : String(error),
        });
        symbolMappingCache.set(normalizedSymbol, guessed, MARKET_CACHE_TTL);
        return guessed;
    }
}

function resolveCoinalyzeInterval(interval: string, fromMs: number) {
    const startIndex = COINALYZE_INTERVALS.findIndex((candidate) => candidate.requestInterval === interval);
    if (startIndex === -1) {
        return null;
    }

    const lookbackAgeMs = Math.max(Date.now() - fromMs, 0);

    for (let index = startIndex; index < COINALYZE_INTERVALS.length; index += 1) {
        const candidate = COINALYZE_INTERVALS[index];
        if (
            candidate.apiInterval === 'daily' ||
            lookbackAgeMs <= candidate.ms * COINALYZE_INTRADAY_RETENTION_POINTS
        ) {
            return candidate;
        }
    }

    return COINALYZE_INTERVALS[COINALYZE_INTERVALS.length - 1];
}

export async function fetchCoinalyzeOpenInterestHistory(
    binanceSymbol: string,
    interval: string,
    fromMs: number,
    toMs: number
): Promise<CoinalyzeOpenInterestPoint[]> {
    if (!isCoinalyzeConfigured()) {
        return [];
    }

    const resolvedSymbol = await resolveCoinalyzeSymbol(binanceSymbol);
    const resolvedInterval = resolveCoinalyzeInterval(interval, fromMs);

    if (!resolvedSymbol || !resolvedInterval || !Number.isFinite(fromMs) || !Number.isFinite(toMs) || fromMs > toMs) {
        return [];
    }

    const cacheKey = `${resolvedSymbol}:${resolvedInterval.apiInterval}:${fromMs}:${toMs}`;
    const cached = historyCache.get(cacheKey);
    if (cached) {
        return cached;
    }

    const inflight = inflightHistory.get(cacheKey);
    if (inflight) {
        return inflight;
    }

    const request = (async () => {
        const params = new URLSearchParams({
            symbols: resolvedSymbol,
            interval: resolvedInterval.apiInterval,
            from: String(Math.floor(fromMs / 1000)),
            to: String(Math.floor(toMs / 1000)),
            convert_to_usd: 'true',
        });

        if (resolvedInterval.requestInterval !== interval) {
            logger.info('Coinalyze OI fallback interval downgraded for retention', {
                symbol: binanceSymbol.toUpperCase(),
                requestedInterval: interval,
                effectiveInterval: resolvedInterval.requestInterval,
            });
        }

        const response = await fetchCoinalyzeJson<unknown>('/open-interest-history', params);
        const responseItems = Array.isArray(response)
            ? response.filter(isCoinalyzeHistoryResponseItem)
            : [];

        const history = responseItems[0]?.history;
        if (!Array.isArray(history)) {
            return [];
        }

        const points = history
            .filter(isCoinalyzeHistoryEntry)
            .map((entry) => {
                const timestamp = typeof entry.t === 'number' ? entry.t * 1000 : NaN;
                const closeValue = typeof entry.c === 'number' ? entry.c : NaN;

                if (!Number.isFinite(timestamp) || !Number.isFinite(closeValue)) {
                    return null;
                }

                const serializedValue = closeValue.toFixed(2);

                return {
                    timestamp,
                    openInterest: serializedValue,
                    openInterestValue: serializedValue,
                };
            })
            .filter((point): point is CoinalyzeOpenInterestPoint => point !== null)
            .sort((a, b) => a.timestamp - b.timestamp);

        historyCache.set(cacheKey, points, HISTORY_CACHE_TTL);
        return points;
    })().catch((error) => {
        logger.warn('Failed to fetch Coinalyze open interest history', {
            symbol: binanceSymbol.toUpperCase(),
            resolvedSymbol,
            interval: resolvedInterval.apiInterval,
            error: error instanceof Error ? error.message : String(error),
        });
        return [];
    });

    inflightHistory.set(cacheKey, request);

    try {
        return await request;
    } finally {
        inflightHistory.delete(cacheKey);
    }
}
