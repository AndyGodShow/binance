import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveMarketEnrichmentLimits } from './marketBuildConfig.ts';
import { resolveWorkspaceMarketPolicy } from './workspaceMarketPolicy.ts';
import { normalizeTickerUniverse } from './liveMarketData.ts';
import type { TickerData } from './types.ts';

test('main market enrichment limits preserve the full market universe', () => {
    const limits = resolveMarketEnrichmentLimits({ NODE_ENV: 'production' });

    assert.equal(limits.oiSnapshotSymbolLimit, Number.POSITIVE_INFINITY);
    assert.equal(limits.klineEnhancementSymbolLimit, Number.POSITIVE_INFINITY);
});

test('workspace market request policy routes ordinary and strategy research explicitly', () => {
    assert.equal(resolveWorkspaceMarketPolicy('dashboard').heavyMarketEndpoint, '/api/market');
    assert.equal(resolveWorkspaceMarketPolicy('strategies').heavyMarketEndpoint, '/api/market/strategy');
    assert.equal(resolveWorkspaceMarketPolicy('strategies').runDeferredIndicatorRequests, false);
    assert.equal(resolveWorkspaceMarketPolicy('trading').runLiveMarketRequests, false);
});

test('dashboard normalization preserves stale and low-volume active USDT rows', () => {
    const base = {
        lastPrice: '1',
        priceChange: '0',
        priceChangePercent: '0',
        weightedAvgPrice: '1',
        prevClosePrice: '1',
        highPrice: '1',
        lowPrice: '1',
        volume: '1',
        openTime: 1,
    };
    const rows = [
        { ...base, symbol: 'LOWUSDT', quoteVolume: '1', closeTime: 1 },
        { ...base, symbol: 'FRESHUSDT', quoteVolume: '1000000', closeTime: Date.now() },
    ] as TickerData[];

    assert.deepEqual(normalizeTickerUniverse(rows).map((row) => row.symbol), ['LOWUSDT', 'FRESHUSDT']);
});
