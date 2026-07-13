import { NextResponse } from 'next/server';
import { readRedisEnv, readRuntimeEnv } from '@/lib/env';
import { summarizeMarketHealth, summarizeSharedMarketHealth } from '@/lib/marketHealth';
import { marketRouteState } from '@/lib/marketRuntime';
import { createRedisMarketCoordination } from '@/lib/marketCoordination';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';

const BUILD_STUCK_AFTER_MS = 300_000;
const ENRICHED_MAX_AGE_MS = 600_000;

export async function GET() {
    const env = { ...readRuntimeEnv(), ...readRedisEnv() };
    const redisConfigured = Boolean(env.redisRestUrl && env.redisRestToken);
    const options = {
        now: Date.now(),
        nodeEnv: env.nodeEnv,
        redisConfigured,
        buildStuckAfterMs: BUILD_STUCK_AFTER_MS,
        enrichedMaxAgeMs: ENRICHED_MAX_AGE_MS,
    };
    let health = summarizeMarketHealth(marketRouteState, options);

    if (env.redisRestUrl && env.redisRestToken) {
        try {
            const shared = await createRedisMarketCoordination({
                url: env.redisRestUrl,
                token: env.redisRestToken,
            }).read();
            if (shared) health = summarizeSharedMarketHealth(shared, options);
        } catch (error) {
            logger.error('Failed to read shared market health metadata', error as Error);
        }
    }

    return NextResponse.json(health, {
        status: health.ready ? 200 : 503,
        headers: { 'Cache-Control': 'no-store' },
    });
}
