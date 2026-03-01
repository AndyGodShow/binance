import { NextRequest, NextResponse } from 'next/server';

const BINANCE_BASE = 'https://fapi.binance.com';

interface BinanceLSEntry {
    symbol: string;
    longShortRatio: string;
    longAccount: string;
    shortAccount: string;
    timestamp: string;
}

export async function GET(request: NextRequest) {
    try {
        const { searchParams } = new URL(request.url);
        const symbol = searchParams.get('symbol') || 'BTCUSDT';
        const period = searchParams.get('period') || '1h';
        const limit = Math.min(Number(searchParams.get('limit') || '30'), 500);

        // Parallel fetch all 3 long/short ratio endpoints
        const [globalRes, topAccountRes, topPositionRes] = await Promise.all([
            fetch(
                `${BINANCE_BASE}/futures/data/globalLongShortAccountRatio?symbol=${symbol}&period=${period}&limit=${limit}`,
                { next: { revalidate: 60 } }
            ),
            fetch(
                `${BINANCE_BASE}/futures/data/topLongShortAccountRatio?symbol=${symbol}&period=${period}&limit=${limit}`,
                { next: { revalidate: 60 } }
            ),
            fetch(
                `${BINANCE_BASE}/futures/data/topLongShortPositionRatio?symbol=${symbol}&period=${period}&limit=${limit}`,
                { next: { revalidate: 60 } }
            ),
        ]);

        if (!globalRes.ok || !topAccountRes.ok || !topPositionRes.ok) {
            throw new Error(
                `Binance API error: global=${globalRes.status} topAccount=${topAccountRes.status} topPosition=${topPositionRes.status}`
            );
        }

        const [global, topAccount, topPosition]: [BinanceLSEntry[], BinanceLSEntry[], BinanceLSEntry[]] =
            await Promise.all([
                globalRes.json(),
                topAccountRes.json(),
                topPositionRes.json(),
            ]);

        // Transform to a lighter format for the frontend
        const transform = (entries: BinanceLSEntry[]) =>
            entries.map(e => ({
                ratio: parseFloat(e.longShortRatio),
                longPct: parseFloat(e.longAccount),
                shortPct: parseFloat(e.shortAccount),
                ts: Number(e.timestamp),
            }));

        return NextResponse.json(
            {
                global: transform(global),
                topAccount: transform(topAccount),
                topPosition: transform(topPosition),
            },
            {
                headers: {
                    'Cache-Control': 'public, s-maxage=30, stale-while-revalidate=60',
                },
            }
        );
    } catch (error) {
        console.error('[LongShort API]', error);
        return NextResponse.json(
            { error: 'Failed to fetch long/short ratio data' },
            { status: 500 }
        );
    }
}
