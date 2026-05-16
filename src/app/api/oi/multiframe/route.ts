import { NextResponse } from 'next/server';

import { withTimeout } from '@/lib/async';
import { fetchOpenInterestFrameSnapshotsBatch } from '@/lib/openInterestFrames';
import { logger } from '@/lib/logger';
import { invalidRequestBody, validateSymbolsParam } from '@/lib/apiRequestValidation';
import { buildQualityHeaders } from '@/lib/dataQualityStatus';

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
        return NextResponse.json({
            dataQuality: 'unavailable',
            buildState: 'idle',
            errorKind: 'empty_response',
            sourceStatus: {
                oiMultiframe: {
                    ok: false,
                    status: 'skipped',
                    errorKind: 'empty_response',
                    updatedAt: Date.now(),
                },
            },
        }, {
            headers: {
                'Cache-Control': 'public, s-maxage=15, stale-while-revalidate=30',
                ...buildQualityHeaders({
                    dataQuality: 'unavailable',
                    buildState: 'idle',
                    dataSource: 'empty-request',
                    errorKind: 'empty_response',
                    updatedAt: Date.now(),
                }),
            },
        });
    }

    try {
        const snapshotMap = await withTimeout(
            fetchOpenInterestFrameSnapshotsBatch(requestedSymbols, REQUEST_BATCH_SIZE),
            REQUEST_TIMEOUT_MS,
            'oi multiframe batch build'
        );
        const data = Object.fromEntries(snapshotMap);
        const failedSymbols = requestedSymbols.filter((symbol) => !snapshotMap.has(symbol));
        const dataQuality = failedSymbols.length === 0 ? 'enriched' : snapshotMap.size > 0 ? 'partial' : 'unavailable';
        const buildState = dataQuality === 'unavailable' ? 'failed' : 'ready';

        return NextResponse.json({
            ...data,
            dataQuality,
            buildState,
            failedSymbols,
            sourceStatus: {
                oiMultiframe: {
                    ok: dataQuality !== 'unavailable',
                    status: dataQuality === 'enriched' ? 'ok' : dataQuality === 'partial' ? 'partial' : 'failed',
                    errorKind: dataQuality === 'unavailable' ? 'empty_response' : undefined,
                    updatedAt: Date.now(),
                },
            },
        }, {
            headers: {
                'Cache-Control': 'public, s-maxage=15, stale-while-revalidate=30',
                ...buildQualityHeaders({
                    dataQuality,
                    buildState,
                    dataSource: 'symbols-batch',
                    errorKind: dataQuality === 'unavailable' ? 'empty_response' : undefined,
                    updatedAt: Date.now(),
                }),
            },
        });
    } catch (error) {
        logger.error('Failed to fetch batched OI multiframe data', error as Error);
        return NextResponse.json({
            dataQuality: 'unavailable',
            buildState: 'failed',
            failedSymbols: requestedSymbols,
            errorKind: 'timeout',
            sourceStatus: {
                oiMultiframe: {
                    ok: false,
                    status: 'timeout',
                    errorKind: 'timeout',
                    updatedAt: Date.now(),
                },
            },
        }, {
            headers: {
                'Cache-Control': 'no-store, max-age=0',
                ...buildQualityHeaders({
                    dataQuality: 'unavailable',
                    buildState: 'failed',
                    dataSource: 'symbols-batch-error',
                    isFallback: true,
                    errorKind: 'timeout',
                    updatedAt: Date.now(),
                }),
            },
        });
    }
}
