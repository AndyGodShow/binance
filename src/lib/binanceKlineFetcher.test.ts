import test from 'node:test';
import assert from 'node:assert/strict';

import { buildKlineFetchPlan, getKlineIntervalMs } from './binanceKlineFetcher.ts';

test('getKlineIntervalMs resolves common Binance intervals', () => {
    assert.equal(getKlineIntervalMs('15m'), 15 * 60 * 1000);
    assert.equal(getKlineIntervalMs('4h'), 4 * 60 * 60 * 1000);
    assert.equal(getKlineIntervalMs('1d'), 24 * 60 * 60 * 1000);
});

test('buildKlineFetchPlan splits large ranged requests into smaller chunks', () => {
    const intervalMs = 15 * 60 * 1000;
    const startTime = Date.UTC(2026, 0, 1, 0, 0, 0);
    const endTime = startTime + intervalMs * 1499;

    const plan = buildKlineFetchPlan({
        interval: '15m',
        startTime,
        endTime,
        limit: 1500,
    });

    assert.equal(plan.length, 6);
    assert.deepEqual(
        plan.map((entry) => entry.limit),
        [250, 250, 250, 250, 250, 250]
    );
    assert.equal(plan[0].startTime, startTime);
    assert.equal(plan[5].endTime, endTime);
});

test('buildKlineFetchPlan keeps short requests as a single call', () => {
    const startTime = Date.UTC(2026, 0, 1, 0, 0, 0);
    const endTime = startTime + (60 * 60 * 1000 * 23);

    const plan = buildKlineFetchPlan({
        interval: '1h',
        startTime,
        endTime,
        limit: 24,
    });

    assert.equal(plan.length, 1);
    assert.equal(plan[0].limit, 24);
});
