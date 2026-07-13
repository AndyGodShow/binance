import assert from 'node:assert/strict';
import test from 'node:test';

import type { TickerData } from './types.ts';
import {
    createMarketDataRouteState,
    resolveMarketSnapshotRequest,
} from './marketRouteCache.ts';
import { runMarketEnhancementBatches } from './marketBuildConfig.ts';

function createTicker(symbol: string, marker: string): TickerData {
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
        rsrsMethod: marker,
    };
}

test('expired snapshot is returned immediately while one background refresh replaces it', async () => {
    const state = createMarketDataRouteState();
    const staleSnapshot = [
        createTicker('BTCUSDT', 'stale-btc'),
        createTicker('ETHUSDT', 'stale-eth'),
    ];
    const refreshedSnapshot = [
        createTicker('BTCUSDT', 'fresh-btc'),
        createTicker('ETHUSDT', 'fresh-eth'),
        createTicker('SOLUSDT', 'fresh-sol'),
    ];
    state.lastSuccessfulMarketData = staleSnapshot;
    state.lastSuccessfulAt = 1_000;
    state.liveMarketCache = {
        time: 1_000,
        data: staleSnapshot,
        quality: 'enriched',
        source: 'heavy',
    };

    let buildCount = 0;
    let resolveBuild: ((data: TickerData[]) => void) | undefined;
    const build = () => {
        buildCount += 1;
        return new Promise<TickerData[]>((resolve) => {
            resolveBuild = resolve;
        });
    };

    const first = resolveMarketSnapshotRequest(state, build, {
        now: 61_001,
        freshForMs: 60_000,
    });
    const second = resolveMarketSnapshotRequest(state, build, {
        now: 61_002,
        freshForMs: 60_000,
    });

    assert.equal(first.state, 'stale-refreshing');
    assert.equal(second.state, 'stale-refreshing');
    assert.equal(first.data, staleSnapshot);
    assert.equal(second.data, staleSnapshot);
    assert.equal(buildCount, 1);
    assert.equal(first.build, second.build);

    resolveBuild?.(refreshedSnapshot);
    assert.equal(await first.build, refreshedSnapshot);
    assert.equal(state.lastSuccessfulMarketData, refreshedSnapshot);
});

test('cold start reports building and coalesces concurrent requests onto one full build', async () => {
    const state = createMarketDataRouteState();
    const fullSnapshot = Array.from({ length: 660 }, (_, index) =>
        createTicker(`SYMBOL${index}USDT`, `marker-${index}`)
    );
    let buildCount = 0;
    let resolveBuild: ((data: TickerData[]) => void) | undefined;
    const build = () => {
        buildCount += 1;
        return new Promise<TickerData[]>((resolve) => {
            resolveBuild = resolve;
        });
    };

    const first = resolveMarketSnapshotRequest(state, build, {
        now: 10_000,
        freshForMs: 60_000,
    });
    const second = resolveMarketSnapshotRequest(state, build, {
        now: 10_001,
        freshForMs: 60_000,
    });

    assert.equal(first.state, 'building');
    assert.equal(second.state, 'building');
    assert.equal(first.data, null);
    assert.equal(second.data, null);
    assert.equal(buildCount, 1);
    assert.equal(first.build, second.build);

    resolveBuild?.(fullSnapshot);
    const completed = await first.build!;
    assert.equal(completed.length, 660);
    assert.deepEqual(completed, fullSnapshot);
});

test('snapshot freshness is independent from build deadline and never trims cached ticker fields', () => {
    const state = createMarketDataRouteState();
    const completeSnapshot = Array.from({ length: 660 }, (_, index) =>
        createTicker(`SYMBOL${index}USDT`, `preserved-${index}`)
    );
    state.lastSuccessfulMarketData = completeSnapshot;
    state.lastSuccessfulAt = 100_000;
    state.liveMarketCache = {
        time: 100_000,
        data: completeSnapshot,
        quality: 'enriched',
        source: 'heavy',
    };

    const decision = resolveMarketSnapshotRequest(
        state,
        async () => assert.fail('fresh snapshot must not trigger a build'),
        {
            now: 159_999,
            freshForMs: 60_000,
        },
    );

    assert.equal(decision.state, 'fresh');
    assert.equal(decision.data, completeSnapshot);
    assert.equal(decision.data?.length, 660);
    assert.deepEqual(decision.data?.[659], completeSnapshot[659]);
    assert.equal(decision.build, null);
});

test('abort signal stops enhancement before a later symbol batch starts', async () => {
    const controller = new AbortController();
    const startedBatches: string[][] = [];

    await assert.rejects(
        runMarketEnhancementBatches(
            ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT'],
            2,
            async (symbols, context) => {
                startedBatches.push(symbols);
                assert.equal(context.signal, controller.signal);
                assert.equal(context.deadlineAt, 5_000);
                controller.abort(new Error('client disconnected'));
            },
            {
                signal: controller.signal,
                deadlineAt: 5_000,
                now: () => 1_000,
            },
        ),
        /client disconnected|aborted/i,
    );

    assert.deepEqual(startedBatches, [['BTCUSDT', 'ETHUSDT']]);
});

test('deadline stops enhancement before a later symbol batch starts', async () => {
    const startedBatches: string[][] = [];
    let now = 1_000;

    await assert.rejects(
        runMarketEnhancementBatches(
            ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT'],
            2,
            async (symbols) => {
                startedBatches.push(symbols);
                now = 5_001;
            },
            {
                deadlineAt: 5_000,
                now: () => now,
            },
        ),
        /deadline/i,
    );

    assert.deepEqual(startedBatches, [['BTCUSDT', 'ETHUSDT']]);
});
