import assert from 'node:assert/strict';
import test from 'node:test';

import { createMarketDataRouteState } from './marketRouteCache.ts';
import { summarizeMarketHealth, summarizeSharedMarketHealth } from './marketHealth.ts';

test('production without Redis is explicitly not ready while lightweight data remains available', () => {
    const state = createMarketDataRouteState();
    state.lastFallbackMarketData = [{ symbol: 'BTCUSDT' } as never];
    state.lastFallbackAt = 1_000;

    const health = summarizeMarketHealth(state, {
        now: 61_000,
        nodeEnv: 'production',
        redisConfigured: false,
        buildStuckAfterMs: 300_000,
        enrichedMaxAgeMs: 600_000,
    });

    assert.equal(health.status, 'not-ready');
    assert.equal(health.ready, false);
    assert.equal(health.serving, true);
    assert.equal(health.dataQuality, 'lightweight');
    assert.equal(health.reason, 'redis-not-configured');
    assert.equal(health.symbolCount, 1);
});

test('an enriched snapshot is ready and reports its complete symbol count', () => {
    const state = createMarketDataRouteState();
    state.lastSuccessfulMarketData = [
        { symbol: 'BTCUSDT' } as never,
        { symbol: 'ETHUSDT' } as never,
    ];
    state.lastSuccessfulAt = 10_000;

    const health = summarizeMarketHealth(state, {
        now: 20_000,
        nodeEnv: 'production',
        redisConfigured: true,
        buildStuckAfterMs: 300_000,
        enrichedMaxAgeMs: 600_000,
    });

    assert.equal(health.status, 'ready');
    assert.equal(health.ready, true);
    assert.equal(health.dataQuality, 'enriched');
    assert.equal(health.symbolCount, 2);
    assert.equal(health.snapshotAgeSeconds, 10);
});

test('a lightweight snapshot with Redis is degraded before the build budget expires', () => {
    const state = createMarketDataRouteState();
    state.lastFallbackMarketData = [{ symbol: 'BTCUSDT' } as never];
    state.lastFallbackAt = 10_000;

    const health = summarizeMarketHealth(state, {
        now: 250_000,
        nodeEnv: 'production',
        redisConfigured: true,
        buildStuckAfterMs: 300_000,
        enrichedMaxAgeMs: 600_000,
    });

    assert.equal(health.status, 'degraded');
    assert.equal(health.ready, true);
    assert.equal(health.reason, 'enrichment-building');
});

test('a lightweight snapshot that exceeds the build budget becomes not ready', () => {
    const state = createMarketDataRouteState();
    state.lastFallbackMarketData = [{ symbol: 'BTCUSDT' } as never];
    state.lastFallbackAt = 10_000;

    const health = summarizeMarketHealth(state, {
        now: 310_001,
        nodeEnv: 'production',
        redisConfigured: true,
        buildStuckAfterMs: 300_000,
        enrichedMaxAgeMs: 600_000,
    });

    assert.equal(health.status, 'not-ready');
    assert.equal(health.ready, false);
    assert.equal(health.reason, 'enrichment-stuck');
});

test('an expired enriched snapshot remains serving but is not ready', () => {
    const state = createMarketDataRouteState();
    state.lastSuccessfulMarketData = [{ symbol: 'BTCUSDT' } as never];
    state.lastSuccessfulAt = 10_000;

    const health = summarizeMarketHealth(state, {
        now: 610_001,
        nodeEnv: 'production',
        redisConfigured: true,
        buildStuckAfterMs: 300_000,
        enrichedMaxAgeMs: 600_000,
    });

    assert.equal(health.status, 'not-ready');
    assert.equal(health.ready, false);
    assert.equal(health.serving, true);
    assert.equal(health.dataQuality, 'enriched');
    assert.equal(health.buildState, 'stuck');
    assert.equal(health.reason, 'enriched-snapshot-stale');
});

test('shared enriched metadata reconstructs readiness without route-local market data', () => {
    const health = summarizeSharedMarketHealth({
        quality: 'enriched',
        symbolCount: 660,
        snapshotAt: 10_000,
        buildState: 'ready',
        updatedAt: 11_000,
    }, {
        now: 20_000,
        nodeEnv: 'production',
        redisConfigured: true,
        buildStuckAfterMs: 300_000,
        enrichedMaxAgeMs: 600_000,
    });

    assert.equal(health.ready, true);
    assert.equal(health.symbolCount, 660);
    assert.equal(health.snapshotAgeSeconds, 10);
});
