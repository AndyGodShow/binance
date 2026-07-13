import { NextResponse } from 'next/server';
import { createHash } from 'node:crypto';
import { unstable_cache } from 'next/cache';
import { after, type NextRequest } from 'next/server';
import { withTimeout } from '@/lib/async';
import { TickerData } from '@/lib/types';
import { logger } from '@/lib/logger';
import { buildMarketData, fetchBaseMarketData } from '@/lib/marketDataPipeline';
import {
    ensureCachedMarketBuild,
    ensureFreshFallbackMarketData,
    resolveMarketSnapshotRequest,
} from '@/lib/marketRouteCache';
import { createFixedWindowRateLimiter, createRedisFixedWindowRateLimiter } from '@/lib/rateLimit';
import { createRedisRestLease } from '@/lib/distributedLease';
import { readRedisEnv, readRuntimeEnv } from '@/lib/env';
import { marketRouteState } from '@/lib/marketRuntime';
import { createRedisMarketCoordination, type SharedMarketMetadata } from '@/lib/marketCoordination';
import { MarketBuildLeaseUnavailableError, runFencedMarketBuild } from '@/lib/marketBuildLease';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const LIVE_CACHE_DURATION = 60_000;
const MARKET_BUILD_TIMEOUT_MS = 12_000;
const MARKET_FALLBACK_TIMEOUT_MS = 6000;
const MARKET_FALLBACK_FRESH_FOR_MS = 10_000;
const marketRateLimiter = createFixedWindowRateLimiter({ limit: 120, windowMs: 60_000 });
const serverEnv = { ...readRuntimeEnv(), ...readRedisEnv() };
const distributedLease = serverEnv.redisRestUrl && serverEnv.redisRestToken
    ? createRedisRestLease({ url: serverEnv.redisRestUrl, token: serverEnv.redisRestToken })
    : null;
const marketCoordination = serverEnv.redisRestUrl && serverEnv.redisRestToken
    ? createRedisMarketCoordination({ url: serverEnv.redisRestUrl, token: serverEnv.redisRestToken })
    : null;
const distributedRateLimiter = serverEnv.redisRestUrl && serverEnv.redisRestToken
    ? createRedisFixedWindowRateLimiter({
        url: serverEnv.redisRestUrl,
        token: serverEnv.redisRestToken,
        limit: 120,
        windowMs: 60_000,
    })
    : null;
const MARKET_BUILD_LEASE_KEY = 'binance-dashboard:full-market-build:v1';
const MARKET_BUILD_LEASE_TTL_MS = 260_000;
const MARKET_FULL_BUILD_DEADLINE_MS = 240_000;
const MARKET_LEASE_RENEW_INTERVAL_MS = 80_000;
const MARKET_METADATA_TTL_MS = 900_000;
async function buildFullMarketSnapshot() {
    const startedAt = Date.now();
    return buildMarketData({
        deadlineAt: startedAt + MARKET_FULL_BUILD_DEADLINE_MS,
        signal: AbortSignal.timeout(MARKET_FULL_BUILD_DEADLINE_MS),
    });
}

async function buildFullMarketSnapshotWithLease() {
    if (!distributedLease) {
        return buildFullMarketSnapshot();
    }

    return runFencedMarketBuild({
        lease: distributedLease,
        key: MARKET_BUILD_LEASE_KEY,
        ttlMs: MARKET_BUILD_LEASE_TTL_MS,
        renewIntervalMs: MARKET_LEASE_RENEW_INTERVAL_MS,
        build: buildFullMarketSnapshot,
        onRenewError: (error) => logger.error('Failed to renew market build lease', error as Error),
        onReleaseError: (error) => logger.error('Failed to release market build lease', error as Error),
    });
}

const getSharedMarketSnapshot = unstable_cache(
    buildFullMarketSnapshotWithLease,
    ['full-market-enriched-snapshot-v1'],
    { revalidate: 300, tags: ['full-market-enriched-snapshot'] },
);

async function buildMarketSnapshotWithLease(): Promise<TickerData[] | null> {
    if (marketRouteState.inflightMarketBuild) {
        return marketRouteState.inflightMarketBuild;
    }

    if (!distributedLease) {
        if (serverEnv.nodeEnv === 'production') {
            logger.warn('Skipping full market build because distributed lease is not configured');
            return null;
        }
        return ensureCachedMarketBuild(marketRouteState, getSharedMarketSnapshot);
    }

    let data: TickerData[];
    try {
        data = await ensureCachedMarketBuild(marketRouteState, getSharedMarketSnapshot);
    } catch (error) {
        if (error instanceof MarketBuildLeaseUnavailableError) return null;
        throw error;
    }
    await persistSharedMarketMetadata({
        quality: 'enriched',
        symbolCount: data.length,
        snapshotAt: marketRouteState.lastSuccessfulAt || Date.now(),
        buildState: 'ready',
        updatedAt: Date.now(),
    });
    return data;
}

async function persistSharedMarketMetadata(metadata: SharedMarketMetadata) {
    if (!marketCoordination) return;
    try {
        await marketCoordination.write(metadata, MARKET_METADATA_TTL_MS);
    } catch (error) {
        logger.error('Failed to persist shared market metadata', error as Error);
    }
}

function scheduleSharedMarketMetadata(metadata: SharedMarketMetadata) {
    after(() => persistSharedMarketMetadata(metadata));
}

function scheduleFullMarketBuild(label: string) {
    after(async () => {
        try {
            await buildMarketSnapshotWithLease();
        } catch (error) {
            logger.error(label, error as Error);
        }
    });
}

function marketResponse(data: TickerData[] | { error: string }, init?: ResponseInit) {
    const headers = new Headers(init?.headers);
    return NextResponse.json(data, {
        ...init,
        headers,
    });
}

export async function GET(request: NextRequest) {
    const clientKey = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
        || request.headers.get('x-real-ip')
        || 'anonymous';
    const hashedClientKey = createHash('sha256').update(clientKey).digest('hex').slice(0, 24);
    let rateLimit;
    try {
        rateLimit = distributedRateLimiter
            ? await distributedRateLimiter.check(hashedClientKey)
            : marketRateLimiter.check(hashedClientKey);
    } catch (error) {
        logger.error('Distributed market rate limiter failed; using local limiter', error as Error);
        rateLimit = marketRateLimiter.check(hashedClientKey);
    }
    if (!rateLimit.allowed) {
        return marketResponse({ error: 'Too many market requests' }, {
            status: 429,
            headers: { 'Retry-After': String(rateLimit.retryAfterSeconds) },
        });
    }

    if (!marketRouteState.lastSuccessfulMarketData?.length && !marketRouteState.lastFallbackMarketData?.length) {
        try {
            const fallbackData = await withTimeout(
                ensureFreshFallbackMarketData(
                    marketRouteState,
                    () => fetchBaseMarketData(AbortSignal.timeout(MARKET_FALLBACK_TIMEOUT_MS)),
                    { now: Date.now(), freshForMs: MARKET_FALLBACK_FRESH_FOR_MS },
                ),
                MARKET_FALLBACK_TIMEOUT_MS,
                'market cold-start fallback',
            );
            scheduleSharedMarketMetadata({
                quality: 'lightweight',
                symbolCount: fallbackData.length,
                snapshotAt: marketRouteState.lastFallbackAt,
                buildState: 'building',
                updatedAt: Date.now(),
            });
            scheduleFullMarketBuild('Cold-start market snapshot build failed');
            return marketResponse(fallbackData, {
                headers: {
                    'Cache-Control': 'public, s-maxage=3, stale-while-revalidate=30',
                    'X-Data-Source': 'cold-start-light-fallback',
                    'X-Data-Quality': 'lightweight',
                    'X-Build-State': 'building',
                },
            });
        } catch (error) {
            logger.error('Market cold-start fallback failed', error as Error);
        }
    }

    if (!marketRouteState.lastSuccessfulMarketData?.length && marketRouteState.lastFallbackMarketData?.length) {
        try {
            await withTimeout(
                ensureFreshFallbackMarketData(
                    marketRouteState,
                    () => fetchBaseMarketData(AbortSignal.timeout(MARKET_FALLBACK_TIMEOUT_MS)),
                    { now: Date.now(), freshForMs: MARKET_FALLBACK_FRESH_FOR_MS },
                ),
                MARKET_FALLBACK_TIMEOUT_MS,
                'market fallback refresh',
            );
        } catch (error) {
            logger.error('Market fallback refresh failed; serving previous lightweight snapshot', error as Error);
        }
        scheduleFullMarketBuild('Background full market snapshot build failed');
        scheduleSharedMarketMetadata({
            quality: 'lightweight',
            symbolCount: marketRouteState.lastFallbackMarketData.length,
            snapshotAt: marketRouteState.lastFallbackAt,
            buildState: 'building',
            updatedAt: Date.now(),
        });
        return marketResponse(marketRouteState.lastFallbackMarketData, {
            headers: {
                'Cache-Control': 'public, s-maxage=3, stale-while-revalidate=30',
                'X-Data-Source': 'cached-light-fallback',
                'X-Data-Quality': 'lightweight',
                'X-Build-State': 'building',
                'X-Cache-Age-Seconds': Math.floor((Date.now() - marketRouteState.lastFallbackAt) / 1000).toString(),
            },
        });
    }

    const now = Date.now();
    const snapshot = resolveMarketSnapshotRequest(marketRouteState, getSharedMarketSnapshot, {
        now,
        freshForMs: LIVE_CACHE_DURATION,
        startBuild: false,
    });

    if (snapshot.state === 'fresh' && snapshot.data) {
        return marketResponse(snapshot.data, {
            headers: {
                'Cache-Control': 'public, s-maxage=3, stale-while-revalidate=10',
                'X-Data-Source': 'memory-cache',
                'X-Data-Quality': 'enriched',
                'X-Build-State': 'ready',
            }
        });
    }

    if (snapshot.state === 'stale-refreshing' && snapshot.data) {
        scheduleFullMarketBuild('Background market snapshot build failed');
        return marketResponse(snapshot.data, {
            headers: {
                'Cache-Control': 'public, s-maxage=3, stale-while-revalidate=10',
                'X-Data-Source': 'stale-memory-cache-refreshing',
                'X-Data-Quality': 'enriched',
                'X-Build-State': 'ready',
                'X-Cache-Age-Seconds': Math.floor((Date.now() - marketRouteState.lastSuccessfulAt) / 1000).toString(),
            }
        });
    }

    try {
        const data = await withTimeout(
            buildMarketSnapshotWithLease().then((data) => {
                if (!data) throw new Error('Full market build lease is held by another instance');
                return data;
            }),
            MARKET_BUILD_TIMEOUT_MS,
            'market build'
        );
        return marketResponse(data, {
            headers: {
                'Cache-Control': 'public, s-maxage=3, stale-while-revalidate=10',
                'X-Data-Source': 'shared-snapshot',
                'X-Data-Quality': 'enriched',
                'X-Build-State': 'ready',
            }
        });
    } catch (error) {
        logger.error('Error fetching market data', error as Error);
        if (marketRouteState.lastSuccessfulMarketData && marketRouteState.lastSuccessfulMarketData.length > 0) {
            return marketResponse(marketRouteState.lastSuccessfulMarketData, {
                headers: {
                    'Cache-Control': 'public, s-maxage=2, stale-while-revalidate=10',
                    'X-Data-Source': 'stale-memory-cache',
                    'X-Data-Quality': 'enriched',
                    'X-Build-State': 'stale',
                    'X-Cache-Age-Seconds': Math.floor((Date.now() - marketRouteState.lastSuccessfulAt) / 1000).toString(),
                }
            });
        }

        if (marketRouteState.lastFallbackMarketData?.length) {
            return marketResponse(marketRouteState.lastFallbackMarketData, {
                headers: {
                    'Cache-Control': 'public, s-maxage=3, stale-while-revalidate=30',
                    'X-Data-Source': 'cached-light-fallback',
                    'X-Data-Quality': 'lightweight',
                    'X-Build-State': 'building',
                    'X-Cache-Age-Seconds': Math.floor((Date.now() - marketRouteState.lastFallbackAt) / 1000).toString(),
                },
            });
        }

        try {
            const fallbackData = await withTimeout(
                ensureFreshFallbackMarketData(
                    marketRouteState,
                    () => fetchBaseMarketData(AbortSignal.timeout(MARKET_FALLBACK_TIMEOUT_MS)),
                    { now: Date.now(), freshForMs: MARKET_FALLBACK_FRESH_FOR_MS },
                ),
                MARKET_FALLBACK_TIMEOUT_MS,
                'market light fallback'
            );
            scheduleSharedMarketMetadata({
                quality: 'lightweight',
                symbolCount: fallbackData.length,
                snapshotAt: marketRouteState.lastFallbackAt,
                buildState: 'building',
                updatedAt: Date.now(),
            });

            return marketResponse(fallbackData, {
                headers: {
                    'Cache-Control': 'public, s-maxage=3, stale-while-revalidate=10',
                    'X-Data-Source': 'light-fallback',
                    'X-Data-Quality': 'lightweight',
                    'X-Build-State': 'building',
                }
            });
        } catch (fallbackError) {
            logger.error('Market light fallback failed', fallbackError as Error);
        }

        return marketResponse({ error: 'Failed to fetch market data' }, { status: 500 });
    }
}
