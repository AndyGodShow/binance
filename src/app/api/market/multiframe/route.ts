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

export const revalidate = 60; // Serverless cache duration
export const maxDuration = 15; // Setup max duration for vercel execution

const BUILD_TIMEOUT_MS = 12000;

async function buildMultiframeData(): Promise<MultiframeData> {
    // 1. Prefer exchangeInfo so we only query active perpetual contracts.
    let targetSymbols: string[] = [];
    const exchangeInfo = await fetchBinanceJson<BinanceExchangeInfoResponse>(
        '/fapi/v1/exchangeInfo',
        { revalidate: 86400 }
    ).catch(() => null);

    if (exchangeInfo && Array.isArray(exchangeInfo.symbols)) {
        targetSymbols = exchangeInfo.symbols
            .filter((s) => s.contractType === 'PERPETUAL' && s.status === 'TRADING' && s.symbol.endsWith('USDT'))
            .map((s) => s.symbol);
    } else {
        const tickerResponse = await fetchBinanceJson<unknown>('/fapi/v1/ticker/24hr', { revalidate: 30 });
        if (!Array.isArray(tickerResponse)) {
            throw new Error('Unexpected ticker response from Binance');
        }
        const tickers = tickerResponse.filter(isTicker);
        targetSymbols = tickers
            .filter((t) => t.symbol.endsWith('USDT'))
            .map((t) => t.symbol);
    }

    const fetchSymbolData = async (symbol: string): Promise<KlineResult> => {
        try {
            // 获取18根K线 (当前1根 + 历史17根)，确保足够看16根之前的数据 (4小时 = 16 * 15m)
            const klines = await fetchBinanceJson<unknown>(`/fapi/v1/klines?symbol=${symbol}&interval=15m&limit=18`, { revalidate: 60 });
            if (!Array.isArray(klines) || klines.length === 0) {
                return { symbol, o15m: 0, o1h: 0, o4h: 0 };
            }

            const lastIdx = klines.length - 1;
            const idx1h = Math.max(0, lastIdx - 4);
            const idx4h = Math.max(0, lastIdx - 16); // 现在 lastIdx 最大是 17，17 - 16 = 1，避免被截断到 0

            const openCurrent = parseFloat(klines[lastIdx][1]);
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

    const chunks = chunkArray(targetSymbols, 50);
    const resultData: MultiframeData = {};

    for (const chunk of chunks) {
        const promises = chunk.map(s => fetchSymbolData(s));
        const results = await Promise.all(promises);
        results.forEach(r => {
            if (r.o15m !== undefined) {
                resultData[r.symbol] = {
                    o15m: r.o15m,
                    o1h: r.o1h,
                    o4h: r.o4h
                };
            }
        });

        if (chunk !== chunks[chunks.length - 1]) {
            await new Promise(resolve => setTimeout(resolve, 30));
        }
    }

    return resultData;
}

const getCachedMultiframeData = unstable_cache(
    async () => {
        return await buildMultiframeData();
    },
    ['api-multiframe-data-v1'],
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
        return NextResponse.json({}, {
            headers: {
                'Cache-Control': 'public, s-maxage=5, stale-while-revalidate=15',
                'X-Data-Source': 'empty-fallback',
            }
        });
    }
}
