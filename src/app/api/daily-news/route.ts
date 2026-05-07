import { NextRequest, NextResponse } from 'next/server';

import { generateDailyNewsDigest, readLatestDailyNewsDigest } from '@/lib/dailyNews/service';
import { isDailyNewsDigestStale, shouldGenerateDailyNewsOnRead } from '@/lib/dailyNewsReadPolicy';
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
        const forceRefresh = request.nextUrl.searchParams.get('refresh') === '1';
        const shouldRegenerate = forceRefresh || isDailyNewsDigestStale(digest?.generatedAt);

        if (!digest || shouldRegenerate) {
            if (!shouldGenerateDailyNewsOnRead()) {
                return jsonResponse({
                    digest,
                    status: digest ? 'ok' : 'empty',
                    storageMode,
                    message: digest
                        ? 'Important news digest is stale and automatic generation is disabled'
                        : 'Important news has not been generated yet',
                } satisfies DailyNewsApiResponse);
            }

            const generated = await generateDailyNewsDigest({ force: true });

            if (generated.digest) {
                return jsonResponse({
                    digest: generated.digest,
                    status: 'ok',
                    storageMode: generated.storageMode,
                    message: generated.generated
                        ? 'Important news digest refreshed'
                        : generated.message,
                } satisfies DailyNewsApiResponse);
            }

            return jsonResponse({
                digest: null,
                status: 'empty',
                storageMode: generated.storageMode || storageMode,
                message: generated.message || 'Important news has not been generated yet',
            } satisfies DailyNewsApiResponse);
        }

        return jsonResponse({
            digest,
            status: 'ok',
            storageMode,
        } satisfies DailyNewsApiResponse);
    } catch (error) {
        logger.error('Failed to read daily news digest', error as Error);
        return NextResponse.json({
            digest: null,
            status: 'empty',
            storageMode: process.env.BLOB_READ_WRITE_TOKEN ? 'blob' : 'local-file',
            message: 'Failed to read important news digest',
        } satisfies DailyNewsApiResponse, { status: 500 });
    }
}
