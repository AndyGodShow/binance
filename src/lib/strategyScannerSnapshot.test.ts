import assert from 'node:assert/strict';
import test from 'node:test';

import type { StrategySignal } from './strategyTypes.ts';
import type { TickerData } from './types.ts';
import {
    buildStrategyScannerTickerDigest,
    createStrategySignalSnapshotDigest,
    selectScannerSignalForSymbol,
} from './strategyScannerSnapshot.ts';

function createTicker(overrides: Partial<TickerData> = {}): TickerData {
    return {
        symbol: 'BTCUSDT',
        lastPrice: '100000',
        priceChange: '1000',
        priceChangePercent: '1.0',
        weightedAvgPrice: '99500',
        prevClosePrice: '99000',
        highPrice: '101000',
        lowPrice: '98000',
        volume: '1000',
        quoteVolume: '100000000',
        openTime: 1,
        closeTime: 2,
        ...overrides,
    };
}

function createSignal(overrides: Partial<StrategySignal> = {}): StrategySignal {
    return {
        symbol: 'BTCUSDT',
        strategyId: 'strong-breakout',
        strategyName: 'Strong Breakout',
        direction: 'long',
        confidence: 90,
        reason: 'test',
        metrics: {},
        timestamp: 1,
        ...overrides,
    };
}

test('buildStrategyScannerTickerDigest changes when tracked scanner fields change', () => {
    const ticker = createTicker({ rsrsFinal: 1.2, strategyContexts: { weiShen: { marketRegime: 'risk-on' } as never } });
    const baseline = buildStrategyScannerTickerDigest(ticker);
    const changedRsrs = buildStrategyScannerTickerDigest(createTicker({ rsrsFinal: 1.3, strategyContexts: { weiShen: { marketRegime: 'risk-on' } as never } }));
    const changedContext = buildStrategyScannerTickerDigest(createTicker({ rsrsFinal: 1.2, strategyContexts: { weiShen: { marketRegime: 'risk-off' } as never } }));

    assert.notEqual(baseline, changedRsrs);
    assert.notEqual(baseline, changedContext);
});

test('selectScannerSignalForSymbol prefers tradable signals and applies combo bonus', () => {
    const selected = selectScannerSignalForSymbol([
        createSignal({ strategyId: 'a', strategyName: 'A', confidence: 88 }),
        createSignal({ strategyId: 'b', strategyName: 'B', confidence: 93 }),
        createSignal({ strategyId: 'c', strategyName: 'C', confidence: 86, executionMode: 'observe' }),
    ]);

    assert.ok(selected);
    assert.equal(selected.strategyId, 'b');
    assert.equal(selected.confidence, 103);
    assert.equal(selected.stackCount, 2);
    assert.deepEqual(selected.stackedStrategies, ['A', 'B']);
    assert.equal(selected.comboBonus, 10);
});

test('selectScannerSignalForSymbol falls back to highest-confidence observation when no tradable signal exists', () => {
    const selected = selectScannerSignalForSymbol([
        createSignal({ strategyId: 'observe-a', strategyName: 'Observe A', confidence: 80, executionMode: 'observe' }),
        createSignal({ strategyId: 'observe-b', strategyName: 'Observe B', confidence: 84, executionMode: 'observe' }),
    ]);

    assert.ok(selected);
    assert.equal(selected.strategyId, 'observe-b');
    assert.equal(selected.stackCount, 1);
    assert.deepEqual(selected.stackedStrategies, ['Observe B']);
    assert.equal(selected.comboBonus, 0);
});

test('createStrategySignalSnapshotDigest is deterministic regardless of signal order', () => {
    const digestA = createStrategySignalSnapshotDigest([
        createSignal({ symbol: 'ETHUSDT', strategyId: 'trend-confirmation', status: 'snapshot', confidence: 87 }),
        createSignal({ symbol: 'BTCUSDT', strategyId: 'strong-breakout', status: 'active', confidence: 92 }),
    ]);
    const digestB = createStrategySignalSnapshotDigest([
        createSignal({ symbol: 'BTCUSDT', strategyId: 'strong-breakout', status: 'active', confidence: 92 }),
        createSignal({ symbol: 'ETHUSDT', strategyId: 'trend-confirmation', status: 'snapshot', confidence: 87 }),
    ]);

    assert.equal(digestA, digestB);
});
