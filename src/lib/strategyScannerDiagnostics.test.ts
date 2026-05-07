import assert from 'node:assert/strict';
import test from 'node:test';

import {
    buildMarketDataStatus,
    buildReadinessDebugRows,
    isMarketDataStatusDegraded,
} from './strategyScannerDiagnostics.ts';
import type { StrategyInputReadinessSummary } from './strategyInputs.ts';

test('buildMarketDataStatus marks lightweight market data as degraded for scanner UI', () => {
    const status = buildMarketDataStatus({
        dataQuality: 'lightweight',
        buildState: 'building',
        dataSource: 'light-fallback',
    });

    assert.equal(status.dataQuality, 'lightweight');
    assert.equal(status.buildState, 'building');
    assert.equal(status.dataSource, 'light-fallback');
    assert.equal(isMarketDataStatusDegraded(status), true);
});

test('buildMarketDataStatus does not mark enriched ready market data as degraded', () => {
    const status = buildMarketDataStatus({
        dataQuality: 'enriched',
        buildState: 'ready',
        dataSource: 'live',
    });

    assert.equal(isMarketDataStatusDegraded(status), false);
});

test('buildMarketDataStatus falls back safely when headers are missing or unknown', () => {
    const missing = buildMarketDataStatus({});
    const unknown = buildMarketDataStatus({
        dataQuality: 'partial',
        buildState: 'warming',
        dataSource: '',
    });

    assert.deepEqual(missing, {
        dataQuality: 'unknown',
        buildState: 'unknown',
        dataSource: 'unknown',
    });
    assert.deepEqual(unknown, {
        dataQuality: 'unknown',
        buildState: 'unknown',
        dataSource: 'unknown',
    });
    assert.equal(isMarketDataStatusDegraded(missing), false);
});

test('buildReadinessDebugRows exposes strategy id missing count fields and samples', () => {
    const summary: StrategyInputReadinessSummary = {
        totalSymbols: 2,
        byStrategy: {
            'strong-breakout': { symbolsMissingRequiredFields: 0, missingFieldCounts: {}, sampleSymbols: [] },
            'trend-confirmation': { symbolsMissingRequiredFields: 0, missingFieldCounts: {}, sampleSymbols: [] },
            'capital-inflow': {
                symbolsMissingRequiredFields: 2,
                missingFieldCounts: { cvdSlope: 2, vah: 1 },
                sampleSymbols: ['LIGHTUSDT', 'TESTUSDT'],
            },
            'rsrs-trend': { symbolsMissingRequiredFields: 0, missingFieldCounts: {}, sampleSymbols: [] },
            'volatility-squeeze': { symbolsMissingRequiredFields: 0, missingFieldCounts: {}, sampleSymbols: [] },
            'wei-shen-ledger': { symbolsMissingRequiredFields: 0, missingFieldCounts: {}, sampleSymbols: [] },
            'sentiment-hotspot': { symbolsMissingRequiredFields: 0, missingFieldCounts: {}, sampleSymbols: [] },
        },
    };

    const rows = buildReadinessDebugRows(summary);

    assert.deepEqual(rows, [
        {
            strategyId: 'capital-inflow',
            missingSymbolCount: 2,
            missingFields: ['cvdSlope:2', 'vah:1'],
            sampleSymbols: ['LIGHTUSDT', 'TESTUSDT'],
        },
    ]);
});

test('buildReadinessDebugRows stays empty when enriched inputs are complete', () => {
    const summary: StrategyInputReadinessSummary = {
        totalSymbols: 1,
        byStrategy: {
            'strong-breakout': { symbolsMissingRequiredFields: 0, missingFieldCounts: {}, sampleSymbols: [] },
            'trend-confirmation': { symbolsMissingRequiredFields: 0, missingFieldCounts: {}, sampleSymbols: [] },
            'capital-inflow': { symbolsMissingRequiredFields: 0, missingFieldCounts: {}, sampleSymbols: [] },
            'rsrs-trend': { symbolsMissingRequiredFields: 0, missingFieldCounts: {}, sampleSymbols: [] },
            'volatility-squeeze': { symbolsMissingRequiredFields: 0, missingFieldCounts: {}, sampleSymbols: [] },
            'wei-shen-ledger': { symbolsMissingRequiredFields: 0, missingFieldCounts: {}, sampleSymbols: [] },
            'sentiment-hotspot': { symbolsMissingRequiredFields: 0, missingFieldCounts: {}, sampleSymbols: [] },
        },
    };

    assert.deepEqual(buildReadinessDebugRows(summary), []);
});
