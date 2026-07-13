import type { TickerData } from './types.ts';

type MarketDataQuality = 'enriched' | 'lightweight';
type MarketDataSource = 'heavy' | 'fallback';

interface MarketDataCacheEntry {
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
    inflightFallbackBuild: Promise<TickerData[]> | null;
    lastFallbackMarketData: TickerData[] | null;
    lastFallbackAt: number;
}

export function createMarketDataRouteState(): MarketDataRouteState {
    return {
        lastSuccessfulMarketData: null,
        lastSuccessfulAt: 0,
        liveMarketCache: null,
        inflightMarketBuild: null,
        inflightFallbackBuild: null,
        lastFallbackMarketData: null,
        lastFallbackAt: 0,
    };
}

function commitSuccessfulMarketData(
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
    state: MarketDataRouteState,
    data: TickerData[],
    now: number = Date.now(),
): TickerData[] {
    if (data.length > 0) {
        state.lastFallbackMarketData = data;
        state.lastFallbackAt = now;
    }
    return data;
}

export function ensureFreshFallbackMarketData(
    state: MarketDataRouteState,
    fetchMarketData: () => Promise<TickerData[]>,
    options: { now: number; freshForMs: number },
): Promise<TickerData[]> {
    const cached = state.lastFallbackMarketData;
    if (cached?.length && options.now - state.lastFallbackAt < options.freshForMs) {
        return Promise.resolve(cached);
    }

    if (!state.inflightFallbackBuild) {
        state.inflightFallbackBuild = fetchMarketData()
            .then((data) => commitFallbackMarketData(state, data, options.now))
            .finally(() => {
                state.inflightFallbackBuild = null;
            });
    }

    return state.inflightFallbackBuild;
}

export function ensureCachedMarketBuild(
    state: MarketDataRouteState,
    buildMarketData: () => Promise<TickerData[]>,
    now: number | (() => number) = Date.now,
): Promise<TickerData[]> {
    if (!state.inflightMarketBuild) {
        state.inflightMarketBuild = buildMarketData()
            .then((data) => commitSuccessfulMarketData(
                state,
                data,
                typeof now === 'function' ? now() : now,
            ))
            .finally(() => {
                state.inflightMarketBuild = null;
            });
    }

    return state.inflightMarketBuild;
}

export interface MarketSnapshotDecision {
    state: 'fresh' | 'stale-refreshing' | 'building';
    data: TickerData[] | null;
    build: Promise<TickerData[]> | null;
}

export function resolveMarketSnapshotRequest(
    state: MarketDataRouteState,
    buildMarketData: () => Promise<TickerData[]>,
    options: {
        now: number;
        freshForMs: number;
        startBuild?: boolean;
    },
): MarketSnapshotDecision {
    const snapshot = state.lastSuccessfulMarketData;
    const isFresh = Boolean(
        snapshot?.length
        && options.now - state.lastSuccessfulAt < options.freshForMs,
    );

    if (isFresh) {
        return { state: 'fresh', data: snapshot, build: null };
    }

    const build = options.startBuild === false
        ? null
        : ensureCachedMarketBuild(state, buildMarketData);
    if (snapshot?.length) {
        return { state: 'stale-refreshing', data: snapshot, build };
    }

    return { state: 'building', data: null, build };
}
