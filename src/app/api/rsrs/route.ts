import { NextResponse } from 'next/server';
import { withTimeout } from '@/lib/async';
import { fetchBinanceJson } from '@/lib/binanceApi';
import { calculateRsrsMetrics, type RsrsMetrics } from '@/lib/rsrs';
import { buildQualityHeaders } from '@/lib/dataQualityStatus';

// RSRS now uses adaptive window, no fixed N_DAYS/M_DAYS needed

interface BinanceTicker24h {
    symbol: string;
    quoteVolume: string;
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

function isBinanceTicker24h(value: unknown): value is BinanceTicker24h {
    return typeof value === 'object' &&
        value !== null &&
        typeof (value as BinanceTicker24h).symbol === 'string' &&
        typeof (value as BinanceTicker24h).quoteVolume === 'string';
}

function isBinanceKline(value: unknown): value is BinanceKline {
    return Array.isArray(value) &&
        value.length >= 11 &&
        typeof value[0] === 'number' &&
        typeof value[1] === 'string' &&
        typeof value[2] === 'string' &&
        typeof value[3] === 'string' &&
        typeof value[4] === 'string' &&
        typeof value[5] === 'string';
}

// RSRS Stale Cache for fallback when API times out (very common with heavy math)
type RsrsMap = Record<string, RsrsMetrics>;

let rsrsStaleCache: RsrsMap | null = null;
let rsrsLiveCache: { data: RsrsMap; updatedAt: number; expiresAt: number } | null = null;
let inflightRsrsBuild: Promise<RsrsMap> | null = null;
let rsrsWarmupCache: { data: RsrsMap; updatedAt: number; expiresAt: number } | null = null;

const RSRS_CACHE_TTL = 60 * 60 * 1000;
const RSRS_BUILD_TIMEOUT_MS = 15000;

async function buildRsrsData(): Promise<RsrsMap> {
    // 1. Fetch all tickers to find top volume assets
    const allTickers = await fetchBinanceJson<unknown>('/fapi/v1/ticker/24hr', { revalidate: 300 });
    if (!Array.isArray(allTickers)) {
        throw new Error('Unexpected ticker response from Binance');
    }

    // Filter USDT pairs and sort by Quote Volume (descending)
    // Limit to top 30 to avoid timeout/rate limits
    const topTickers = allTickers
        .filter(isBinanceTicker24h)
        .filter((t) => t.symbol.endsWith('USDT'))
        .sort((a: BinanceTicker24h, b: BinanceTicker24h) => parseFloat(b.quoteVolume) - parseFloat(a.quoteVolume))
        .slice(0, 30);

    const rsrsMap: RsrsMap = {};

    // 2. Fetch history and calculate RSRS for each
    // Use larger buffer to accommodate adaptive window (max 30 days + 100 days history + buffer)
    const TOTAL_CANDLES = 150;

    // We run in parallel but limited batches to be nice to API
    const batchSize = 5;
    for (let i = 0; i < topTickers.length; i += batchSize) {
        const batch = topTickers.slice(i, i + batchSize);
        const promises = batch.map(async (t: BinanceTicker24h) => {
            try {
                const rawKlines = await fetchBinanceJson<unknown>(
                    `/fapi/v1/klines?symbol=${t.symbol}&interval=1d&limit=${TOTAL_CANDLES}`,
                    { revalidate: 3600 } // Cache for 1 hour
                );

                if (!Array.isArray(rawKlines)) {
                    return;
                }

                const klines = rawKlines.filter(isBinanceKline);
                if (klines.length >= 40) { // Minimum data requirement
                    const result = calculateRSRS(klines);
                    if (result) {
                        rsrsMap[t.symbol] = result;
                    }
                }
            } catch (e) {
                console.error(`Failed to calc RSRS for ${t.symbol}`, e);
            }
        });
        await Promise.all(promises);

        if (!rsrsLiveCache && Object.keys(rsrsMap).length > 0) {
            const partialSnapshot = { ...rsrsMap };
            rsrsWarmupCache = {
                data: partialSnapshot,
                updatedAt: Date.now(),
                expiresAt: Date.now() + RSRS_CACHE_TTL,
            };
        }
    }

    rsrsStaleCache = rsrsMap;
    rsrsLiveCache = {
        data: rsrsMap,
        updatedAt: Date.now(),
        expiresAt: Date.now() + RSRS_CACHE_TTL,
    };
    rsrsWarmupCache = null;

    return rsrsMap;
}

function ensureRsrsBuild(): Promise<RsrsMap> {
    if (!inflightRsrsBuild) {
        inflightRsrsBuild = buildRsrsData().finally(() => {
            inflightRsrsBuild = null;
        });
    }

    return inflightRsrsBuild;
}

function calculateRSRS(klines: BinanceKline[]): RsrsMetrics | null {
    return calculateRsrsMetrics(
        klines.map((kline) => ({
            high: parseFloat(kline[2]),
            low: parseFloat(kline[3]),
            close: parseFloat(kline[4]),
            volume: parseFloat(kline[5]),
        })),
        { fallbackOnInsufficientHistory: true },
    );
}

export async function GET() {
    const now = Date.now();

    if (rsrsLiveCache && now < rsrsLiveCache.expiresAt) {
        return NextResponse.json(rsrsLiveCache.data, {
            headers: {
                'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=7200',
                ...buildQualityHeaders({
                    dataQuality: 'enriched',
                    buildState: 'ready',
                    dataSource: 'memory-cache',
                    updatedAt: rsrsLiveCache.updatedAt,
                }),
            }
        });
    }

    if (rsrsLiveCache && Object.keys(rsrsLiveCache.data).length > 0) {
        void ensureRsrsBuild().catch((error) => {
            console.error('RSRS background refresh failed:', error);
        });

        return NextResponse.json(rsrsLiveCache.data, {
            headers: {
                'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=7200',
                ...buildQualityHeaders({
                    dataQuality: 'stale',
                    buildState: 'building',
                    dataSource: 'stale-memory-cache-refreshing',
                    isStale: true,
                    cacheAgeSeconds: Math.floor((now - rsrsLiveCache.updatedAt) / 1000),
                    updatedAt: rsrsLiveCache.updatedAt,
                }),
            }
        });
    }

    if (rsrsWarmupCache && Object.keys(rsrsWarmupCache.data).length > 0) {
        void ensureRsrsBuild().catch((error) => {
            console.error('RSRS warmup background refresh failed:', error);
        });

        return NextResponse.json(rsrsWarmupCache.data, {
            headers: {
                'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600',
                ...buildQualityHeaders({
                    dataQuality: 'partial',
                    buildState: 'building',
                    dataSource: 'warmup-partial-cache',
                    isFallback: true,
                    cacheAgeSeconds: Math.floor((now - rsrsWarmupCache.updatedAt) / 1000),
                    updatedAt: rsrsWarmupCache.updatedAt,
                }),
            }
        });
    }

    try {
        const data = await withTimeout(
            ensureRsrsBuild(),
            RSRS_BUILD_TIMEOUT_MS,
            'rsrs build'
        );
        return NextResponse.json(data, {
            headers: {
                'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=7200',
                ...buildQualityHeaders({
                    dataQuality: Object.keys(data).length > 0 ? 'enriched' : 'unavailable',
                    buildState: Object.keys(data).length > 0 ? 'ready' : 'failed',
                    dataSource: 'live',
                    errorKind: Object.keys(data).length > 0 ? undefined : 'empty_response',
                    updatedAt: Date.now(),
                }),
            }
        });
    } catch (error) {
        console.error('RSRS API Error:', error);

        // Return stale data if available to prevent breaking the UI on timeout
        if (rsrsStaleCache && Object.keys(rsrsStaleCache).length > 0) {
            console.info('Returning RSRS stale cache due to error');
            return NextResponse.json(rsrsStaleCache, {
                headers: {
                    'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600',
                    ...buildQualityHeaders({
                        dataQuality: 'stale',
                        buildState: 'stale',
                        dataSource: 'stale-memory-cache',
                        isStale: true,
                        errorKind: 'timeout',
                        updatedAt: Date.now(),
                    }),
                }
            });
        }

        if (rsrsWarmupCache && Object.keys(rsrsWarmupCache.data).length > 0) {
            return NextResponse.json(rsrsWarmupCache.data, {
                headers: {
                    'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600',
                    ...buildQualityHeaders({
                        dataQuality: 'partial',
                        buildState: 'building',
                        dataSource: 'warmup-partial-cache-timeout',
                        isFallback: true,
                        errorKind: 'timeout',
                        cacheAgeSeconds: Math.floor((now - rsrsWarmupCache.updatedAt) / 1000),
                        updatedAt: rsrsWarmupCache.updatedAt,
                    }),
                }
            });
        }

        return NextResponse.json({ error: 'Failed to calculate RSRS' }, { status: 500 });
    }
}
