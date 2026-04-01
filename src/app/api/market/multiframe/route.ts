import { NextResponse } from 'next/server';
import { unstable_cache } from 'next/cache';
import { withTimeout } from '@/lib/async';
import { fetchBinanceJson } from '@/lib/binanceApi';
import { logger } from '@/lib/logger';

// Define types
interface Ticker {
    symbol: string;
    quoteVolume: string;
}

interface BinanceExchangeInfoSymbol {
    symbol: string;
    contractType: string;
    status: string;
}

interface BinanceExchangeInfoResponse {
    symbols: BinanceExchangeInfoSymbol[];
}

function isTicker(value: unknown): value is Ticker {
    return typeof value === 'object' &&
        value !== null &&
        typeof (value as Ticker).symbol === 'string' &&
        typeof (value as Ticker).quoteVolume === 'string';
}

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

async function buildMultiframeData(): Promise<MultiframeData> {
    // 1. Prefer exchangeInfo so we only query active perpetual contracts.
    let targetSymbols: string[] = [];
    try {
        const info = await fetchBinanceJson<{ symbols: { symbol: string; status: string; contractType: string }[] }>(
            '/fapi/v1/exchangeInfo',
            { init: { cache: 'no-store' } } // Skip redundant inner caching
        );
        targetSymbols = info.symbols
            .filter(s => s.status === 'TRADING' && (s.contractType === 'PERPETUAL' || s.contractType === 'TRADIFI_PERPETUAL') && s.symbol.endsWith('USDT'))
            .map(s => s.symbol);
    } catch {
        // Fallback to 24hr ticker to get symbols if exchangeInfo fails
        const tickers = await fetchBinanceJson<{ symbol: string }[]>('/fapi/v1/ticker/24hr', { init: { cache: 'no-store' } });
        targetSymbols = tickers.filter(t => t.symbol.endsWith('USDT')).map(t => t.symbol);
    }

    // Removed slice restriction to fetch data for all USDT perpetual contracts.
    // targetSymbols will dynamically contain all ~541 latest active trading pairs.

    const fetchSymbolData = async (symbol: string): Promise<KlineResult> => {
        try {
            // 获取18根K线 (当前1根 + 历史17根)，确保足够看16根之前的数据 (4小时 = 16 * 15m)
            const klines = await fetchBinanceJson<unknown>(`/fapi/v1/klines?symbol=${symbol}&interval=15m&limit=18`, { init: { cache: 'no-store' } });
            if (!Array.isArray(klines) || klines.length === 0) {
                return { symbol, o15m: 0, o1h: 0, o4h: 0 };
            }

            const currentIdx = klines.length - 1;
            const openCurrent = parseFloat(klines[currentIdx][1]);

            // 15分钟前开盘价 = 历史数组中倒数第2根的开盘价 (idx - 1)
            const idx15m = Math.max(0, currentIdx - 1);
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

    // Increase chunk size to 100 for significantly faster loading
    const chunks = chunkArray(targetSymbols, 100);
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
            await new Promise(resolve => setTimeout(resolve, 20)); // brief pause
        }
    }

    return resultData;
}

const getCachedMultiframeData = unstable_cache(
    async () => {
        return await buildMultiframeData();
    },
    ['api-multiframe-data-v2'],
    { revalidate: 60 }
);

export async function GET() {
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
