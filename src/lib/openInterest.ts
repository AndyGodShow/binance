import { LRUCache } from '@/lib/cache';
import { fetchBinanceJson } from '@/lib/binanceApi';
import { fetchCoinalyzeOpenInterestHistory } from '@/lib/coinalyze';
import { logger } from '@/lib/logger';



interface BinanceOpenInterestHistEntry {
    symbol: string;
    sumOpenInterest: string;
    sumOpenInterestValue: string;
    timestamp: number;
}

interface HistoricalOpenInterestEntry {
    timestamp: number;
    openInterest: string;
    openInterestValue?: string;
}

export interface OpenInterestMarketSnapshot {
    symbol: string;
    currentOpenInterest?: string;
    currentOpenInterestValue?: string;
    changePercent4h?: number;
    asOf: number;
}


const OI_MARKET_PERIOD = '4h';
const OI_MARKET_LIMIT = 2;
const OI_CACHE_TTL = 5 * 60 * 1000;

const marketSnapshotCache = new LRUCache<OpenInterestMarketSnapshot>(1000, OI_CACHE_TTL);


const inflightMarketRequests = new Map<string, Promise<OpenInterestMarketSnapshot | null>>();


function isBinanceOpenInterestHistEntry(value: unknown): value is BinanceOpenInterestHistEntry {
    return typeof value === 'object' &&
        value !== null &&
        typeof (value as BinanceOpenInterestHistEntry).symbol === 'string' &&
        typeof (value as BinanceOpenInterestHistEntry).sumOpenInterest === 'string' &&
        typeof (value as BinanceOpenInterestHistEntry).sumOpenInterestValue === 'string' &&
        typeof (value as BinanceOpenInterestHistEntry).timestamp === 'number';
}

function buildHistoryPath(symbol: string, period: string, limit: number): string {
    const params = new URLSearchParams({
        symbol: symbol.toUpperCase(),
        period,
        limit: String(limit),
    });

    return `/futures/data/openInterestHist?${params.toString()}`;
}

function parseHistEntries(data: unknown): BinanceOpenInterestHistEntry[] {
    if (!Array.isArray(data)) {
        return [];
    }

    return data
        .filter(isBinanceOpenInterestHistEntry)
        .sort((a, b) => a.timestamp - b.timestamp);
}



function findClosestAtOrBefore(
    entries: HistoricalOpenInterestEntry[],
    targetTimestamp: number
): HistoricalOpenInterestEntry | null {
    for (let index = entries.length - 1; index >= 0; index -= 1) {
        if (entries[index].timestamp <= targetTimestamp) {
            return entries[index];
        }
    }

    return entries[0] || null;
}



function formatOpenInterestValue(openInterest: string | undefined, price: string | undefined, fallbackValue?: string): string | undefined {
    if (openInterest && price) {
        const numericOi = Number(openInterest);
        const numericPrice = Number(price);
        if (Number.isFinite(numericOi) && Number.isFinite(numericPrice)) {
            return (numericOi * numericPrice).toFixed(2);
        }
    }

    return fallbackValue;
}

function calculateChangePercent(currentValue: string, previousValue: string): number | undefined {
    const current = Number(currentValue);
    const previous = Number(previousValue);

    if (!Number.isFinite(current) || !Number.isFinite(previous) || previous <= 0) {
        return undefined;
    }

    return ((current - previous) / previous) * 100;
}





export async function fetchOpenInterestMarketSnapshot(
    symbol: string,
    currentPrice?: string
): Promise<OpenInterestMarketSnapshot | null> {
    const normalizedSymbol = symbol.toUpperCase();
    const cacheKey = `market:${normalizedSymbol}`;
    const cached = marketSnapshotCache.get(cacheKey);
    if (cached) {
        return {
            ...cached,
            currentOpenInterestValue: formatOpenInterestValue(
                cached.currentOpenInterest,
                currentPrice,
                cached.currentOpenInterestValue
            ),
        };
    }

    const inflight = inflightMarketRequests.get(cacheKey);
    if (inflight) {
        return inflight;
    }

    const request = (async () => {
        try {
            const historyResponse = await fetchBinanceJson<unknown>(
                buildHistoryPath(normalizedSymbol, OI_MARKET_PERIOD, OI_MARKET_LIMIT),
                { revalidate: 300 }
            );

            const entries = parseHistEntries(historyResponse);
            if (entries.length === 0) {
                throw new Error(`No official market open interest history available for ${normalizedSymbol}`);
            }

            const latestEntry = entries[entries.length - 1];
            const fourHourEntry = entries.length >= 2 ? entries[entries.length - 2] : null;

            const currentOpenInterest = latestEntry.sumOpenInterest;
            const snapshot: OpenInterestMarketSnapshot = {
                symbol: normalizedSymbol,
                currentOpenInterest,
                currentOpenInterestValue: formatOpenInterestValue(
                    currentOpenInterest,
                    currentPrice,
                    latestEntry.sumOpenInterestValue
                ),
                changePercent4h: fourHourEntry
                    ? calculateChangePercent(latestEntry.sumOpenInterestValue, fourHourEntry.sumOpenInterestValue)
                    : undefined,
                asOf: latestEntry.timestamp,
            };

            marketSnapshotCache.set(cacheKey, snapshot, OI_CACHE_TTL);
            return {
                ...snapshot,
                currentOpenInterestValue: formatOpenInterestValue(
                    currentOpenInterest,
                    currentPrice,
                    snapshot.currentOpenInterestValue
                ),
            };
        } catch (error) {
            logger.warn('Failed to fetch official open interest market snapshot', {
                symbol: normalizedSymbol,
                error: error instanceof Error ? error.message : String(error),
            });

            const fallbackEntries = await fetchCoinalyzeOpenInterestHistory(
                normalizedSymbol,
                OI_MARKET_PERIOD,
                Date.now() - 12 * 60 * 60 * 1000,
                Date.now()
            );

            if (fallbackEntries.length === 0) {
                return null;
            }

            const latestEntry = fallbackEntries[fallbackEntries.length - 1];
            const fourHourEntry = findClosestAtOrBefore(
                fallbackEntries,
                latestEntry.timestamp - 4 * 60 * 60 * 1000
            );

            const snapshot: OpenInterestMarketSnapshot = {
                symbol: normalizedSymbol,
                currentOpenInterestValue: latestEntry.openInterestValue,
                changePercent4h: fourHourEntry
                    ? calculateChangePercent(
                        latestEntry.openInterestValue || latestEntry.openInterest,
                        fourHourEntry.openInterestValue || fourHourEntry.openInterest
                    )
                    : undefined,
                asOf: latestEntry.timestamp,
            };

            marketSnapshotCache.set(cacheKey, snapshot, OI_CACHE_TTL);
            return snapshot;
        }
    })();

    inflightMarketRequests.set(cacheKey, request);

    try {
        return await request;
    } finally {
        inflightMarketRequests.delete(cacheKey);
    }
}

export async function fetchOpenInterestMarketSnapshotsBatch(
    symbols: Array<{ symbol: string; price?: string }>,
    batchSize: number = 10
): Promise<Map<string, OpenInterestMarketSnapshot>> {
    const snapshotMap = new Map<string, OpenInterestMarketSnapshot>();

    for (let index = 0; index < symbols.length; index += batchSize) {
        const batch = symbols.slice(index, index + batchSize);
        const results = await Promise.allSettled(
            batch.map(({ symbol, price }) => fetchOpenInterestMarketSnapshot(symbol, price))
        );

        results.forEach((result, batchIndex) => {
            if (result.status === 'fulfilled' && result.value) {
                snapshotMap.set(batch[batchIndex].symbol.toUpperCase(), result.value);
            }
        });

        if (index + batchSize < symbols.length) {
            await new Promise((resolve) => setTimeout(resolve, 50));
        }
    }

    return snapshotMap;
}
