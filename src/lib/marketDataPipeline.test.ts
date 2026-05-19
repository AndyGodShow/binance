import assert from 'node:assert/strict';
import test from 'node:test';

import {
    buildMarketKlineEnhancementStagePlan,
    fetchMarketKlineEnhancementGroup,
    resolveMarketEnrichmentLimits,
    resolveMarketKlineBatchSize,
    selectMarketKlineEligibleSymbols,
} from './marketBuildConfig.ts';

test('resolveMarketEnrichmentLimits requests full market enrichment coverage', () => {
    assert.deepEqual(resolveMarketEnrichmentLimits({ NODE_ENV: 'development' }), {
        oiSnapshotSymbolLimit: Number.POSITIVE_INFINITY,
        klineEnhancementSymbolLimit: Number.POSITIVE_INFINITY,
    });
    assert.deepEqual(resolveMarketEnrichmentLimits({ NODE_ENV: 'production' }), {
        oiSnapshotSymbolLimit: Number.POSITIVE_INFINITY,
        klineEnhancementSymbolLimit: Number.POSITIVE_INFINITY,
    });
});

test('resolveMarketKlineBatchSize lowers Binance kline concurrency in development', () => {
    assert.equal(resolveMarketKlineBatchSize(5, { NODE_ENV: 'development' }), 2);
    assert.equal(resolveMarketKlineBatchSize(1, { NODE_ENV: 'development' }), 1);
    assert.equal(resolveMarketKlineBatchSize(5, { NODE_ENV: 'production' }), 5);
});

test('buildMarketKlineEnhancementStagePlan keeps eligible klines before wei-shen klines', () => {
    const plan = buildMarketKlineEnhancementStagePlan({
        eligibleSymbols: ['BTCUSDT', 'ETHUSDT'],
        weiUniverseSymbols: ['BTCUSDT', 'SOLUSDT'],
        weiShenTimeframes: {
            signalInterval: '1h',
            confirmInterval: '4h',
            dailyFilterInterval: '1d',
        },
    });

    assert.deepEqual(plan.eligible.map((request) => request.label), ['eligible-15m', 'eligible-5m', 'eligible-1d']);
    assert.deepEqual(plan.eligible.map((request) => request.interval), ['15m', '5m', '1d']);
    assert.deepEqual(plan.weiShen.map((request) => request.label), ['wei-signal', 'wei-confirm', 'wei-daily']);
    assert.deepEqual(plan.weiShen.map((request) => request.interval), ['1h', '4h', '1d']);
});

test('selectMarketKlineEligibleSymbols caps volume universe while preserving wei-shen symbols', () => {
    const selected = selectMarketKlineEligibleSymbols({
        eligibleSymbols: ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'DOGEUSDT'],
        weiUniverseSymbols: ['SOLUSDT', 'BNBUSDT'],
        maxEligibleSymbols: 2,
    });

    assert.deepEqual(selected, ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT']);
});

test('fetchMarketKlineEnhancementGroup returns an empty map when one kline group fails', async () => {
    const warnings: Array<{ message: string; context?: Record<string, unknown> }> = [];
    const result = await fetchMarketKlineEnhancementGroup(
        { label: 'eligible-15m', symbols: ['BTCUSDT', 'ETHUSDT'], interval: '15m', limit: 50 },
        2,
        async () => {
            throw new Error('upstream reset');
        },
        {
            warn(message, context) {
                warnings.push({ message, context });
            },
        },
        (() => {
            let now = 1000;
            return () => {
                now += 25;
                return now;
            };
        })(),
    );

    assert.equal(result.size, 0);
    assert.equal(warnings.length, 1);
    assert.equal(warnings[0].message, 'Market kline enrichment group failed');
    assert.equal(warnings[0].context?.label, 'eligible-15m');
    assert.equal(warnings[0].context?.interval, '15m');
    assert.equal(warnings[0].context?.requestedSymbols, 2);
    assert.equal(warnings[0].context?.error, 'upstream reset');
});

test('fetchMarketKlineEnhancementGroup preserves fulfilled symbol data when only part of a group is missing', async () => {
    const warnings: Array<{ message: string; context?: Record<string, unknown> }> = [];
    const result = await fetchMarketKlineEnhancementGroup(
        { label: 'eligible-5m', symbols: ['BTCUSDT', 'ETHUSDT'], interval: '5m', limit: 120 },
        2,
        async () => new Map([['BTCUSDT', [{ close: 100 }]]]),
        {
            warn(message, context) {
                warnings.push({ message, context });
            },
        },
    );

    assert.equal(result.size, 1);
    assert.deepEqual(result.get('BTCUSDT'), [{ close: 100 }]);
    assert.equal(warnings.length, 1);
    assert.equal(warnings[0].message, 'Market kline enrichment partially unavailable');
    assert.equal(warnings[0].context?.fulfilledSymbols, 1);
    assert.equal(warnings[0].context?.missingSymbols, 1);
});
