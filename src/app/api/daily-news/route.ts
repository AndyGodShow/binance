import { NextRequest, NextResponse } from 'next/server';

import { readLatestDailyNewsDigest } from '@/lib/dailyNews/service';
import { buildDailyNewsReadResponse } from '@/lib/dailyNews/routeResponse';
import type { DailyNewsApiResponse } from '@/lib/dailyNews/types';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

function jsonResponse(response: DailyNewsApiResponse) {
    return NextResponse.json(response, {
        headers: {
            'Cache-Control': 'no-store',
        },
    });
}

export async function GET(request: NextRequest) {
    try {
        const { digest, storageMode } = await readLatestDailyNewsDigest();
        const { shouldGenerate, ...response } = buildDailyNewsReadResponse({
            digest,
            storageMode,
            refreshRequested: request.nextUrl.searchParams.get('refresh') === '1',
        });
        void shouldGenerate;
        return jsonResponse(response);
    } catch (error) {
        logger.error('Failed to read daily news digest', error as Error);
        return jsonResponse({
            digest: null,
            status: 'empty',
            storageMode: process.env.BLOB_READ_WRITE_TOKEN ? 'blob' : 'local-file',
            isStale: true,
            message: 'Failed to read important news digest',
        } satisfies DailyNewsApiResponse);
    }
}
