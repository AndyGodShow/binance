import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

const repoRoot = process.cwd();

test('strategy scanner uses the enriched strategy market endpoint', () => {
    const pageSource = readFileSync(join(repoRoot, 'src/app/page.tsx'), 'utf8');

    assert.match(pageSource, /\/api\/market\/strategy/);
});

test('strategy market endpoint has its own route', () => {
    assert.equal(existsSync(join(repoRoot, 'src/app/api/market/strategy/route.ts')), true);
});

test('strategy market endpoint uses bounded strategy market builder for cold-start usability', () => {
    const routeSource = readFileSync(join(repoRoot, 'src/app/api/market/strategy/route.ts'), 'utf8');
    const pipelineSource = readFileSync(join(repoRoot, 'src/lib/marketDataPipeline.ts'), 'utf8');

    assert.match(routeSource, /buildStrategyMarketData/);
    assert.match(routeSource, /ensureCachedMarketBuild\(strategyMarketRouteState, buildStrategyMarketData\)/);
    assert.match(pipelineSource, /STRATEGY_MARKET_ENRICHMENT_LIMITS/);
    assert.match(pipelineSource, /historicalOiChangeSymbolLimit: 80/);
});

test('strategy scanner keeps strategy endpoint RSRS fields instead of hourly deferred RSRS overrides', () => {
    const pageSource = readFileSync(join(repoRoot, 'src/app/page.tsx'), 'utf8');

    assert.match(pageSource, /normalizeTickerUniverse\(heavyMarketData, strategyFrameData, undefined\)/);
});

test('strategy tab does not run ordinary deferred indicator fan-out', () => {
    const pageSource = readFileSync(join(repoRoot, 'src/app/page.tsx'), 'utf8');

    assert.match(pageSource, /const shouldRunDeferredIndicatorRequests = shouldRunLiveMarketRequests && activeTab !== 'strategies';/);
    assert.match(pageSource, /enabled: shouldRunDeferredIndicatorRequests && enableDeferredIndicators && Boolean\(multiframeSignature\)/);
});
