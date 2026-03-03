import { NextResponse } from 'next/server';
import { fetchBinance } from '@/lib/binanceApi';

// Define types
interface Ticker {
    symbol: string;
    quoteVolume: string;
}

interface KlineResult {
    symbol: string;
    o15m: number;
    o1h: number;
    o4h: number;
}

// In-memory cache with extended duration for full coverage
let cache: { time: number; data: Record<string, { o15m: number, o1h: number, o4h: number }> } | null = null;
const CACHE_DURATION = 600000; // 10 minutes cache (longer for all symbols)

export async function GET() {
    const now = Date.now();
    if (cache && (now - cache.time < CACHE_DURATION)) {
        return NextResponse.json(cache.data);
    }

    try {
        // 1. Get Tickers (All)
        const tickerRes = await fetchBinance('/fapi/v1/ticker/24hr', { revalidate: 30 });
        if (!tickerRes.ok) throw new Error('Failed to fetch tickers');
        const tickers: Ticker[] = await tickerRes.json();

        // 2. Monitor ALL USDT pairs to catch sudden movements in small-cap tokens
        const targetSymbols = tickers
            .filter((t) => t.symbol.endsWith('USDT'))
            .map((t) => t.symbol);

        // 3. Batch Fetch Optimization
        // Fetch 15m klines with limit=17.
        // Index 16 (last) = Current candle (Open time T)
        // Index 12 = T - 4*15m = T - 1h (1h ago)
        // Index 0 = T - 16*15m = T - 4h (4h ago)

        const fetchSymbolData = async (symbol: string): Promise<KlineResult> => {
            try {
                const res = await fetchBinance(`/fapi/v1/klines?symbol=${symbol}&interval=15m&limit=17`, { revalidate: 60 });
                if (!res.ok) throw new Error('Failed');
                const klines = await res.json();

                // Binance returns oldest first.
                // If limit=17, klines[16] is the latest (current).
                // klines[12] is 4 candles back (1h ago).
                // klines[0] is 16 candles back (4h ago).


                if (klines.length === 0) {
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

        // Chunking with concurrency control
        // OPTIMIZED: ~300 symbols / 50 = 6 batches. 6 * 20ms = 120ms delay.
        const chunkArray = (arr: string[], size: number) =>
            Array.from({ length: Math.ceil(arr.length / size) }, (v, i) => arr.slice(i * size, i * size + size));

        const chunks = chunkArray(targetSymbols, 50); // Higher concurrency for full coverage
        const resultData: Record<string, { o15m: number, o1h: number, o4h: number }> = {};

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
            // Minimal delay (20ms) - still safe but faster
            await new Promise(resolve => setTimeout(resolve, 20));
        }

        cache = { time: Date.now(), data: resultData };
        return NextResponse.json(resultData, {
            headers: {
                'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=120',
            }
        });

    } catch (error) {
        console.error(error);
        return NextResponse.json({});
    }
}
