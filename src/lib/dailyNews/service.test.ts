import test from 'node:test';
import assert from 'node:assert/strict';

import { buildDailyNewsDigestFromResults, calculateDailyNewsWindow } from './pipeline.ts';
import { dailyNewsServiceInternals } from './service.ts';
import type { NewsCandidate } from './types.ts';

const WINDOW = calculateDailyNewsWindow(new Date('2026-04-18T00:00:00.000Z'));

function candidate(overrides: Partial<NewsCandidate> = {}): NewsCandidate {
    return {
        category: 'macro',
        title: 'Federal Reserve officials signal caution on rate cuts after inflation data',
        summary: 'Fed officials pushed back on faster cuts after inflation stayed sticky.',
        source: 'Reuters',
        domain: 'reuters.com',
        url: 'https://www.reuters.com/markets/us/fed-officials-signal-caution-rate-cuts-2026-04-17/',
        publishedAt: '2026-04-17T16:00:00.000Z',
        collectedAt: '2026-04-18T00:00:00.000Z',
        tags: ['Fed', 'rates'],
        ...overrides,
    };
}

test('collectCategory continues to 6551 and GDELT after RSS abort', async () => {
    const result = await dailyNewsServiceInternals.collectCategory('macro', WINDOW, [
        {
            source: 'rss',
            collect: async () => {
                throw new DOMException('This operation was aborted', 'AbortError');
            },
        },
        {
            source: '6551',
            collect: async () => [candidate({ source: '6551 News', url: 'https://ai.6551.io/macro-fed' })],
        },
        {
            source: 'gdelt',
            collect: async () => [candidate({ source: 'GDELT', url: 'https://example.com/gdelt-fed' })],
        },
    ]);

    assert.equal(result.ok, true);
    assert.equal(result.candidates.length, 2);
    assert.equal(result.sourceAttempts?.[0]?.status, 'failed');
    assert.equal(result.sourceAttempts?.[0]?.error, 'RSS timeout after 8000ms');
    assert.equal(result.sourceAttempts?.[1]?.status, 'success');
    assert.equal(result.sourceAttempts?.[2]?.status, 'success');
});

test('collectCategory marks all-source failure as failed with readable errors', async () => {
    const result = await dailyNewsServiceInternals.collectCategory('ai', WINDOW, [
        {
            source: 'rss',
            collect: async () => {
                throw new DOMException('This operation was aborted', 'AbortError');
            },
        },
        {
            source: '6551',
            collect: async () => {
                throw new Error('upstream 500');
            },
        },
        {
            source: 'gdelt',
            collect: async () => {
                throw new DOMException('The operation was aborted.', 'AbortError');
            },
        },
    ]);

    assert.equal(result.ok, false);
    assert.equal(result.candidates.length, 0);
    assert.match(result.error || '', /RSS timeout after 8000ms/);
    assert.match(result.error || '', /6551 upstream 500/);
    assert.match(result.error || '', /GDELT timeout after 10000ms/);
    assert.doesNotMatch(result.error || '', /This operation was aborted/);
});

test('partial source coverage keeps candidates but marks the category degraded', async () => {
    const result = await dailyNewsServiceInternals.collectCategory('crypto', WINDOW, [
        {
            source: 'rss',
            collect: async () => [candidate({
                category: 'crypto',
                source: 'CoinDesk',
                domain: 'coindesk.com',
                url: 'https://www.coindesk.com/policy/2026/04/17/sec-delays-eth-etf/',
                title: 'SEC delays decision on spot Ethereum ETF staking proposal',
                tags: ['SEC', 'ETF'],
            })],
        },
        {
            source: '6551',
            collect: async () => [],
        },
        {
            source: 'gdelt',
            collect: async () => {
                throw new DOMException('This operation was aborted', 'AbortError');
            },
        },
    ]);

    assert.equal(result.ok, true);
    assert.equal(result.candidates.length, 1);
    assert.match(result.degradedReason || '', /6551 returned no candidates/);
    assert.match(result.degradedReason || '', /GDELT timeout after 10000ms/);

    const digest = buildDailyNewsDigestFromResults([
        result,
        { category: 'macro', ok: false, candidates: [], error: 'Macro timeout after 8000ms' },
        { category: 'ai', ok: false, candidates: [], error: 'AI timeout after 8000ms' },
    ], WINDOW);

    assert.equal(digest.categoryStatus.crypto.status, 'partial');
    assert.equal(digest.categoryStatus.crypto.sourceAttempts?.length, 3);
    assert.match(digest.categoryStatus.crypto.degradedReason || '', /GDELT timeout after 10000ms/);
    assert.equal(digest.categoryStatus.macro.status, 'failed');
    assert.equal(digest.crypto.length > 0, true);
});
