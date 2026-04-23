import assert from 'node:assert/strict';
import test from 'node:test';

import type { KlineData } from '../../app/api/backtest/klines/route.ts';
import {
    assessKlineReadiness,
    mergeKlineDatasets,
} from './klineArchive.ts';
import { detectKlineGaps } from '../klineRangeUtils.ts';

function createKline(index: number, intervalMs: number): KlineData {
    const openTime = index * intervalMs;
    return {
        openTime,
        open: '100',
        high: '101',
        low: '99',
        close: '100',
        volume: '10',
        closeTime: openTime + intervalMs - 1,
        quoteVolume: '1000',
        trades: 10,
        takerBuyVolume: '5',
        takerBuyQuoteVolume: '500',
    };
}

test('mergeKlineDatasets de-duplicates by closeTime and keeps bars sorted', () => {
    const intervalMs = 60 * 60 * 1000;
    const bars = mergeKlineDatasets(
        [createKline(2, intervalMs), createKline(0, intervalMs)],
        [createKline(1, intervalMs), createKline(2, intervalMs)],
    );

    assert.deepEqual(bars.map((bar) => bar.closeTime), [
        createKline(0, intervalMs).closeTime,
        createKline(1, intervalMs).closeTime,
        createKline(2, intervalMs).closeTime,
    ]);
});

test('detectKlineGaps reports missing bars across discontinuities', () => {
    const intervalMs = 60 * 60 * 1000;
    const bars = [
        createKline(0, intervalMs),
        createKline(1, intervalMs),
        createKline(4, intervalMs),
    ];

    const gapStats = detectKlineGaps(bars, intervalMs);
    assert.equal(gapStats.gapCount, 1);
    assert.equal(gapStats.missingBars, 2);
    assert.equal(gapStats.maxGapBars, 2);
});

test('assessKlineReadiness marks gap-free recent archives as ready', () => {
    const intervalMs = 60 * 60 * 1000;
    const bars = Array.from({ length: 24 }, (_, index) => createKline(index, intervalMs));
    const now = bars[bars.length - 1].closeTime + 1;

    const audit = assessKlineReadiness({
        symbol: 'BTCUSDT',
        interval: '1h',
        intervalMs,
        klines: bars,
        now,
    });

    assert.equal(audit.readiness, 'ready');
    assert.equal(audit.gapCount, 0);
    assert.equal(audit.lagBars, 0);
});

test('assessKlineReadiness downgrades archives with gaps to exploratory-only', () => {
    const intervalMs = 60 * 60 * 1000;
    const bars = [
        createKline(0, intervalMs),
        createKline(1, intervalMs),
        createKline(3, intervalMs),
        createKline(4, intervalMs),
    ];
    const now = bars[bars.length - 1].closeTime + intervalMs;

    const audit = assessKlineReadiness({
        symbol: 'ETHUSDT',
        interval: '1h',
        intervalMs,
        klines: bars,
        now,
    });

    assert.equal(audit.readiness, 'exploratory-only');
    assert.equal(audit.gapCount, 1);
    assert.equal(audit.missingBars, 1);
});
