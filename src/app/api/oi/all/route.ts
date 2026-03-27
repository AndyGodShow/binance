import { NextResponse } from 'next/server';
import { fetchBinanceJson } from '@/lib/binanceApi';
import { logger } from '@/lib/logger';

// Keep a short live cache plus a stale snapshot so repeat visits can render immediately.
let liveCache: { time: number; data: Record<string, string> } | null = null;
let lastSuccessfulData: Record<string, string> | null = null;
let lastSuccessfulAt = 0;
let inflightBuild: Promise<Record<string, string>> | null = null;
const LIVE_CACHE_DURATION = 15000;

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

function isBinanceTicker24h(value: unknown): value is BinanceTicker24h {
    return typeof value === 'object' &&
        value !== null &&
        typeof (value as BinanceTicker24h).symbol === 'string';
}

async function buildOpenInterestMap(): Promise<Record<string, string>> {
    // 1. Prefer exchangeInfo so we only query active perpetual contracts.
    let activeSymbols: string[] = [];
    const exchangeInfo = await fetchBinanceJson<BinanceExchangeInfoResponse>(
        '/fapi/v1/exchangeInfo',
        { revalidate: 86400 }
    ).catch(() => null);

    if (exchangeInfo && Array.isArray(exchangeInfo.symbols)) {
        activeSymbols = exchangeInfo.symbols
            .filter((s) => s.contractType === 'PERPETUAL' && s.status === 'TRADING' && s.symbol.endsWith('USDT'))
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

    // 2. Batch fetch OI with moderate concurrency to reduce rate limits.
    const chunkArray = (arr: string[], size: number) => {
        return Array.from({ length: Math.ceil(arr.length / size) }, (_, i) =>
            arr.slice(i * size, i * size + size)
        );
    };

    const chunks = chunkArray(activeSymbols, 20);
    const oiData: Record<string, string> = {};

    for (const chunk of chunks) {
        const promises = chunk.map((s: string) =>
            fetchBinanceJson<{ openInterest?: string }>(`/fapi/v1/openInterest?symbol=${s}`, { revalidate: 60 })
                .then((d) => ({ symbol: s, oi: typeof d.openInterest === 'string' ? d.openInterest : '0' }))
                .catch(() => ({ symbol: s, oi: '0' }))
        );
        const batchResults = await Promise.all(promises);
        batchResults.forEach(r => {
            if (r.oi) oiData[r.symbol] = r.oi;
        });
        await new Promise(r => setTimeout(r, 25));
    }

    liveCache = { time: Date.now(), data: oiData };
    lastSuccessfulData = oiData;
    lastSuccessfulAt = Date.now();
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
        return NextResponse.json(liveCache.data, {
            headers: {
                'Cache-Control': 'public, s-maxage=15, stale-while-revalidate=30',
                'X-Data-Source': 'memory-cache',
            }
        });
    }

    if (lastSuccessfulData && Object.keys(lastSuccessfulData).length > 0) {
        void ensureOpenInterestBuild().catch((error) => {
            logger.error('Background open interest refresh failed', error as Error);
        });

        return NextResponse.json(lastSuccessfulData, {
            headers: {
                'Cache-Control': 'public, s-maxage=15, stale-while-revalidate=30',
                'X-Data-Source': 'stale-memory-cache-refreshing',
                'X-Cache-Age-Seconds': Math.floor((Date.now() - lastSuccessfulAt) / 1000).toString(),
            }
        });
    }

    const ownsInflight = !inflightBuild;
    try {
        const data = await ensureOpenInterestBuild();
        return NextResponse.json(data, {
            headers: {
                'Cache-Control': 'public, s-maxage=15, stale-while-revalidate=30',
                'X-Data-Source': ownsInflight ? 'live' : 'live-coalesced',
            }
        });
    } catch (error) {
        logger.error('Failed to fetch open interest data', error as Error);
        if (lastSuccessfulData && Object.keys(lastSuccessfulData).length > 0) {
            return NextResponse.json(lastSuccessfulData, {
                headers: {
                    'Cache-Control': 'public, s-maxage=15, stale-while-revalidate=30',
                    'X-Data-Source': 'stale-memory-cache',
                    'X-Cache-Age-Seconds': Math.floor((Date.now() - lastSuccessfulAt) / 1000).toString(),
                }
            });
        }
        return NextResponse.json({}, {
            headers: {
                'Cache-Control': 'public, s-maxage=5, stale-while-revalidate=15',
                'X-Data-Source': 'empty-fallback',
            }
        });
    }
}
