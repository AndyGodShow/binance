import { NextRequest, NextResponse } from 'next/server';

import { generateDailyNewsDigest } from '@/lib/dailyNews/service';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

function isAuthorized(request: NextRequest): boolean {
    const secret = process.env.CRON_SECRET?.trim();

    if (!secret) {
        return process.env.NODE_ENV !== 'production';
    }

    return request.headers.get('authorization') === `Bearer ${secret}`;
}

export async function GET(request: NextRequest) {
    if (!isAuthorized(request)) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const force = request.nextUrl.searchParams.get('force') === '1';

    try {
        const result = await generateDailyNewsDigest({ force });

        return NextResponse.json({
            ok: Boolean(result.digest),
            generated: result.generated,
            reusedExisting: result.reusedExisting,
            storageMode: result.storageMode,
            message: result.message,
            generatedAt: result.digest?.generatedAt,
            windowStart: result.digest?.windowStart,
            windowEnd: result.digest?.windowEnd,
            counts: result.digest ? {
                macro: result.digest.macro.length,
                ai: result.digest.ai.length,
                crypto: result.digest.crypto.length,
            } : undefined,
        }, {
            headers: {
                'Cache-Control': 'no-store',
            },
        });
    } catch (error) {
        logger.error('Daily news cron generation failed', error as Error);
        return NextResponse.json(
            { error: 'Daily news generation failed' },
            { status: 500 }
        );
    }
}
