import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

const repoRoot = process.cwd();

test('main market endpoint always builds enriched market data', () => {
    const routeSource = readFileSync(join(repoRoot, 'src/app/api/market/route.ts'), 'utf8');

    assert.doesNotMatch(routeSource, /USE_LIGHTWEIGHT_MARKET_ROUTE/);
    assert.doesNotMatch(routeSource, /FULL_MARKET_BUILD_ON_ROUTE/);
    assert.match(routeSource, /ensureCachedMarketBuild\([\s\S]*marketRouteState,[\s\S]*buildMarketData[\s\S]*\)/);
    assert.match(routeSource, /'X-Data-Quality': 'enriched'/);
});

test('ordinary market views request the enriched market endpoint', () => {
    const pageSource = readFileSync(join(repoRoot, 'src/app/page.tsx'), 'utf8');

    assert.match(pageSource, /const shouldRunHeavyMarketRequests = shouldRunLiveMarketRequests;/);
    assert.match(pageSource, /activeTab === 'strategies'[\s\S]*\?[\s\S]*'\/api\/market\/strategy'[\s\S]*:[\s\S]*'\/api\/market'/);
});

test('full market pipeline combines current OI values with historical 4h OI change', () => {
    const pipelineSource = readFileSync(join(repoRoot, 'src/lib/marketDataPipeline.ts'), 'utf8');

    assert.match(pipelineSource, /fetchCurrentOpenInterestMarketSnapshotsBatch/);
    assert.match(pipelineSource, /fetchOpenInterestMarketSnapshotsBatch/);
    assert.match(pipelineSource, /mergeOpenInterestSnapshotMaps\(currentOiSnapshotMap, historicalOiChangeSnapshotMap\)/);
    assert.match(pipelineSource, /fetchSentimentHotspotContextMap\([\s\S]*oiSignalMode: 'current'[\s\S]*\)/);
    assert.match(pipelineSource, /const trackedMarketData = attachHistoricalTrackerChanges\(/);
    assert.match(pipelineSource, /new Map\(trackedMarketData\.map/);
});
