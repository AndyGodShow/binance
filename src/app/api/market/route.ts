import { NextResponse } from 'next/server';
import { withTimeout } from '@/lib/async';
import { TickerData } from '@/lib/types';
import { logger } from '@/lib/logger';
import { buildMarketData, fetchBaseMarketData } from '@/lib/marketDataPipeline';

let lastSuccessfulMarketData: TickerData[] | null = null;
let lastSuccessfulAt = 0;
let liveMarketCache: { time: number; data: TickerData[] } | null = null;
let inflightMarketBuild: Promise<TickerData[]> | null = null;

const LIVE_CACHE_DURATION = 5000;
const MARKET_BUILD_TIMEOUT_MS = 15000;
const MARKET_FALLBACK_TIMEOUT_MS = 6000;

function ensureMarketBuild(): Promise<TickerData[]> {
    if (!inflightMarketBuild) {
        inflightMarketBuild = buildMarketData().finally(() => {
            inflightMarketBuild = null;
        });
    }

    return inflightMarketBuild;
}

export async function GET() {
    const now = Date.now();
    if (liveMarketCache && (now - liveMarketCache.time < LIVE_CACHE_DURATION)) {
        return NextResponse.json(liveMarketCache.data, {
            headers: {
                'Cache-Control': 'public, s-maxage=3, stale-while-revalidate=10',
                'X-Data-Source': 'memory-cache',
            }
        });
    }

    if (lastSuccessfulMarketData && lastSuccessfulMarketData.length > 0) {
        void ensureMarketBuild().catch((error) => {
            logger.error('Background market refresh failed', error as Error);
        });

        return NextResponse.json(lastSuccessfulMarketData, {
            headers: {
                'Cache-Control': 'public, s-maxage=3, stale-while-revalidate=10',
                'X-Data-Source': 'stale-memory-cache-refreshing',
                'X-Cache-Age-Seconds': Math.floor((Date.now() - lastSuccessfulAt) / 1000).toString(),
            }
        });
    }

    const ownsInflight = !inflightMarketBuild;
    try {
        const data = await withTimeout(
            ensureMarketBuild(),
            MARKET_BUILD_TIMEOUT_MS,
            'market build'
        );
        return NextResponse.json(data, {
            headers: {
                'Cache-Control': 'public, s-maxage=3, stale-while-revalidate=10',
                'X-Data-Source': ownsInflight ? 'live' : 'live-coalesced',
            }
        });
    } catch (error) {
        logger.error('Error fetching market data', error as Error);
        if (lastSuccessfulMarketData && lastSuccessfulMarketData.length > 0) {
            return NextResponse.json(lastSuccessfulMarketData, {
                headers: {
                    'Cache-Control': 'public, s-maxage=2, stale-while-revalidate=10',
                    'X-Data-Source': 'stale-memory-cache',
                    'X-Cache-Age-Seconds': Math.floor((Date.now() - lastSuccessfulAt) / 1000).toString(),
                }
            });
        }

        try {
            const fallbackData = await withTimeout(
                fetchBaseMarketData(),
                MARKET_FALLBACK_TIMEOUT_MS,
                'market light fallback'
            );
            liveMarketCache = { time: Date.now(), data: fallbackData };
            lastSuccessfulMarketData = fallbackData;
            lastSuccessfulAt = Date.now();

            return NextResponse.json(fallbackData, {
                headers: {
                    'Cache-Control': 'public, s-maxage=3, stale-while-revalidate=10',
                    'X-Data-Source': 'light-fallback',
                }
            });
        } catch (fallbackError) {
            logger.error('Market light fallback failed', fallbackError as Error);
        }

        return NextResponse.json({ error: 'Failed to fetch market data' }, { status: 500 });
    }
}
