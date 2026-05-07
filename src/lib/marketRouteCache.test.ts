import assert from 'node:assert/strict';
import test from 'node:test';

import type { TickerData } from './types.ts';
import {
    commitFallbackMarketData,
    createMarketDataRouteState,
    ensureCachedMarketBuild,
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

test('fallback market data is returned as temporary data without replacing enriched cache', () => {
    const state = createMarketDataRouteState();
    const enriched = [createTicker('BTCUSDT')];
    const fallback = [createTicker('ETHUSDT')];

    commitFallbackMarketData(state, fallback, 1000);

    assert.equal(state.lastSuccessfulMarketData, null);
    assert.equal(state.liveMarketCache, null);
    assert.equal(state.lastSuccessfulAt, 0);

    const enrichedState = createMarketDataRouteState();
    enrichedState.lastSuccessfulMarketData = enriched;
    enrichedState.lastSuccessfulAt = 900;
    enrichedState.liveMarketCache = { time: 900, data: enriched, quality: 'enriched', source: 'heavy' };
    const heavyResult = commitFallbackMarketData(enrichedState, fallback, 1001);

    assert.equal(heavyResult, fallback);
    assert.equal(enrichedState.lastSuccessfulMarketData, enriched);
    assert.deepEqual(enrichedState.liveMarketCache, { time: 900, data: enriched, quality: 'enriched', source: 'heavy' });
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
