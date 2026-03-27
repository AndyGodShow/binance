import { NextRequest, NextResponse } from 'next/server';
import {
    MarketIndicatorInterval,
    getMarketIndicatorSnapshot,
} from '@/lib/marketIndicators';

const DEFAULT_INTERVALS: MarketIndicatorInterval[] = ['5m', '15m', '1h', '4h', '24h'];

function parseIntervals(searchParams: URLSearchParams): string[] {
    const single = searchParams.get('interval');
    const multiple = searchParams.get('intervals');
    const raw = multiple || single;

    if (!raw) {
        return DEFAULT_INTERVALS;
    }

    return raw
        .split(',')
        .map((interval) => interval.trim())
        .filter(Boolean);
}

function parseSymbols(searchParams: URLSearchParams): Set<string> | null {
    const raw = searchParams.get('symbols');
    if (!raw) {
        return null;
    }

    const symbols = raw
        .split(',')
        .map((symbol) => symbol.trim().toUpperCase())
        .filter(Boolean);

    return symbols.length > 0 ? new Set(symbols) : null;
}

export async function GET(request: NextRequest) {
    const requestedIntervals = parseIntervals(request.nextUrl.searchParams);
    const symbolFilter = parseSymbols(request.nextUrl.searchParams);

    if (requestedIntervals.length === 0) {
        return NextResponse.json({ error: 'Missing interval' }, { status: 400 });
    }

    try {
        const intervals: Record<string, unknown> = {};
        const sources = new Set<string>();
        const requestedSymbols = symbolFilter ? Array.from(symbolFilter) : undefined;

        for (const interval of requestedIntervals) {
            const result = await getMarketIndicatorSnapshot(interval, {
                symbols: requestedSymbols,
            });
            sources.add(result.source);

            intervals[result.snapshot.interval] = {
                interval: result.snapshot.interval,
                candleInterval: result.snapshot.candleInterval,
                generatedAt: result.snapshot.generatedAt,
                symbolCount: Object.keys(result.snapshot.indicators).length,
                indicators: result.snapshot.indicators,
            };
        }

        return NextResponse.json(
            {
                intervals,
            },
            {
                headers: {
                    'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=120',
                    'X-Data-Source': Array.from(sources).join(','),
                }
            }
        );
    } catch (error) {
        return NextResponse.json(
            {
                error: error instanceof Error ? error.message : 'Failed to build indicator snapshots',
            },
            { status: 500 }
        );
    }
}
