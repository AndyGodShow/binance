import test from 'node:test';
import assert from 'node:assert/strict';

import {
    getDailyNewsMaxAgeMs,
    isDailyNewsDigestStale,
    shouldGenerateDailyNewsOnRead,
} from './dailyNewsReadPolicy.ts';

test('shouldGenerateDailyNewsOnRead defaults to allowing automatic generation even in production', () => {
    assert.equal(shouldGenerateDailyNewsOnRead('development'), true);
    assert.equal(shouldGenerateDailyNewsOnRead('test'), true);
    assert.equal(shouldGenerateDailyNewsOnRead('production'), true);
});

test('shouldGenerateDailyNewsOnRead respects an explicit false override', () => {
    assert.equal(shouldGenerateDailyNewsOnRead('production', 'false'), false);
    assert.equal(shouldGenerateDailyNewsOnRead('production', '0'), false);
    assert.equal(shouldGenerateDailyNewsOnRead('production', 'off'), false);
});

test('getDailyNewsMaxAgeMs defaults to two hours and accepts positive overrides', () => {
    assert.equal(getDailyNewsMaxAgeMs(undefined), 2 * 60 * 60 * 1000);
    assert.equal(getDailyNewsMaxAgeMs('60000'), 60000);
    assert.equal(getDailyNewsMaxAgeMs('0'), 2 * 60 * 60 * 1000);
    assert.equal(getDailyNewsMaxAgeMs('bad'), 2 * 60 * 60 * 1000);
});

test('isDailyNewsDigestStale detects old missing and invalid generated timestamps', () => {
    const now = new Date('2026-05-06T12:00:00.000Z');

    assert.equal(isDailyNewsDigestStale(undefined, now, 60_000), true);
    assert.equal(isDailyNewsDigestStale('bad-date', now, 60_000), true);
    assert.equal(isDailyNewsDigestStale('2026-05-06T11:59:30.000Z', now, 60_000), false);
    assert.equal(isDailyNewsDigestStale('2026-05-06T11:58:00.000Z', now, 60_000), true);
});
