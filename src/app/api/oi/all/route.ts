import { NextResponse } from 'next/server';
import { fetchBinanceJson } from '@/lib/binanceApi';
import { withTimeout } from '@/lib/async';
import { logger } from '@/lib/logger';
import { buildOpenInterestAllPayload, buildQualityHeaders } from '@/lib/dataQualityStatus';

// Keep a short live cache plus a stale snapshot so repeat visits can render immediately.
let liveCache: { time: number; data: Record<string, string> } | null = null;
let lastSuccessfulData: Record<string, string> | null = null;
let lastSuccessfulAt = 0;
let inflightBuild: Promise<Record<string, string>> | null = null;
let warmupFallbackData: Record<string, string> | null = null;
let warmupFallbackAt = 0;
const LIVE_CACHE_DURATION = 15000;
const BUILD_TIMEOUT_MS = 12000;
const OPEN_INTEREST_CHUNK_SIZE = 5;
const OPEN_INTEREST_SYMBOL_LIMIT = process.env.NODE_ENV === 'production' ? 0 : Number.POSITIVE_INFINITY;
const OPEN_INTEREST_ROUTE_DATA_QUALITY = Number.isFinite(OPEN_INTEREST_SYMBOL_LIMIT) ? 'partial' : 'enriched';
const OPEN_INTEREST_FAILURE_BATCH_LIMIT = process.env.NODE_ENV === 'development' ? 1 : 3;

interface BinanceTicker24h {
    symbol: string;
}

interface BinanceExchangeInfoSymbol {
    symbol: string;
    contractType: string;
    status: string;
}

interface BinanceExchangeInfoResponse {
    symbols: BinanceExchangeInfoSymbol[];
}

interface OpenInterestFetchResult {
    symbol: string;
    oi: string;
    failed: boolean;
}

function isBinanceTicker24h(value: unknown): value is BinanceTicker24h {
    return typeof value === 'object' &&
        value !== null &&
        typeof (value as BinanceTicker24h).symbol === 'string';
}

async function buildOpenInterestMap(): Promise<Record<string, string>> {
    if (OPEN_INTEREST_SYMBOL_LIMIT === 0) {
        return {};
    }

    // 1. Prefer exchangeInfo so we only query active perpetual contracts.
    let activeSymbols: string[] = [];
    const exchangeInfo = await fetchBinanceJson<BinanceExchangeInfoResponse>(
        '/fapi/v1/exchangeInfo?v=2',
        { revalidate: 3600 }
    ).catch(() => null);

    if (exchangeInfo && Array.isArray(exchangeInfo.symbols)) {
        activeSymbols = exchangeInfo.symbols
            .filter((s) => (s.contractType === 'PERPETUAL' || s.contractType === 'TRADIFI_PERPETUAL') && s.status === 'TRADING' && s.symbol.endsWith('USDT'))
            .map((s) => s.symbol);
    } else {
        const tickers = await fetchBinanceJson<unknown>('/fapi/v1/ticker/24hr', { revalidate: 30 });
        if (!Array.isArray(tickers)) {
            throw new Error('Unexpected ticker response from Binance');
        }

        activeSymbols = tickers
            .filter(isBinanceTicker24h)
            .filter((t) => t.symbol.endsWith('USDT'))
            .map((t) => t.symbol);
    }

    activeSymbols = activeSymbols.slice(0, OPEN_INTEREST_SYMBOL_LIMIT);

    // 2. Batch fetch OI with conservative concurrency to reduce rate limits and memory pressure.
    const chunkArray = (arr: string[], size: number) => {
        return Array.from({ length: Math.ceil(arr.length / size) }, (_, i) =>
            arr.slice(i * size, i * size + size)
        );
    };

    const chunks = chunkArray(activeSymbols, OPEN_INTEREST_CHUNK_SIZE);
    const oiData: Record<string, string> = {};
    let failedBatches = 0;

    for (const chunk of chunks) {
        const promises = chunk.map((s: string): Promise<OpenInterestFetchResult> =>
            fetchBinanceJson<{ openInterest?: string }>(`/fapi/v1/openInterest?symbol=${s}`, { revalidate: 60 })
                .then((d) => ({ symbol: s, oi: typeof d.openInterest === 'string' ? d.openInterest : '0', failed: false }))
                .catch(() => ({ symbol: s, oi: '0', failed: true }))
        );
        const batchResults = await Promise.all(promises);
        const batchFailed = batchResults.every((result) => result.failed);
        batchResults.forEach(r => {
            if (r.oi) oiData[r.symbol] = r.oi;
        });

        failedBatches = batchFailed ? failedBatches + 1 : 0;
        if (failedBatches >= OPEN_INTEREST_FAILURE_BATCH_LIMIT) {
            break;
        }

        if (!lastSuccessfulData && Object.keys(oiData).length > 0) {
            const snapshot = { ...oiData };
            warmupFallbackData = snapshot;
            warmupFallbackAt = Date.now();
        }

        await new Promise(r => setTimeout(r, 25));
    }

    liveCache = { time: Date.now(), data: oiData };
    lastSuccessfulData = oiData;
    lastSuccessfulAt = Date.now();
    warmupFallbackData = null;
    warmupFallbackAt = 0;
    return oiData;
}

function ensureOpenInterestBuild(): Promise<Record<string, string>> {
    if (!inflightBuild) {
        inflightBuild = buildOpenInterestMap().finally(() => {
            inflightBuild = null;
        });
    }

    return inflightBuild;
}

export async function GET() {
    const now = Date.now();
    if (liveCache && (now - liveCache.time < LIVE_CACHE_DURATION)) {
        return NextResponse.json(buildOpenInterestAllPayload({
            data: liveCache.data,
            dataQuality: OPEN_INTEREST_ROUTE_DATA_QUALITY,
            buildState: 'ready',
            dataSource: 'memory-cache',
            updatedAt: liveCache.time,
        }), {
            headers: {
                'Cache-Control': 'public, s-maxage=15, stale-while-revalidate=30',
                ...buildQualityHeaders({
                    dataQuality: OPEN_INTEREST_ROUTE_DATA_QUALITY,
                    buildState: 'ready',
                    dataSource: 'memory-cache',
                    updatedAt: liveCache.time,
                }),
            }
        });
    }

    if (lastSuccessfulData && Object.keys(lastSuccessfulData).length > 0) {
        void ensureOpenInterestBuild().catch((error) => {
            logger.error('Background open interest refresh failed', error as Error);
        });

        const cacheAgeSeconds = Math.floor((Date.now() - lastSuccessfulAt) / 1000);
        return NextResponse.json(buildOpenInterestAllPayload({
            data: lastSuccessfulData,
            dataQuality: 'stale',
            buildState: 'stale',
            dataSource: 'stale-memory-cache-refreshing',
            isStale: true,
            updatedAt: lastSuccessfulAt,
            cacheAgeSeconds,
        }), {
            headers: {
                'Cache-Control': 'public, s-maxage=15, stale-while-revalidate=30',
                ...buildQualityHeaders({
                    dataQuality: 'stale',
                    buildState: 'stale',
                    dataSource: 'stale-memory-cache-refreshing',
                    isStale: true,
                    updatedAt: lastSuccessfulAt,
                    cacheAgeSeconds,
                }),
            }
        });
    }

    if (warmupFallbackData && Object.keys(warmupFallbackData).length > 0) {
        void ensureOpenInterestBuild().catch((error) => {
            logger.error('Background open interest warmup refresh failed', error as Error);
        });

        const cacheAgeSeconds = Math.floor((Date.now() - warmupFallbackAt) / 1000);
        return NextResponse.json(buildOpenInterestAllPayload({
            data: warmupFallbackData,
            dataQuality: 'partial',
            buildState: 'building',
            dataSource: 'warmup-partial-cache',
            isFallback: true,
            updatedAt: warmupFallbackAt,
            cacheAgeSeconds,
        }), {
            headers: {
                'Cache-Control': 'public, s-maxage=5, stale-while-revalidate=15',
                ...buildQualityHeaders({
                    dataQuality: 'partial',
                    buildState: 'building',
                    dataSource: 'warmup-partial-cache',
                    isFallback: true,
                    updatedAt: warmupFallbackAt,
                    cacheAgeSeconds,
                }),
            }
        });
    }

    const ownsInflight = !inflightBuild;
    try {
        const data = await withTimeout(
            ensureOpenInterestBuild(),
            BUILD_TIMEOUT_MS,
            'open interest build'
        );
        const dataQuality = Object.keys(data).length > 0 ? OPEN_INTEREST_ROUTE_DATA_QUALITY : 'unavailable';
        return NextResponse.json(buildOpenInterestAllPayload({
            data,
            dataQuality,
            buildState: Object.keys(data).length > 0 ? 'ready' : 'failed',
            dataSource: ownsInflight ? 'live' : 'live-coalesced',
            isFallback: Object.keys(data).length === 0,
            errorKind: Object.keys(data).length > 0 ? undefined : 'empty_response',
            updatedAt: Date.now(),
        }), {
            headers: {
                'Cache-Control': 'public, s-maxage=15, stale-while-revalidate=30',
                ...buildQualityHeaders({
                    dataQuality,
                    buildState: Object.keys(data).length > 0 ? 'ready' : 'failed',
                    dataSource: ownsInflight ? 'live' : 'live-coalesced',
                    isFallback: Object.keys(data).length === 0,
                    errorKind: Object.keys(data).length > 0 ? undefined : 'empty_response',
                    updatedAt: Date.now(),
                }),
            }
        });
    } catch (error) {
        logger.error('Failed to fetch open interest data', error as Error);
        if (lastSuccessfulData && Object.keys(lastSuccessfulData).length > 0) {
            const cacheAgeSeconds = Math.floor((Date.now() - lastSuccessfulAt) / 1000);
            return NextResponse.json(buildOpenInterestAllPayload({
                data: lastSuccessfulData,
                dataQuality: 'stale',
                buildState: 'stale',
                dataSource: 'stale-memory-cache-timeout',
                isStale: true,
                errorKind: 'timeout',
                updatedAt: lastSuccessfulAt,
                cacheAgeSeconds,
            }), {
                headers: {
                    'Cache-Control': 'public, s-maxage=15, stale-while-revalidate=30',
                    ...buildQualityHeaders({
                        dataQuality: 'stale',
                        buildState: 'stale',
                        dataSource: 'stale-memory-cache-timeout',
                        isStale: true,
                        errorKind: 'timeout',
                        updatedAt: lastSuccessfulAt,
                        cacheAgeSeconds,
                    }),
                }
            });
        }
        if (warmupFallbackData && Object.keys(warmupFallbackData).length > 0) {
            const cacheAgeSeconds = Math.floor((Date.now() - warmupFallbackAt) / 1000);
            return NextResponse.json(buildOpenInterestAllPayload({
                data: warmupFallbackData,
                dataQuality: 'partial',
                buildState: 'building',
                dataSource: 'warmup-partial-cache-timeout',
                isFallback: true,
                errorKind: 'timeout',
                updatedAt: warmupFallbackAt,
                cacheAgeSeconds,
            }), {
                headers: {
                    'Cache-Control': 'public, s-maxage=5, stale-while-revalidate=15',
                    ...buildQualityHeaders({
                        dataQuality: 'partial',
                        buildState: 'building',
                        dataSource: 'warmup-partial-cache-timeout',
                        isFallback: true,
                        errorKind: 'timeout',
                        updatedAt: warmupFallbackAt,
                        cacheAgeSeconds,
                    }),
                }
            });
        }
        return NextResponse.json(buildOpenInterestAllPayload({
            data: {},
            dataQuality: 'unavailable',
            buildState: 'failed',
            dataSource: 'empty-fallback',
            isFallback: true,
            errorKind: 'upstream_error',
            updatedAt: Date.now(),
        }), {
            headers: {
                'Cache-Control': 'public, s-maxage=5, stale-while-revalidate=15',
                ...buildQualityHeaders({
                    dataQuality: 'unavailable',
                    buildState: 'failed',
                    dataSource: 'empty-fallback',
                    isFallback: true,
                    errorKind: 'upstream_error',
                    updatedAt: Date.now(),
                }),
            }
        });
    }
}
