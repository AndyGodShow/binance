import type { TickerData } from './types.ts';

export type MarketDataQuality = 'enriched' | 'lightweight';
export type MarketDataSource = 'heavy' | 'fallback';

export interface MarketDataCacheEntry {
    time: number;
    data: TickerData[];
    quality: MarketDataQuality;
    source: MarketDataSource;
}

export interface MarketDataRouteState {
    lastSuccessfulMarketData: TickerData[] | null;
    lastSuccessfulAt: number;
    liveMarketCache: MarketDataCacheEntry | null;
    inflightMarketBuild: Promise<TickerData[]> | null;
}

export function createMarketDataRouteState(): MarketDataRouteState {
    return {
        lastSuccessfulMarketData: null,
        lastSuccessfulAt: 0,
        liveMarketCache: null,
        inflightMarketBuild: null,
    };
}

export function commitSuccessfulMarketData(
    state: MarketDataRouteState,
    data: TickerData[],
    now: number = Date.now(),
): TickerData[] {
    if (data.length > 0) {
        state.liveMarketCache = { time: now, data, quality: 'enriched', source: 'heavy' };
        state.lastSuccessfulMarketData = data;
        state.lastSuccessfulAt = now;
    }

    return data;
}

export function commitFallbackMarketData(
    _state: MarketDataRouteState,
    data: TickerData[],
    _now: number = Date.now(),
): TickerData[] {
    void _state;
    void _now;
    return data;
}

export function ensureCachedMarketBuild(
    state: MarketDataRouteState,
    buildMarketData: () => Promise<TickerData[]>,
    now: number = Date.now(),
): Promise<TickerData[]> {
    if (!state.inflightMarketBuild) {
        state.inflightMarketBuild = buildMarketData()
            .then((data) => commitSuccessfulMarketData(state, data, now))
            .finally(() => {
                state.inflightMarketBuild = null;
            });
    }

    return state.inflightMarketBuild;
}
