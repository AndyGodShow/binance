import { NextResponse } from 'next/server';

import { withTimeout } from '@/lib/async';
import { fetchOpenInterestFrameSnapshotsBatch } from '@/lib/openInterestFrames';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const REQUEST_TIMEOUT_MS = 20000;

function parseRequestedSymbols(searchParams: URLSearchParams): string[] {
    const raw = searchParams.get('symbols');
    if (!raw) {
        return [];
    }

    return Array.from(
        new Set(
            raw
                .split(',')
                .map((symbol) => symbol.trim().toUpperCase())
                .filter((symbol) => symbol.endsWith('USDT'))
        )
    );
}

export async function GET(request: Request) {
    const requestedSymbols = parseRequestedSymbols(new URL(request.url).searchParams);

    if (requestedSymbols.length === 0) {
        return NextResponse.json({}, {
            headers: {
                'Cache-Control': 'public, s-maxage=15, stale-while-revalidate=30',
                'X-Data-Source': 'empty-request',
            },
        });
    }

    try {
        const snapshotMap = await withTimeout(
            fetchOpenInterestFrameSnapshotsBatch(requestedSymbols, 20),
            REQUEST_TIMEOUT_MS,
            'oi multiframe batch build'
        );

        return NextResponse.json(Object.fromEntries(snapshotMap), {
            headers: {
                'Cache-Control': 'public, s-maxage=15, stale-while-revalidate=30',
                'X-Data-Source': 'symbols-batch',
            },
        });
    } catch (error) {
        logger.error('Failed to fetch batched OI multiframe data', error as Error);
        return NextResponse.json({}, {
            headers: {
                'Cache-Control': 'no-store, max-age=0',
                'X-Data-Source': 'symbols-batch-error',
            },
        });
    }
}
