import assert from 'node:assert/strict';
import test from 'node:test';

import {
    compareMarketUniverses,
    summarizeMarketCoverage,
    validateMarketHealthPayload,
} from './market-enrichment-helpers.mjs';

const baseTicker = (symbol) => ({
    symbol,
    lastPrice: '100',
    quoteVolume: '1000000',
    markPrice: '100',
    fundingRate: '0.0001',
});

test('compareMarketUniverses requires every lightweight symbol in the enriched snapshot', () => {
    assert.deepEqual(
        compareMarketUniverses(
            [baseTicker('BTCUSDT'), baseTicker('ETHUSDT')],
            [baseTicker('ETHUSDT'), baseTicker('BTCUSDT')],
        ),
        {
            lightweightCount: 2,
            enrichedCount: 2,
            missing: [],
            unexpected: [],
            lightweightDuplicates: [],
            enrichedDuplicates: [],
        },
    );

    assert.deepEqual(
        compareMarketUniverses(
            [baseTicker('BTCUSDT'), baseTicker('ETHUSDT')],
            [baseTicker('BTCUSDT'), baseTicker('SOLUSDT')],
        ),
        {
            lightweightCount: 2,
            enrichedCount: 2,
            missing: ['ETHUSDT'],
            unexpected: ['SOLUSDT'],
            lightweightDuplicates: [],
            enrichedDuplicates: [],
        },
    );
});

test('summarizeMarketCoverage reports required fields and enhanced field coverage independently', () => {
    const summary = summarizeMarketCoverage([
        { ...baseTicker('BTCUSDT'), rsrsMethod: 'shared-core', atr: 2, openInterestValue: '10' },
        { ...baseTicker('ETHUSDT'), openInterestValue: '20' },
    ], {
        requiredFields: ['symbol', 'lastPrice', 'markPrice', 'fundingRate'],
        enhancedFields: ['rsrsMethod', 'atr', 'openInterestValue'],
        requiredNumericFields: ['lastPrice'],
        enhancedNumericFields: ['atr', 'openInterestValue'],
    });

    assert.deepEqual(summary.missingRequired, []);
    assert.deepEqual(summary.invalidNumeric, []);
    assert.deepEqual(summary.enhancedCoverage, {
        rsrsMethod: { count: 1, ratio: 0.5 },
        atr: { count: 1, ratio: 0.5 },
        openInterestValue: { count: 2, ratio: 1 },
    });
});

test('compareMarketUniverses reports duplicate symbols instead of masking them', () => {
    const result = compareMarketUniverses(
        [baseTicker('BTCUSDT'), baseTicker('BTCUSDT')],
        [baseTicker('BTCUSDT'), baseTicker('BTCUSDT')],
    );
    assert.deepEqual(result.lightweightDuplicates, ['BTCUSDT']);
    assert.deepEqual(result.enrichedDuplicates, ['BTCUSDT']);
});

test('validateMarketHealthPayload rejects lightweight and malformed readiness responses', () => {
    assert.deepEqual(validateMarketHealthPayload({
        service: 'market',
        ready: true,
        dataQuality: 'enriched',
        buildState: 'ready',
        symbolCount: 660,
        serving: true,
        snapshotAgeSeconds: 10,
    }), []);

    assert.deepEqual(validateMarketHealthPayload({
        service: 'market',
        ready: false,
        dataQuality: 'lightweight',
        buildState: 'blocked',
        symbolCount: 660,
        serving: true,
        snapshotAgeSeconds: 10,
    }), [
        'market health is not ready',
        'market health dataQuality is lightweight',
        'market health buildState is blocked',
    ]);
});
