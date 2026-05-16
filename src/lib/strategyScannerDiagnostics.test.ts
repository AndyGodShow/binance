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

test('buildMarketDataStatus marks building enriched data as degraded for scanner UI', () => {
    const status = buildMarketDataStatus({
        dataQuality: 'enriched',
        buildState: 'building',
        dataSource: 'stale-memory-cache-refreshing',
    });

    assert.equal(status.dataQuality, 'enriched');
    assert.equal(status.buildState, 'building');
    assert.equal(isMarketDataStatusDegraded(status), true);
});

test('buildMarketDataStatus accepts partial degraded and unavailable qualities', () => {
    const partial = buildMarketDataStatus({
        dataQuality: 'partial',
        buildState: 'ready',
        dataSource: 'symbols-batch',
    });
    const unavailable = buildMarketDataStatus({
        dataQuality: 'unavailable',
        buildState: 'failed',
        dataSource: 'empty-fallback',
    });

    assert.equal(partial.dataQuality, 'partial');
    assert.equal(unavailable.dataQuality, 'unavailable');
    assert.equal(isMarketDataStatusDegraded(partial), true);
    assert.equal(isMarketDataStatusDegraded(unavailable), true);
});

test('buildMarketDataStatusMessage explains degraded market states', () => {
    assert.equal(
        buildMarketDataStatus({
            dataQuality: 'lightweight',
            buildState: 'ready',
            dataSource: 'light',
        }).message,
        '市场数据为轻量模式，部分策略字段暂不可用'
    );
    assert.equal(
        buildMarketDataStatus({
            dataQuality: 'enriched',
            buildState: 'building',
            dataSource: 'stale-memory-cache-refreshing',
        }).message,
        '正在重建完整市场数据，当前结果可能不完整'
    );
    assert.equal(
        buildMarketDataStatus({
            dataQuality: 'stale',
            buildState: 'stale',
            dataSource: 'stale-memory-cache',
        }).message,
        '正在使用旧缓存'
    );
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
        dataQuality: 'unavailable',
        buildState: 'idle',
        dataSource: 'unknown',
        isDegraded: false,
        isUnavailable: false,
        message: undefined,
    });
    assert.deepEqual(unknown, {
        dataQuality: 'partial',
        buildState: 'idle',
        dataSource: 'unknown',
        isDegraded: true,
        isUnavailable: false,
        message: '部分外部数据源失败，结果已降级',
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
