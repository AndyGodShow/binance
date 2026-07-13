import assert from 'node:assert/strict';
import test from 'node:test';

import { MarketBuildLeaseUnavailableError, runFencedMarketBuild } from './marketBuildLease.ts';

test('fenced market build checks ownership before returning a cacheable snapshot', async () => {
    let released = false;
    const lease = {
        acquire: async () => 'owner-1',
        renew: async () => true,
        isOwner: async () => false,
        release: async () => { released = true; },
    };

    await assert.rejects(
        runFencedMarketBuild({
            lease,
            key: 'market',
            ttlMs: 1_000,
            renewIntervalMs: 500,
            build: async () => ['snapshot'],
        }),
        /ownership was lost before shared snapshot commit/,
    );
    assert.equal(released, true);
});

test('fenced market build does not start when another owner holds the lease', async () => {
    let buildCalled = false;
    const lease = {
        acquire: async () => null,
        renew: async () => true,
        isOwner: async () => false,
        release: async () => undefined,
    };

    await assert.rejects(
        runFencedMarketBuild({
            lease,
            key: 'market',
            ttlMs: 1_000,
            renewIntervalMs: 500,
            build: async () => { buildCalled = true; },
        }),
        MarketBuildLeaseUnavailableError,
    );
    assert.equal(buildCalled, false);
});
