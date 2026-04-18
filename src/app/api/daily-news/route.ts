import { NextResponse } from 'next/server';

import { generateDailyNewsDigest, readLatestDailyNewsDigest } from '@/lib/dailyNews/service';
import { shouldGenerateDailyNewsOnRead } from '@/lib/dailyNewsReadPolicy';
import type { DailyNewsApiResponse } from '@/lib/dailyNews/types';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET() {
    try {
        const { digest, storageMode } = await readLatestDailyNewsDigest();

        if (!digest) {
            if (!shouldGenerateDailyNewsOnRead()) {
                return NextResponse.json({
                    digest: null,
                    status: 'empty',
                    storageMode,
                    message: 'Daily news has not been generated yet',
                } satisfies DailyNewsApiResponse, {
                    headers: {
                        'Cache-Control': 'no-store',
                    },
                });
            }

            const generated = await generateDailyNewsDigest({ force: true });

            if (generated.digest) {
                return NextResponse.json({
                    digest: generated.digest,
                    status: 'ok',
                    storageMode: generated.storageMode,
                    message: generated.message,
                } satisfies DailyNewsApiResponse, {
                    headers: {
                        'Cache-Control': 'no-store',
                    },
                });
            }

            return NextResponse.json({
                digest: null,
                status: 'empty',
                storageMode: generated.storageMode || storageMode,
                message: generated.message || 'Daily news has not been generated yet',
            } satisfies DailyNewsApiResponse, {
                headers: {
                    'Cache-Control': 'no-store',
                },
            });
        }

        return NextResponse.json({
            digest,
            status: 'ok',
            storageMode,
        } satisfies DailyNewsApiResponse, {
            headers: {
                'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300',
            },
        });
    } catch (error) {
        logger.error('Failed to read daily news digest', error as Error);
        return NextResponse.json({
            digest: null,
            status: 'empty',
            storageMode: process.env.BLOB_READ_WRITE_TOKEN ? 'blob' : 'local-file',
            message: 'Failed to read daily news digest',
        } satisfies DailyNewsApiResponse, { status: 500 });
    }
}
