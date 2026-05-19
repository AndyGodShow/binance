import { NextResponse } from 'next/server';
import { withTimeout } from '@/lib/async';
import { TickerData } from '@/lib/types';
import { logger } from '@/lib/logger';
import { buildMarketData } from '@/lib/marketDataPipeline';
import {
    createMarketDataRouteState,
    ensureCachedMarketBuild,
} from '@/lib/marketRouteCache';
import { buildQualityHeaders } from '@/lib/dataQualityStatus';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const strategyMarketRouteState = createMarketDataRouteState();

const LIVE_CACHE_DURATION = 5000;
const STRATEGY_MARKET_BUILD_TIMEOUT_MS = 60_000;
const STRATEGY_MARKET_RESPONSE_BASE_HEADERS = {
    'Content-Encoding': 'identity',
};

function strategyMarketResponse(data: TickerData[] | { error: string }, init?: ResponseInit) {
    const headers = new Headers(init?.headers);
    Object.entries(STRATEGY_MARKET_RESPONSE_BASE_HEADERS).forEach(([key, value]) => {
        headers.set(key, value);
    });

    return NextResponse.json(data, {
        ...init,
        headers,
    });
}

function ensureStrategyMarketBuild(): Promise<TickerData[]> {
    return ensureCachedMarketBuild(strategyMarketRouteState, buildMarketData);
}

export async function GET() {
    const now = Date.now();
    if (
        strategyMarketRouteState.liveMarketCache &&
        now - strategyMarketRouteState.liveMarketCache.time < LIVE_CACHE_DURATION
    ) {
        return strategyMarketResponse(strategyMarketRouteState.liveMarketCache.data, {
            headers: {
                'Cache-Control': 'public, s-maxage=3, stale-while-revalidate=10',
                ...buildQualityHeaders({
                    dataQuality: 'enriched',
                    buildState: 'ready',
                    dataSource: 'strategy-memory-cache',
                    updatedAt: strategyMarketRouteState.liveMarketCache.time,
                }),
            },
        });
    }

    if (
        strategyMarketRouteState.lastSuccessfulMarketData &&
        strategyMarketRouteState.lastSuccessfulMarketData.length > 0
    ) {
        void ensureStrategyMarketBuild().catch((error) => {
            logger.error('Background strategy market refresh failed', error as Error);
        });

        return strategyMarketResponse(strategyMarketRouteState.lastSuccessfulMarketData, {
            headers: {
                'Cache-Control': 'public, s-maxage=3, stale-while-revalidate=10',
                ...buildQualityHeaders({
                    dataQuality: 'enriched',
                    buildState: 'ready',
                    dataSource: 'strategy-stale-memory-cache-refreshing',
                    cacheAgeSeconds: Math.floor((Date.now() - strategyMarketRouteState.lastSuccessfulAt) / 1000),
                    updatedAt: strategyMarketRouteState.lastSuccessfulAt,
                }),
            },
        });
    }

    const ownsInflight = !strategyMarketRouteState.inflightMarketBuild;
    try {
        const data = await withTimeout(
            ensureStrategyMarketBuild(),
            STRATEGY_MARKET_BUILD_TIMEOUT_MS,
            'strategy market build',
        );

        return strategyMarketResponse(data, {
            headers: {
                'Cache-Control': 'public, s-maxage=3, stale-while-revalidate=10',
                ...buildQualityHeaders({
                    dataQuality: 'enriched',
                    buildState: 'ready',
                    dataSource: ownsInflight ? 'strategy-live' : 'strategy-live-coalesced',
                    updatedAt: Date.now(),
                }),
            },
        });
    } catch (error) {
        logger.error('Error fetching strategy market data', error as Error);

        return strategyMarketResponse(
            { error: 'Failed to fetch enriched strategy market data' },
            {
                status: 503,
                headers: {
                    'Cache-Control': 'no-store',
                    ...buildQualityHeaders({
                        dataQuality: 'unavailable',
                        buildState: 'failed',
                        dataSource: 'strategy-live',
                        errorKind: 'upstream_error',
                        updatedAt: Date.now(),
                    }),
                },
            },
        );
    }
}
