import { NextResponse } from 'next/server';
import { fetchOpenInterestHistorySnapshot } from '@/lib/openInterest';

/**
 * OI 历史数据 API
 * 返回指定币种在不同时间点的持仓量数据
 * 用于计算真实的 OI 增长率
 */

export async function GET(request: Request) {
    const { searchParams } = new URL(request.url);
    const symbol = searchParams.get('symbol');

    if (!symbol) {
        return NextResponse.json({ error: 'Symbol is required' }, { status: 400 });
    }

    try {
        const snapshot = await fetchOpenInterestHistorySnapshot(symbol);

        return NextResponse.json(snapshot, {
            headers: {
                'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600',
            }
        });

    } catch (error) {
        console.error(`Failed to fetch OI history for ${symbol}:`, error);
        return NextResponse.json(
            { error: 'Failed to fetch OI history' },
            { status: 500 }
        );
    }
}
