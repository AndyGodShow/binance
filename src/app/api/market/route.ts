import { NextResponse } from 'next/server';
import { withTimeout } from '@/lib/async';
import { TickerData } from '@/lib/types';
import { logger } from '@/lib/logger';
import { buildMarketData, fetchBaseMarketData } from '@/lib/marketDataPipeline';
import {
    commitFallbackMarketData,
    createMarketDataRouteState,
    ensureCachedMarketBuild,
} from '@/lib/marketRouteCache';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const marketRouteState = createMarketDataRouteState();

const LIVE_CACHE_DURATION = 5000;
const MARKET_BUILD_TIMEOUT_MS = 60_000;
const MARKET_FALLBACK_TIMEOUT_MS = 6000;
const MARKET_RESPONSE_BASE_HEADERS = {
    'Content-Encoding': 'identity',
};

function marketResponse(data: TickerData[] | { error: string }, init?: ResponseInit) {
    const headers = new Headers(init?.headers);
    Object.entries(MARKET_RESPONSE_BASE_HEADERS).forEach(([key, value]) => {
        headers.set(key, value);
    });

    return NextResponse.json(data, {
        ...init,
        headers,
    });
}

function ensureMarketBuild(): Promise<TickerData[]> {
    return ensureCachedMarketBuild(marketRouteState, buildMarketData);
}

export async function GET() {
    const now = Date.now();
    if (marketRouteState.liveMarketCache && (now - marketRouteState.liveMarketCache.time < LIVE_CACHE_DURATION)) {
        return marketResponse(marketRouteState.liveMarketCache.data, {
            headers: {
                'Cache-Control': 'public, s-maxage=3, stale-while-revalidate=10',
                'X-Data-Source': 'memory-cache',
                'X-Data-Quality': marketRouteState.liveMarketCache.quality,
                'X-Build-State': 'ready',
            }
        });
    }

    if (marketRouteState.lastSuccessfulMarketData && marketRouteState.lastSuccessfulMarketData.length > 0) {
        void ensureMarketBuild().catch((error) => {
            logger.error('Background market refresh failed', error as Error);
        });

        return marketResponse(marketRouteState.lastSuccessfulMarketData, {
            headers: {
                'Cache-Control': 'public, s-maxage=3, stale-while-revalidate=10',
                'X-Data-Source': 'stale-memory-cache-refreshing',
                'X-Data-Quality': 'enriched',
                'X-Build-State': 'ready',
                'X-Cache-Age-Seconds': Math.floor((Date.now() - marketRouteState.lastSuccessfulAt) / 1000).toString(),
            }
        });
    }

    const ownsInflight = !marketRouteState.inflightMarketBuild;
    try {
        const data = await withTimeout(
            ensureMarketBuild(),
            MARKET_BUILD_TIMEOUT_MS,
            'market build'
        );
        return marketResponse(data, {
            headers: {
                'Cache-Control': 'public, s-maxage=3, stale-while-revalidate=10',
                'X-Data-Source': ownsInflight ? 'live' : 'live-coalesced',
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

        try {
            const fallbackData = await withTimeout(
                fetchBaseMarketData(),
                MARKET_FALLBACK_TIMEOUT_MS,
                'market light fallback'
            );
            commitFallbackMarketData(marketRouteState, fallbackData);

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
