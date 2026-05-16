import { NextResponse } from 'next/server';

import { withTimeout } from '@/lib/async';
import { fetchOpenInterestFrameSnapshotsBatch } from '@/lib/openInterestFrames';
import { logger } from '@/lib/logger';
import { invalidRequestBody, validateSymbolsParam } from '@/lib/apiRequestValidation';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const REQUEST_TIMEOUT_MS = 20000;
const REQUEST_BATCH_SIZE = process.env.NODE_ENV === 'development' ? 5 : 20;

export async function GET(request: Request) {
    const validatedSymbols = validateSymbolsParam(new URL(request.url).searchParams, { maxSymbols: 20 });
    if (!validatedSymbols.ok) {
        return NextResponse.json(invalidRequestBody(validatedSymbols.details), { status: 400 });
    }

    const requestedSymbols = validatedSymbols.value;

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
            fetchOpenInterestFrameSnapshotsBatch(requestedSymbols, REQUEST_BATCH_SIZE),
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
