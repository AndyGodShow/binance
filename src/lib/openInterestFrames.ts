import { LRUCache } from './cache';
import { fetchBinanceJson } from './binanceApi';
import { logger } from './logger';
import type { OpenInterestFrameSnapshot } from './types';
import {
    buildOpenInterestFrameSnapshot,
} from './openInterestFrameMath';

const OI_FRAME_CACHE_TTL = 5 * 60 * 1000;
const OI_FRAME_HISTORY_LIMIT = 97;
const OI_FRAME_PERIOD = '15m';

const oiFrameSnapshotCache = new LRUCache<OpenInterestFrameSnapshot>(1000, OI_FRAME_CACHE_TTL);
const inflightFrameRequests = new Map<string, Promise<OpenInterestFrameSnapshot | null>>();

function buildHistoryPath(symbol: string): string {
    const params = new URLSearchParams({
        symbol: symbol.toUpperCase(),
        period: OI_FRAME_PERIOD,
        limit: String(OI_FRAME_HISTORY_LIMIT),
    });

    return `/futures/data/openInterestHist?${params.toString()}`;
}

export async function fetchOpenInterestFrameSnapshot(symbol: string): Promise<OpenInterestFrameSnapshot | null> {
    const normalizedSymbol = symbol.toUpperCase();
    const cacheKey = `oi-frame:${normalizedSymbol}`;
    const cached = oiFrameSnapshotCache.get(cacheKey);
    if (cached) {
        return cached;
    }

    const inflight = inflightFrameRequests.get(cacheKey);
    if (inflight) {
        return inflight;
    }

    const request = (async () => {
        try {
            const response = await fetchBinanceJson<unknown>(
                buildHistoryPath(normalizedSymbol),
                { revalidate: 300 }
            );

            if (!Array.isArray(response)) {
                return null;
            }

            const snapshot = buildOpenInterestFrameSnapshot(normalizedSymbol, response);
            oiFrameSnapshotCache.set(cacheKey, snapshot, OI_FRAME_CACHE_TTL);
            return snapshot;
        } catch (error) {
            logger.warn('Failed to fetch open interest frame snapshot', {
                symbol: normalizedSymbol,
                error: error instanceof Error ? error.message : String(error),
            });
            return null;
        }
    })();

    inflightFrameRequests.set(cacheKey, request);

    try {
        return await request;
    } finally {
        inflightFrameRequests.delete(cacheKey);
    }
}

export async function fetchOpenInterestFrameSnapshotsBatch(
    symbols: string[],
    batchSize: number = 20
): Promise<Map<string, OpenInterestFrameSnapshot>> {
    const snapshotMap = new Map<string, OpenInterestFrameSnapshot>();

    for (let index = 0; index < symbols.length; index += batchSize) {
        const batch = symbols.slice(index, index + batchSize);
        const results = await Promise.allSettled(
            batch.map((symbol) => fetchOpenInterestFrameSnapshot(symbol))
        );

        results.forEach((result, batchIndex) => {
            if (result.status === 'fulfilled' && result.value) {
                snapshotMap.set(batch[batchIndex].toUpperCase(), result.value);
            }
        });

        if (index + batchSize < symbols.length) {
            await new Promise((resolve) => setTimeout(resolve, 50));
        }
    }

    return snapshotMap;
}
