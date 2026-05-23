import assert from 'node:assert/strict';
import test from 'node:test';

import type { StrategySignal } from './strategyTypes.ts';
import type { TickerData } from './types.ts';
import {
    buildStrategyScannerTickerDigest,
    createStrategySignalSnapshotDigest,
    filterScannerSignalsByEnabledStrategies,
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

test('buildStrategyScannerTickerDigest changes when strategy-only inputs change', () => {
    const ticker = createTicker({
        volume: '1000',
        volumeChangePercent: 4,
        bollingerMid: 100,
        plusDI: 24,
        minusDI: 18,
        ohlc: [
            { time: 1, open: 99, high: 101, low: 98, close: 100, volume: 10 },
            { time: 2, open: 100, high: 103, low: 99, close: 102, volume: 12 },
        ],
    });
    const baseline = buildStrategyScannerTickerDigest(ticker);

    assert.notEqual(baseline, buildStrategyScannerTickerDigest(createTicker({ ...ticker, volume: '1001' })));
    assert.notEqual(baseline, buildStrategyScannerTickerDigest(createTicker({ ...ticker, volumeChangePercent: 5 })));
    assert.notEqual(baseline, buildStrategyScannerTickerDigest(createTicker({ ...ticker, bollingerMid: 101 })));
    assert.notEqual(baseline, buildStrategyScannerTickerDigest(createTicker({ ...ticker, plusDI: 25 })));
    assert.notEqual(baseline, buildStrategyScannerTickerDigest(createTicker({ ...ticker, minusDI: 19 })));
    assert.notEqual(baseline, buildStrategyScannerTickerDigest(createTicker({
        ...ticker,
        ohlc: [
            { time: 1, open: 99, high: 101, low: 98, close: 100, volume: 10 },
            { time: 2, open: 100, high: 104, low: 99, close: 103, volume: 12 },
        ],
    })));
});

test('selectScannerSignalForSymbol prefers tradable signals and applies combo bonus', () => {
    const selected = selectScannerSignalForSymbol([
        createSignal({ strategyId: 'a', strategyName: 'A', confidence: 88 }),
        createSignal({ strategyId: 'b', strategyName: 'B', confidence: 93 }),
        createSignal({ strategyId: 'c', strategyName: 'C', confidence: 86, executionMode: 'observe' }),
    ]);

    assert.ok(selected);
    assert.equal(selected.strategyId, 'b');
    assert.equal(selected.confidence, 100);
    assert.equal(selected.stackCount, 2);
    assert.deepEqual(selected.stackedStrategies, ['A', 'B']);
    assert.equal(selected.comboBonus, 10);
    assert.deepEqual(selected.stackedSignalDetails?.map((detail) => detail.strategyId), ['a', 'b']);
    assert.equal(selected.stackedSignalDetails?.[1]?.confidence, 93);
});

test('selectScannerSignalForSymbol keeps confidence inside the 100 point scale', () => {
    const selected = selectScannerSignalForSymbol([
        createSignal({ strategyId: 'a', strategyName: 'A', confidence: 100 }),
        createSignal({ strategyId: 'b', strategyName: 'B', confidence: 95 }),
        createSignal({ strategyId: 'c', strategyName: 'C', confidence: 92 }),
    ]);

    assert.ok(selected);
    assert.equal(selected.confidence, 100);
    assert.equal(selected.comboBonus, 20);
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

test('filterScannerSignalsByEnabledStrategies keeps stacked signals when an enabled strategy is nested', () => {
    const selected = selectScannerSignalForSymbol([
        createSignal({ strategyId: 'strong-breakout', strategyName: 'Strong Breakout', confidence: 95 }),
        createSignal({ strategyId: 'capital-inflow', strategyName: 'Capital Inflow', confidence: 88 }),
    ]);

    assert.ok(selected);

    const filtered = filterScannerSignalsByEnabledStrategies([selected], new Set(['capital-inflow']));

    assert.equal(filtered.length, 1);
    assert.equal(filtered[0].symbol, 'BTCUSDT');
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
