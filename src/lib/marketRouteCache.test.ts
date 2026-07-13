import assert from 'node:assert/strict';
import test from 'node:test';

import type { TickerData } from './types.ts';
import {
    commitFallbackMarketData,
    createMarketDataRouteState,
    ensureCachedMarketBuild,
    ensureFreshFallbackMarketData,
} from './marketRouteCache.ts';

function createTicker(symbol: string): TickerData {
    return {
        symbol,
        lastPrice: '100',
        priceChange: '1',
        priceChangePercent: '1',
        weightedAvgPrice: '99',
        prevClosePrice: '98',
        highPrice: '101',
        lowPrice: '97',
        volume: '1000',
        quoteVolume: '1000000',
        openTime: 1,
        closeTime: Date.now(),
    };
}

test('ensureCachedMarketBuild stores successful heavy market data for later route responses', async () => {
    const state = createMarketDataRouteState();
    const data = [createTicker('BTCUSDT')];

    const result = await ensureCachedMarketBuild(state, async () => data, 12345);

    assert.equal(result, data);
    assert.equal(state.lastSuccessfulMarketData, data);
    assert.equal(state.lastSuccessfulAt, 12345);
    assert.deepEqual(state.liveMarketCache, { time: 12345, data, quality: 'enriched', source: 'heavy' });
    assert.equal(state.inflightMarketBuild, null);
});

test('ensureCachedMarketBuild reuses an in-flight heavy market build', async () => {
    const state = createMarketDataRouteState();
    let buildCount = 0;
    let resolveBuild: ((value: TickerData[]) => void) | undefined;
    const data = [createTicker('ETHUSDT')];

    const first = ensureCachedMarketBuild(
        state,
        () => {
            buildCount += 1;
            return new Promise<TickerData[]>((resolve) => {
                resolveBuild = resolve;
            });
        },
        20000,
    );
    const second = ensureCachedMarketBuild(state, async () => [createTicker('SOLUSDT')], 20001);

    resolveBuild?.(data);

    assert.equal(await first, data);
    assert.equal(await second, data);
    assert.equal(buildCount, 1);
    assert.equal(state.lastSuccessfulMarketData, data);
});

test('ensureCachedMarketBuild stamps cache when the build completes', async () => {
    const state = createMarketDataRouteState();
    const data = [createTicker('BNBUSDT')];
    let now = 1000;
    let resolveBuild: ((value: TickerData[]) => void) | undefined;

    const build = ensureCachedMarketBuild(
        state,
        () => new Promise<TickerData[]>((resolve) => {
            resolveBuild = resolve;
        }),
        () => now,
    );

    now = 7000;
    resolveBuild?.(data);

    assert.equal(await build, data);
    assert.equal(state.lastSuccessfulAt, 7000);
    assert.deepEqual(state.liveMarketCache, { time: 7000, data, quality: 'enriched', source: 'heavy' });
});

test('fallback market data is returned as temporary data without replacing enriched cache', () => {
    const state = createMarketDataRouteState();
    const enriched = [createTicker('BTCUSDT')];
    const fallback = [createTicker('ETHUSDT')];

    commitFallbackMarketData(state, fallback, 1000);

    assert.equal(state.lastSuccessfulMarketData, null);
    assert.equal(state.liveMarketCache, null);
    assert.equal(state.lastSuccessfulAt, 0);
    assert.equal(state.lastFallbackMarketData, fallback);
    assert.equal(state.lastFallbackAt, 1000);

    const enrichedState = createMarketDataRouteState();
    enrichedState.lastSuccessfulMarketData = enriched;
    enrichedState.lastSuccessfulAt = 900;
    enrichedState.liveMarketCache = { time: 900, data: enriched, quality: 'enriched', source: 'heavy' };
    const heavyResult = commitFallbackMarketData(enrichedState, fallback, 1001);

    assert.equal(heavyResult, fallback);
    assert.equal(enrichedState.lastSuccessfulMarketData, enriched);
    assert.deepEqual(enrichedState.liveMarketCache, { time: 900, data: enriched, quality: 'enriched', source: 'heavy' });
    assert.equal(enrichedState.lastFallbackMarketData, fallback);
});

test('heavy timeout fallback stays temporary and later heavy completion updates cache to enriched', async () => {
    const state = createMarketDataRouteState();
    const fallback = [createTicker('LIGHTUSDT')];
    const enriched = [createTicker('BTCUSDT')];
    let resolveBuild: ((value: TickerData[]) => void) | undefined;

    const heavyBuild = ensureCachedMarketBuild(
        state,
        () => new Promise<TickerData[]>((resolve) => {
            resolveBuild = resolve;
        }),
        1234,
    );

    const fallbackResponse = commitFallbackMarketData(state, fallback, 1000);
    assert.equal(fallbackResponse, fallback);
    assert.equal(state.lastSuccessfulMarketData, null);
    assert.equal(state.liveMarketCache, null);

    resolveBuild?.(enriched);
    assert.equal(await heavyBuild, enriched);
    assert.equal(state.lastSuccessfulMarketData, enriched);
    assert.deepEqual(state.liveMarketCache, { time: 1234, data: enriched, quality: 'enriched', source: 'heavy' });
});

test('failed heavy market build preserves the previous enriched cache', async () => {
    const state = createMarketDataRouteState();
    const enriched = [createTicker('BTCUSDT')];
    await ensureCachedMarketBuild(state, async () => enriched, 123);

    await assert.rejects(
        ensureCachedMarketBuild(state, async () => {
            throw new Error('upstream failed');
        }, 456),
        /upstream failed/,
    );

    assert.equal(state.lastSuccessfulMarketData, enriched);
    assert.deepEqual(state.liveMarketCache, { time: 123, data: enriched, quality: 'enriched', source: 'heavy' });
    assert.equal(state.inflightMarketBuild, null);
});

test('fresh lightweight market data is reused without another upstream fetch', async () => {
    const state = createMarketDataRouteState();
    const fallback = [createTicker('BTCUSDT')];
    commitFallbackMarketData(state, fallback, 1_000);
    let fetchCount = 0;

    const result = await ensureFreshFallbackMarketData(state, async () => {
        fetchCount += 1;
        return [createTicker('ETHUSDT')];
    }, { now: 5_000, freshForMs: 10_000 });

    assert.equal(result, fallback);
    assert.equal(fetchCount, 0);
});

test('stale lightweight market data is refreshed once for concurrent callers', async () => {
    const state = createMarketDataRouteState();
    commitFallbackMarketData(state, [createTicker('OLDUSDT')], 1_000);
    const refreshed = [createTicker('BTCUSDT'), createTicker('ETHUSDT')];
    let fetchCount = 0;
    let resolveFetch: ((value: TickerData[]) => void) | undefined;

    const fetchMarketData = () => {
        fetchCount += 1;
        return new Promise<TickerData[]>((resolve) => {
            resolveFetch = resolve;
        });
    };
    const first = ensureFreshFallbackMarketData(
        state,
        fetchMarketData,
        { now: 20_000, freshForMs: 10_000 },
    );
    const second = ensureFreshFallbackMarketData(
        state,
        fetchMarketData,
        { now: 20_001, freshForMs: 10_000 },
    );

    resolveFetch?.(refreshed);

    assert.equal(await first, refreshed);
    assert.equal(await second, refreshed);
    assert.equal(fetchCount, 1);
    assert.equal(state.lastFallbackMarketData, refreshed);
    assert.equal(state.lastFallbackAt, 20_000);
    assert.equal(state.inflightFallbackBuild, null);
});

test('failed lightweight refresh preserves the previous fallback snapshot', async () => {
    const state = createMarketDataRouteState();
    const fallback = [createTicker('BTCUSDT')];
    commitFallbackMarketData(state, fallback, 1_000);

    await assert.rejects(
        ensureFreshFallbackMarketData(
            state,
            async () => { throw new Error('upstream unavailable'); },
            { now: 20_000, freshForMs: 10_000 },
        ),
        /upstream unavailable/,
    );

    assert.equal(state.lastFallbackMarketData, fallback);
    assert.equal(state.lastFallbackAt, 1_000);
    assert.equal(state.inflightFallbackBuild, null);
});
