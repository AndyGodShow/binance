import test from 'node:test';
import assert from 'node:assert/strict';

import { buildFallbackSourceStatuses, settleOnchainSource, sourceStateOf } from './providerStatus.ts';

test('settleOnchainSource distinguishes an empty provider response from a failed request', () => {
    const emptyHistory = settleOnchainSource([]);
    const failedHistory = settleOnchainSource([], new Error('history request timed out'));

    assert.deepEqual(emptyHistory, {
        status: 'empty',
        data: [],
    });
    assert.equal(failedHistory.status, 'failed');
    assert.deepEqual(failedHistory.data, []);
    assert.match(failedHistory.error ?? '', /history request timed out/);
});

test('settleOnchainSource reports non-empty provider data as ok', () => {
    const topHolders = settleOnchainSource([
        {
            address: '0xholder',
            label: null,
            entity: null,
            percentage: 12.5,
            balance: '125',
            usdValue: '250',
            isContract: false,
        },
    ]);

    assert.equal(topHolders.status, 'ok');
    assert.equal(topHolders.data.length, 1);
    assert.equal(topHolders.error, undefined);
});

test('fallback source statuses preserve upstream failure instead of presenting empty datasets', () => {
    const statuses = buildFallbackSourceStatuses('upstream_request_failed');

    assert.equal(statuses.dex.status, 'failed');
    assert.equal(statuses.metrics.status, 'failed');
    assert.equal(statuses.history.status, 'failed');
    assert.equal(statuses.topHolders.status, 'failed');
});

test('metrics fallback records the attempted metrics source as failed', () => {
    const statuses = buildFallbackSourceStatuses('metrics_unavailable');

    assert.equal(statuses.dex.status, 'ok');
    assert.equal(statuses.metrics.status, 'failed');
    assert.equal(statuses.history.status, 'unavailable');
    assert.equal(statuses.topHolders.status, 'unavailable');
});

test('sourceStateOf removes provider data without losing failure details', () => {
    assert.deepEqual(sourceStateOf({
        status: 'failed',
        data: { preserved: true },
        error: 'provider unavailable',
    }), {
        status: 'failed',
        error: 'provider unavailable',
    });
});
