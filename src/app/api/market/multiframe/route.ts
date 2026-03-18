import { NextResponse } from 'next/server';
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

let cache: { expiresAt: number; data: MultiframeData } | null = null;
let inflightBuild: Promise<MultiframeData> | null = null;

function getNextQuarterHourBoundary(now: number): number {
    const intervalMs = 15 * 60 * 1000;
    return (Math.floor(now / intervalMs) + 1) * intervalMs;
}

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
            const klines = await fetchBinanceJson<unknown>(`/fapi/v1/klines?symbol=${symbol}&interval=15m&limit=17`, { revalidate: 60 });
            if (!Array.isArray(klines) || klines.length === 0) {
                return { symbol, o15m: 0, o1h: 0, o4h: 0 };
            }

            const lastIdx = klines.length - 1;
            const idx1h = Math.max(0, lastIdx - 4);
            const idx4h = Math.max(0, lastIdx - 16);

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
        Array.from({ length: Math.ceil(arr.length / size) }, (v, i) => arr.slice(i * size, i * size + size));

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
            await new Promise(resolve => setTimeout(resolve, 20));
        }
    }

    cache = {
        data: resultData,
        expiresAt: getNextQuarterHourBoundary(Date.now()),
    };

    return resultData;
}

export async function GET() {
    const now = Date.now();
    if (cache && now < cache.expiresAt) {
        return NextResponse.json(cache.data, {
            headers: {
                'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=120',
                'X-Data-Source': 'memory-cache',
            }
        });
    }

    const ownsInflight = !inflightBuild;
    if (!inflightBuild) {
        inflightBuild = buildMultiframeData();
    }

    try {
        const data = await inflightBuild;
        return NextResponse.json(data, {
            headers: {
                'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=120',
                'X-Data-Source': ownsInflight ? 'live' : 'live-coalesced',
            }
        });
    } catch (error) {
        logger.error('Failed to fetch multiframe market data', error as Error);
        if (cache && Object.keys(cache.data).length > 0) {
            return NextResponse.json(cache.data, {
                headers: {
                    'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=120',
                    'X-Data-Source': 'stale-memory-cache',
                }
            });
        }
        return NextResponse.json({}, {
            headers: {
                'Cache-Control': 'public, s-maxage=5, stale-while-revalidate=15',
                'X-Data-Source': 'empty-fallback',
            }
        });
    } finally {
        if (ownsInflight) {
            inflightBuild = null;
        }
    }
}
