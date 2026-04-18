import test from 'node:test';
import assert from 'node:assert/strict';

import {
    evaluateStrategyCandidate,
    createBaselineWindowMap,
} from './strategyOptimization.ts';

test('evaluateStrategyCandidate approves a candidate only when every gate passes', () => {
    const report = evaluateStrategyCandidate({
        strategyId: 'strong-breakout',
        baseline: createBaselineWindowMap({
            '30d': {
                totalProfit: 12,
                winRate: 52,
                maxDrawdown: 14,
                profitFactor: 1.4,
                totalTrades: 40,
                diagnosticsConfidence: 'high',
            },
            '90d': {
                totalProfit: 24,
                winRate: 50,
                maxDrawdown: 18,
                profitFactor: 1.35,
                totalTrades: 90,
                diagnosticsConfidence: 'high',
            },
        }),
        candidate: createBaselineWindowMap({
            '30d': {
                totalProfit: 13,
                winRate: 55,
                maxDrawdown: 12,
                profitFactor: 1.45,
                totalTrades: 30,
                diagnosticsConfidence: 'high',
            },
            '90d': {
                totalProfit: 26,
                winRate: 53,
                maxDrawdown: 16,
                profitFactor: 1.36,
                totalTrades: 70,
                diagnosticsConfidence: 'high',
            },
        }),
    });

    assert.equal(report.approved, true);
    assert.deepEqual(report.rejectedReasons, []);
});

test('evaluateStrategyCandidate rejects candidates that fail any required gate', () => {
    const report = evaluateStrategyCandidate({
        strategyId: 'capital-inflow',
        baseline: createBaselineWindowMap({
            '30d': {
                totalProfit: 8,
                winRate: 54,
                maxDrawdown: 10,
                profitFactor: 1.2,
                totalTrades: 20,
                diagnosticsConfidence: 'high',
            },
            '90d': {
                totalProfit: 18,
                winRate: 56,
                maxDrawdown: 13,
                profitFactor: 1.4,
                totalTrades: 50,
                diagnosticsConfidence: 'high',
            },
        }),
        candidate: createBaselineWindowMap({
            '30d': {
                totalProfit: 7,
                winRate: 53,
                maxDrawdown: 9,
                profitFactor: 1.15,
                totalTrades: 8,
                diagnosticsConfidence: 'medium',
            },
            '90d': {
                totalProfit: 19,
                winRate: 54,
                maxDrawdown: 13,
                profitFactor: 1.35,
                totalTrades: 20,
                diagnosticsConfidence: 'low',
            },
        }),
    });

    assert.equal(report.approved, false);
    assert.deepEqual(report.rejectedReasons, [
        '90d maxDrawdown did not improve',
        '90d profitFactor regressed',
        '30d winRate did not improve by at least 2 points',
        '90d winRate did not improve by at least 2 points',
        '30d totalTrades fell below 60% of baseline',
        '90d totalTrades fell below 60% of baseline',
        'diagnostics confidence dropped below high on a required window',
    ]);
});
