import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveWorkspaceMarketPolicy } from './workspaceMarketPolicy.ts';

test('ordinary research tabs use the full market endpoint and deferred indicators', () => {
    assert.deepEqual(resolveWorkspaceMarketPolicy('dashboard'), {
        runLiveMarketRequests: true,
        runHeavyMarketRequests: true,
        runDeferredIndicatorRequests: true,
        runLeaderboardRequests: true,
        heavyMarketEndpoint: '/api/market',
    });
    assert.equal(resolveWorkspaceMarketPolicy('macro').heavyMarketEndpoint, '/api/market');
});

test('strategy tab uses its bounded endpoint without ordinary deferred indicator fan-out', () => {
    const policy = resolveWorkspaceMarketPolicy('strategies');

    assert.equal(policy.runLiveMarketRequests, true);
    assert.equal(policy.runHeavyMarketRequests, true);
    assert.equal(policy.runDeferredIndicatorRequests, false);
    assert.equal(policy.heavyMarketEndpoint, '/api/market/strategy');
});

test('trading tab suppresses market requests owned by the research workspace', () => {
    assert.deepEqual(resolveWorkspaceMarketPolicy('trading'), {
        runLiveMarketRequests: false,
        runHeavyMarketRequests: false,
        runDeferredIndicatorRequests: false,
        runLeaderboardRequests: false,
        heavyMarketEndpoint: '/api/market',
    });
});
