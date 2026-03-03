import { NextResponse } from 'next/server';
import { fetchBinance } from '@/lib/binanceApi';

// Simple in-memory cache to prevent hitting rate limits
let cache: { time: number; data: Record<string, string> } | null = null;
const CACHE_DURATION = 120000; // 2 minutes cache for full list (extended for all symbols)

export async function GET() {
    const now = Date.now();
    if (cache && (now - cache.time < CACHE_DURATION)) {
        return NextResponse.json(cache.data);
    }

    try {
        // 1. Get all symbols first (lightweight)
        const infoRes = await fetchBinance('/fapi/v1/ticker/24hr', { revalidate: 30 });
        if (!infoRes.ok) throw new Error('Failed to fetch tickers');
        const tickers = await infoRes.json();

        // 2. Monitor ALL USDT pairs to detect unusual OI changes (important for moonshot detection)
        const activeSymbols = tickers
            .filter((t: { symbol: string }) => t.symbol.endsWith('USDT'))
            .map((t: { symbol: string }) => t.symbol);

        // 3. Batch fetch OI (Concurrency control)
        // Fetch in batches of 25 (concurrency)
        const chunkArray = (arr: string[], size: number) => {
            return Array.from({ length: Math.ceil(arr.length / size) }, (v, i) =>
                arr.slice(i * size, i * size + size)
            );
        }

        const chunks = chunkArray(activeSymbols, 50); // Higher concurrency for full coverage
        const oiData: Record<string, string> = {};

        for (const chunk of chunks) {
            const promises = chunk.map((s: string) =>
                fetchBinance(`/fapi/v1/openInterest?symbol=${s}`, { revalidate: 60 })
                    .then(r => r.json())
                    .then(d => ({ symbol: s, oi: d.openInterest }))
                    .catch(() => ({ symbol: s, oi: '0' }))
            );
            const batchResults = await Promise.all(promises);
            batchResults.forEach(r => {
                if (r.oi) oiData[r.symbol] = r.oi;
            });
            // Minimal delay for faster response
            await new Promise(r => setTimeout(r, 10));
        }

        cache = { time: Date.now(), data: oiData };
        return NextResponse.json(oiData, {
            headers: {
                'Cache-Control': 'public, s-maxage=15, stale-while-revalidate=30',
            }
        });

    } catch (error) {
        console.error(error);
        return NextResponse.json({});
    }
}
