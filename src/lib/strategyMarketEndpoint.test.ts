import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

import { STRATEGY_MARKET_ENRICHMENT_LIMITS } from './marketBuildConfig.ts';
import { resolveWorkspaceMarketPolicy } from './workspaceMarketPolicy.ts';

const repoRoot = process.cwd();

test('strategy scanner uses the enriched strategy market endpoint', () => {
    assert.equal(resolveWorkspaceMarketPolicy('strategies').heavyMarketEndpoint, '/api/market/strategy');
});

test('strategy market endpoint has its own route', () => {
    assert.equal(existsSync(join(repoRoot, 'src/app/api/market/strategy/route.ts')), true);
});

test('strategy market endpoint uses bounded strategy market builder for cold-start usability', () => {
    assert.deepEqual(STRATEGY_MARKET_ENRICHMENT_LIMITS, {
        oiSnapshotSymbolLimit: 220,
        historicalOiChangeSymbolLimit: 80,
        klineEnhancementSymbolLimit: 180,
    });
});

test('strategy tab does not run ordinary deferred indicator fan-out', () => {
    const policy = resolveWorkspaceMarketPolicy('strategies');

    assert.equal(policy.runLiveMarketRequests, true);
    assert.equal(policy.runHeavyMarketRequests, true);
    assert.equal(policy.runDeferredIndicatorRequests, false);
});
