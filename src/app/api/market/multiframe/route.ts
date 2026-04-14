import { NextResponse } from 'next/server';
import { unstable_cache } from 'next/cache';
import { withTimeout } from '@/lib/async';
import { fetchBinanceJson } from '@/lib/binanceApi';
import { logger } from '@/lib/logger';

interface KlineResult {
    symbol: string;
    o15m: number;
    o1h: number;
    o4h: number;
}

type MultiframeData = Record<string, { o15m: number, o1h: number, o4h: number }>;

export const dynamic = 'force-dynamic';
export const maxDuration = 60; // Max duration for Vercel

const BUILD_TIMEOUT_MS = 25000;
const CUSTOM_SYMBOL_TIMEOUT_MS = 15000;

function parseRequestedSymbols(searchParams: URLSearchParams): string[] | null {
    const raw = searchParams.get('symbols');
    if (!raw) {
        return null;
    }

    const symbols = raw
        .split(',')
        .map((symbol) => symbol.trim().toUpperCase())
        .filter(Boolean);

    return symbols.length > 0 ? Array.from(new Set(symbols)) : null;
}

async function buildMultiframeData(requestedSymbols?: string[]): Promise<MultiframeData> {
    // 1. Prefer exchangeInfo so we only query active perpetual contracts.
    let targetSymbols: string[] = [];
    // Fetch tickers immediately to get volume and symbols. We prioritize high-volume contracts.
    let tickers: { symbol: string, quoteVolume: string }[] = [];
    try {
        tickers = await fetchBinanceJson<{ symbol: string, quoteVolume: string }[]>('/fapi/v1/ticker/24hr', { init: { cache: 'no-store' } });
    } catch {
        tickers = [];
    }

    try {
        const info = await fetchBinanceJson<{ symbols: { symbol: string; status: string; contractType: string }[] }>(
            '/fapi/v1/exchangeInfo?v=2',
            { init: { cache: 'no-store' } } // Skip redundant inner caching
        );
        
        // Allowed contracts filter
        const allowedMap = new Set(
            info.symbols
                .filter(s => s.status === 'TRADING' && (s.contractType === 'PERPETUAL' || s.contractType === 'TRADIFI_PERPETUAL') && s.symbol.endsWith('USDT'))
                .map(s => s.symbol)
        );

        if (requestedSymbols && requestedSymbols.length > 0) {
            targetSymbols = requestedSymbols.filter((symbol) => allowedMap.has(symbol));
        } else {
            targetSymbols = tickers
                .filter(t => allowedMap.has(t.symbol))
                .sort((a, b) => parseFloat(b.quoteVolume || '0') - parseFloat(a.quoteVolume || '0'))
                .map(t => t.symbol);
        }

    } catch {
        // Fallback if exchangeInfo fails
        if (requestedSymbols && requestedSymbols.length > 0) {
            targetSymbols = requestedSymbols.filter((symbol) => symbol.endsWith('USDT'));
        } else {
            targetSymbols = tickers
                .filter(t => t.symbol.endsWith('USDT'))
                .sort((a, b) => parseFloat(b.quoteVolume || '0') - parseFloat(a.quoteVolume || '0'))
                .map(t => t.symbol);
        }
    }

    if (!requestedSymbols || requestedSymbols.length === 0) {
        // Default full-dataset requests still keep a cap to avoid edge runtimes timing out.
        targetSymbols = targetSymbols.slice(0, 320);
    }

    const fetchSymbolData = async (symbol: string): Promise<KlineResult> => {
        try {
            // 获取18根K线 (当前1根 + 历史17根)，确保足够看16根之前的数据 (4小时 = 16 * 15m)
            const klines = await fetchBinanceJson<unknown>(`/fapi/v1/klines?symbol=${symbol}&interval=15m&limit=18`, { init: { cache: 'no-store' } });
            if (!Array.isArray(klines) || klines.length === 0) {
                return { symbol, o15m: 0, o1h: 0, o4h: 0 };
            }

            const currentIdx = klines.length - 1;
            const openCurrent = parseFloat(klines[currentIdx][1]);

            // 1小时前开盘价 = 历史数组中倒数第5根的开盘价 (idx - 4)  (4个15m = 1h)
            const idx1h = Math.max(0, currentIdx - 4);
            // 4小时前开盘价 = 历史数组中倒数第17根的开盘价 (idx - 16) (16个15m = 4h)
            const idx4h = Math.max(0, currentIdx - 16);

            const open1h = parseFloat(klines[idx1h][1]);
            const open4h = parseFloat(klines[idx4h][1]);

            return {
                symbol,
                o15m: openCurrent,
                o1h: open1h,
                o4h: open4h
            };
        } catch {
            return { symbol, o15m: 0, o1h: 0, o4h: 0 };
        }
    };

    const chunkArray = (arr: string[], size: number) =>
        Array.from({ length: Math.ceil(arr.length / size) }, (_, i) => arr.slice(i * size, i * size + size));

    const chunkSize = requestedSymbols && requestedSymbols.length > 0 ? 40 : 100;
    const chunks = chunkArray(targetSymbols, chunkSize);
    const resultData: MultiframeData = {};

    for (const chunk of chunks) {
        const promises = chunk.map(s => fetchSymbolData(s));
        const results = await Promise.all(promises);
        results.forEach(r => {
            if (r.o15m !== 0) {
                resultData[r.symbol] = {
                    o15m: r.o15m,
                    o1h: r.o1h,
                    o4h: r.o4h
                };
            }
        });

        if (chunk !== chunks[chunks.length - 1]) {
            await new Promise(resolve => setTimeout(resolve, requestedSymbols ? 40 : 20)); // brief pause
        }
    }

    return resultData;
}

const getCachedMultiframeData = unstable_cache(
    async () => {
        return await buildMultiframeData();
    },
    ['api-multiframe-data-v3'],
    { revalidate: 60 }
);

export async function GET(request: Request) {
    const requestedSymbols = parseRequestedSymbols(new URL(request.url).searchParams);
    if (requestedSymbols && requestedSymbols.length > 0) {
        try {
            const data = await withTimeout(
                buildMultiframeData(requestedSymbols),
                CUSTOM_SYMBOL_TIMEOUT_MS,
                'multiframe batch build'
            );

            return NextResponse.json(data, {
                headers: {
                    'Cache-Control': 'public, s-maxage=15, stale-while-revalidate=30',
                    'X-Data-Source': 'symbols-batch',
                }
            });
        } catch (error) {
            logger.error('Failed to fetch batched multiframe market data', error as Error);
            return NextResponse.json({}, {
                headers: {
                    'Cache-Control': 'no-store, max-age=0',
                    'X-Data-Source': 'symbols-batch-error',
                }
            });
        }
    }

    try {
        const data = await withTimeout(
            getCachedMultiframeData(),
            BUILD_TIMEOUT_MS,
            'multiframe build'
        );
        return NextResponse.json(data, {
            headers: {
                'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=120',
                'X-Data-Source': 'next-unstable-cache',
            }
        });
    } catch (error) {
        logger.error('Failed to fetch multiframe market data', error as Error);
        // Do not cache the empty response if it times out
        return NextResponse.json({}, {
            headers: {
                'Cache-Control': 'no-store, max-age=0',
                'X-Data-Source': 'empty-fallback-timeout',
            }
        });
    }
}
