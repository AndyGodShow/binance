import test from 'node:test';
import assert from 'node:assert/strict';

import { buildDailyNewsReadResponse } from './routeResponse.ts';
import type { DailyNewsDigest } from './types.ts';

function digest(generatedAt: string): DailyNewsDigest {
    return {
        generatedAt,
        windowStart: '2026-04-17T00:00:00.000Z',
        windowEnd: '2026-04-18T00:00:00.000Z',
        timezone: 'Asia/Shanghai',
        macro: [],
        ai: [],
        crypto: [],
        categoryStatus: {
            macro: status(),
            ai: status(),
            crypto: status(),
        },
    };
}

function status(): DailyNewsDigest['categoryStatus']['macro'] {
    return {
        status: 'ok',
        requested: 0,
        returned: 0,
        dropped: {
            outsideWindow: 0,
            irrelevant: 0,
            unimportant: 0,
            duplicates: 0,
            invalidDate: 0,
            invalidUrl: 0,
        },
        sourceAttempts: [],
        totalCandidates: 0,
    };
}

test('daily news read response returns fresh cache without requesting generation', () => {
    const response = buildDailyNewsReadResponse({
        digest: digest('2026-04-18T00:00:00.000Z'),
        storageMode: 'local-file',
        now: new Date('2026-04-18T00:30:00.000Z'),
        maxAgeMs: 2 * 60 * 60 * 1000,
        refreshRequested: false,
    });

    assert.equal(response.status, 'ok');
    assert.equal(response.isStale, false);
    assert.equal(response.shouldGenerate, false);
});

test('daily news read response returns stale cache as degraded without requesting generation', () => {
    const response = buildDailyNewsReadResponse({
        digest: digest('2026-04-18T00:00:00.000Z'),
        storageMode: 'local-file',
        now: new Date('2026-04-18T03:00:00.000Z'),
        maxAgeMs: 2 * 60 * 60 * 1000,
        refreshRequested: false,
    });

    assert.equal(response.status, 'degraded');
    assert.equal(response.isStale, true);
    assert.equal(response.shouldGenerate, false);
    assert.match(response.message || '', /stale/i);
});

test('daily news read response ignores public refresh for generation', () => {
    const response = buildDailyNewsReadResponse({
        digest: digest('2026-04-18T00:00:00.000Z'),
        storageMode: 'local-file',
        now: new Date('2026-04-18T00:30:00.000Z'),
        maxAgeMs: 2 * 60 * 60 * 1000,
        refreshRequested: true,
    });

    assert.equal(response.status, 'ok');
    assert.equal(response.shouldGenerate, false);
    assert.match(response.message || '', /scheduled/i);
});

test('daily news read response returns empty status when cache is missing', () => {
    const response = buildDailyNewsReadResponse({
        digest: null,
        storageMode: 'local-file',
        now: new Date('2026-04-18T00:30:00.000Z'),
        maxAgeMs: 2 * 60 * 60 * 1000,
        refreshRequested: false,
    });

    assert.equal(response.status, 'empty');
    assert.equal(response.isStale, true);
    assert.equal(response.shouldGenerate, false);
    assert.match(response.message || '', /not been generated/i);
});
