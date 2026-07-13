import type { MarketDataRouteState } from './marketRouteCache.ts';
import type { SharedMarketMetadata } from './marketCoordination.ts';

export type MarketHealthStatus = 'ready' | 'degraded' | 'not-ready';

export interface MarketHealthSummary {
    service: 'market';
    status: MarketHealthStatus;
    ready: boolean;
    serving: boolean;
    dataQuality: 'enriched' | 'lightweight' | 'unavailable';
    buildState: 'ready' | 'building' | 'stuck' | 'blocked';
    reason: 'enriched-snapshot-ready' | 'enrichment-building' | 'enrichment-stuck'
        | 'enriched-snapshot-stale' | 'redis-not-configured' | 'no-market-data';
    symbolCount: number;
    snapshotAgeSeconds: number | null;
    redisConfigured: boolean;
}

interface MarketHealthOptions {
    now: number;
    nodeEnv: string | undefined;
    redisConfigured: boolean;
    buildStuckAfterMs: number;
    enrichedMaxAgeMs: number;
}

export function summarizeSharedMarketHealth(
    metadata: SharedMarketMetadata,
    options: MarketHealthOptions,
): MarketHealthSummary {
    const snapshotAgeMs = Math.max(0, options.now - metadata.snapshotAt);
    if (metadata.quality === 'enriched') {
        const stale = snapshotAgeMs > options.enrichedMaxAgeMs;
        return {
            service: 'market',
            status: stale ? 'not-ready' : 'ready',
            ready: !stale,
            serving: true,
            dataQuality: 'enriched',
            buildState: stale ? 'stuck' : metadata.buildState,
            reason: stale ? 'enriched-snapshot-stale' : 'enriched-snapshot-ready',
            symbolCount: metadata.symbolCount,
            snapshotAgeSeconds: Math.floor(snapshotAgeMs / 1000),
            redisConfigured: options.redisConfigured,
        };
    }

    const redisBlocked = options.nodeEnv === 'production' && !options.redisConfigured;
    const stuck = snapshotAgeMs > options.buildStuckAfterMs;
    const ready = !redisBlocked && !stuck;
    return {
        service: 'market',
        status: ready ? 'degraded' : 'not-ready',
        ready,
        serving: true,
        dataQuality: 'lightweight',
        buildState: redisBlocked ? 'blocked' : stuck ? 'stuck' : metadata.buildState,
        reason: redisBlocked ? 'redis-not-configured' : stuck ? 'enrichment-stuck' : 'enrichment-building',
        symbolCount: metadata.symbolCount,
        snapshotAgeSeconds: Math.floor(snapshotAgeMs / 1000),
        redisConfigured: options.redisConfigured,
    };
}

export function summarizeMarketHealth(
    state: MarketDataRouteState,
    options: MarketHealthOptions,
): MarketHealthSummary {
    const enriched = state.lastSuccessfulMarketData;
    if (enriched?.length) {
        const snapshotAgeMs = Math.max(0, options.now - state.lastSuccessfulAt);
        const stale = snapshotAgeMs > options.enrichedMaxAgeMs;
        return {
            service: 'market',
            status: stale ? 'not-ready' : 'ready',
            ready: !stale,
            serving: true,
            dataQuality: 'enriched',
            buildState: stale ? 'stuck' : 'ready',
            reason: stale ? 'enriched-snapshot-stale' : 'enriched-snapshot-ready',
            symbolCount: enriched.length,
            snapshotAgeSeconds: Math.floor(snapshotAgeMs / 1000),
            redisConfigured: options.redisConfigured,
        };
    }

    const fallback = state.lastFallbackMarketData;
    const serving = Boolean(fallback?.length);
    const fallbackAgeMs = serving ? Math.max(0, options.now - state.lastFallbackAt) : 0;
    const redisRequired = options.nodeEnv === 'production';
    const redisBlocked = redisRequired && !options.redisConfigured;
    const stuck = serving && fallbackAgeMs > options.buildStuckAfterMs;
    const ready = serving && !redisBlocked && !stuck;

    return {
        service: 'market',
        status: ready ? 'degraded' : 'not-ready',
        ready,
        serving,
        dataQuality: serving ? 'lightweight' : 'unavailable',
        buildState: redisBlocked ? 'blocked' : stuck ? 'stuck' : 'building',
        reason: redisBlocked
            ? 'redis-not-configured'
            : stuck
                ? 'enrichment-stuck'
                : serving
                    ? 'enrichment-building'
                    : 'no-market-data',
        symbolCount: fallback?.length ?? 0,
        snapshotAgeSeconds: serving ? Math.floor(fallbackAgeMs / 1000) : null,
        redisConfigured: options.redisConfigured,
    };
}
