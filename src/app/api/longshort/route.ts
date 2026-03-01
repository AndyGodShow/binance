import { NextRequest, NextResponse } from 'next/server';

const BINANCE_BASE = 'https://fapi.binance.com';

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

export async function GET(request: NextRequest) {
    try {
        const { searchParams } = new URL(request.url);
        const symbol = searchParams.get('symbol') || 'BTCUSDT';
        const period = searchParams.get('period') || '1h';
        const limit = Math.min(Number(searchParams.get('limit') || '30'), 500);

        // Parallel fetch all 4 endpoints
        const [globalRes, topAccountRes, topPositionRes, takerRes] = await Promise.all([
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
            fetch(
                `${BINANCE_BASE}/futures/data/takerlongshortRatio?symbol=${symbol}&period=${period}&limit=${limit}`,
                { next: { revalidate: 60 } }
            ),
        ]);

        if (!globalRes.ok || !topAccountRes.ok || !topPositionRes.ok || !takerRes.ok) {
            throw new Error(
                `Binance API error: global=${globalRes.status} topAccount=${topAccountRes.status} topPosition=${topPositionRes.status} taker=${takerRes.status}`
            );
        }

        const [global, topAccount, topPosition, taker]: [BinanceLSEntry[], BinanceLSEntry[], BinanceLSEntry[], BinanceTakerEntry[]] =
            await Promise.all([
                globalRes.json(),
                topAccountRes.json(),
                topPositionRes.json(),
                takerRes.json(),
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

        return NextResponse.json(
            {
                global: transform(global),
                topAccount: transform(topAccount),
                topPosition: transform(topPosition),
                takerVolume: transformTaker(taker),
            },
            {
                headers: {
                    'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=120',
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
