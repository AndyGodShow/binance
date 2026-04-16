import test from 'node:test';
import assert from 'node:assert/strict';

import { buildOpenInterestFrameSnapshot } from './openInterestFrameMath.ts';

function buildEntry(minutesAgo: number, value: number, baseTime: number) {
    return {
        symbol: 'BTCUSDT',
        sumOpenInterest: value.toString(),
        sumOpenInterestValue: value.toString(),
        timestamp: baseTime - minutesAgo * 60 * 1000,
    };
}

test('buildOpenInterestFrameSnapshot calculates rolling 15m 1h 4h and 24h changes', () => {
    const baseTime = Date.UTC(2026, 3, 16, 12, 0, 0);
    const snapshot = buildOpenInterestFrameSnapshot('BTCUSDT', [
        buildEntry(24 * 60, 100, baseTime),
        buildEntry(4 * 60, 160, baseTime),
        buildEntry(60, 180, baseTime),
        buildEntry(15, 195, baseTime),
        buildEntry(0, 210, baseTime),
    ]);

    assert.ok(snapshot);
    assert.equal(snapshot.symbol, 'BTCUSDT');
    assert.equal(snapshot.currentValue, 210);
    assert.equal(snapshot.change15m?.value, 15);
    assert.equal(snapshot.change1h?.value, 30);
    assert.equal(snapshot.change4h?.value, 50);
    assert.equal(snapshot.change24h?.value, 110);
    assert.equal(Number(snapshot.change15m?.percent.toFixed(4)), 7.6923);
    assert.equal(Number(snapshot.change1h?.percent.toFixed(4)), 16.6667);
    assert.equal(Number(snapshot.change4h?.percent.toFixed(4)), 31.25);
    assert.equal(Number(snapshot.change24h?.percent.toFixed(4)), 110);
});

test('buildOpenInterestFrameSnapshot skips windows with non-positive baseline values', () => {
    const baseTime = Date.UTC(2026, 3, 16, 12, 0, 0);
    const snapshot = buildOpenInterestFrameSnapshot('ETHUSDT', [
        buildEntry(15, 0, baseTime),
        buildEntry(0, 50, baseTime),
    ]);

    assert.ok(snapshot);
    assert.equal(snapshot.change15m, undefined);
    assert.equal(snapshot.currentValue, 50);
});
