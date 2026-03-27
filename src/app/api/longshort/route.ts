import { NextRequest, NextResponse } from 'next/server';
import { fetchBinanceJson } from '@/lib/binanceApi';

interface BinanceLSEntry {
    symbol: string;
    longShortRatio: string;
    longAccount: string;
    shortAccount: string;
    timestamp: string;
}

interface BinanceTakerEntry {
    buySellRatio: string;
    buyVol: string;
    sellVol: string;
    timestamp: string;
}

interface LongShortResponseBody {
    global: Array<{ ratio: number; longPct: number; shortPct: number; ts: number }>;
    topAccount: Array<{ ratio: number; longPct: number; shortPct: number; ts: number }>;
    topPosition: Array<{ ratio: number; longPct: number; shortPct: number; ts: number }>;
    takerVolume: Array<{ ratio: number; buyVol: number; sellVol: number; ts: number }>;
}

const routeCache = new Map<string, { data: LongShortResponseBody; timestamp: number }>();

export async function GET(request: NextRequest) {
    try {
        const { searchParams } = new URL(request.url);
        const symbol = searchParams.get('symbol') || 'BTCUSDT';
        const period = searchParams.get('period') || '1h';
        const limit = Math.min(Number(searchParams.get('limit') || '30'), 500);
        const cacheKey = `${symbol}:${period}:${limit}`;
        const cached = routeCache.get(cacheKey);
        
        // Cleanup expired cache to prevent memory leak
        if (Math.random() < 0.1) {
            const now = Date.now();
            for (const [k, v] of routeCache.entries()) {
                if (now - v.timestamp > 5 * 60 * 1000) routeCache.delete(k); // 5 min TTL for memory cleanup
            }
        }

        // Return cached if fresh enough (1 minute)
        if (cached && Date.now() - cached.timestamp < 60_000) {
            return NextResponse.json(cached.data, {
                headers: {
                    'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=120',
                    'X-Data-Source': 'memory-cache',
                },
            });
        }

        const [global, topAccount, topPosition, taker] = await Promise.allSettled([
            fetchBinanceJson<BinanceLSEntry[]>(`/futures/data/globalLongShortAccountRatio?symbol=${symbol}&period=${period}&limit=${limit}`, { revalidate: 60 }),
            fetchBinanceJson<BinanceLSEntry[]>(`/futures/data/topLongShortAccountRatio?symbol=${symbol}&period=${period}&limit=${limit}`, { revalidate: 60 }),
            fetchBinanceJson<BinanceLSEntry[]>(`/futures/data/topLongShortPositionRatio?symbol=${symbol}&period=${period}&limit=${limit}`, { revalidate: 60 }),
            fetchBinanceJson<BinanceTakerEntry[]>(`/futures/data/takerlongshortRatio?symbol=${symbol}&period=${period}&limit=${limit}`, { revalidate: 60 }),
        ]);

        // Transform to a lighter format for the frontend
        const transform = (entries: BinanceLSEntry[]) =>
            entries.map(e => ({
                ratio: parseFloat(e.longShortRatio),
                longPct: parseFloat(e.longAccount),
                shortPct: parseFloat(e.shortAccount),
                ts: Number(e.timestamp),
            }));

        const transformTaker = (entries: BinanceTakerEntry[]) =>
            entries.map(e => ({
                ratio: parseFloat(e.buySellRatio),
                buyVol: parseFloat(e.buyVol),
                sellVol: parseFloat(e.sellVol),
                ts: Number(e.timestamp),
            }));

        const responseBody: LongShortResponseBody = {
            global: global.status === 'fulfilled' ? transform(global.value) : (cached?.data.global || []),
            topAccount: topAccount.status === 'fulfilled' ? transform(topAccount.value) : (cached?.data.topAccount || []),
            topPosition: topPosition.status === 'fulfilled' ? transform(topPosition.value) : (cached?.data.topPosition || []),
            takerVolume: taker.status === 'fulfilled' ? transformTaker(taker.value) : (cached?.data.takerVolume || []),
        };

        const successCount = [global, topAccount, topPosition, taker].filter((result) => result.status === 'fulfilled').length;

        if (successCount === 0) {
            if (cached) {
                return NextResponse.json(cached.data, {
                    headers: {
                        'Cache-Control': 'public, s-maxage=30, stale-while-revalidate=120',
                        'X-Data-Source': 'stale-memory-cache',
                    },
                });
            }

            throw new Error('All long/short upstream requests failed');
        }

        routeCache.set(cacheKey, {
            data: responseBody,
            timestamp: Date.now(),
        });

        return NextResponse.json(responseBody, {
            headers: {
                'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=120',
                'X-Data-Source': successCount === 4 ? 'live' : 'partial-live-stale',
            },
        });
    } catch (error) {
        console.error('[LongShort API]', error);
        return NextResponse.json(
            { error: 'Failed to fetch long/short ratio data' },
            { status: 500 }
        );
    }
}
