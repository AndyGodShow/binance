import assert from 'node:assert/strict';
import test from 'node:test';

import { buildBacktestDiagnostics } from './backtestDiagnostics.ts';
import type { DataQualityMetrics } from './dataQuality.ts';

const goodQuality: DataQualityMetrics = {
    oiCoverage: 100,
    fundingCoverage: 100,
    oiExactCoverage: 100,
    fundingExactCoverage: 100,
    dataQualityScore: 100,
    missingDataPoints: 0,
    simulatedDataRatio: 0,
    totalDataPoints: 100,
    realDataPoints: 100,
};

test('sentiment-hotspot diagnostics require historical context and open interest quality', () => {
    const diagnostics = buildBacktestDiagnostics({
        strategyId: 'sentiment-hotspot',
        interval: '1h',
        executionInterval: '15m',
        requestedDays: 7,
        dataQuality: {
            ...goodQuality,
            oiExactCoverage: 10,
        },
        hasHistoricalMultiTimeframe: false,
    });

    assert.equal(diagnostics.confidence, 'low');
    assert.equal(diagnostics.checks.find((check) => check.key === 'multiframe')?.status, 'fail');
    assert.equal(diagnostics.checks.find((check) => check.key === 'open-interest')?.status, 'fail');
});
