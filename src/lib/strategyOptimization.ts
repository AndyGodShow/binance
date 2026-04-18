import type { StrategyId } from './strategyParameters.ts';

export type OptimizationWindow = '30d' | '90d' | '180d';
export type DiagnosticsConfidence = 'high' | 'medium' | 'low';

export interface StrategyWindowMetrics {
    totalProfit: number;
    winRate: number;
    maxDrawdown: number;
    profitFactor: number;
    totalTrades: number;
    diagnosticsConfidence: DiagnosticsConfidence;
}

export type StrategyWindowMetricMap = Partial<Record<OptimizationWindow, StrategyWindowMetrics>>;

export interface StrategyOptimizationReport {
    strategyId: StrategyId;
    baseline: StrategyWindowMetricMap;
    candidate: StrategyWindowMetricMap;
    approved: boolean;
    rejectedReasons: string[];
}

export function createBaselineWindowMap(input: StrategyWindowMetricMap): StrategyWindowMetricMap {
    return { ...input };
}

export function evaluateStrategyCandidate(params: {
    strategyId: StrategyId;
    baseline: StrategyWindowMetricMap;
    candidate: StrategyWindowMetricMap;
}): StrategyOptimizationReport {
    const rejectedReasons: string[] = [];
    const requiredWindows: OptimizationWindow[] = ['30d', '90d'];
    const missingWindows = requiredWindows.filter((windowKey) => !params.baseline[windowKey] || !params.candidate[windowKey]);

    if (missingWindows.length > 0) {
        missingWindows.forEach((windowKey) => {
            rejectedReasons.push(`${windowKey} metrics are incomplete`);
        });
    } else {
        const baseline30d = params.baseline['30d']!;
        const candidate30d = params.candidate['30d']!;
        const baseline90d = params.baseline['90d']!;
        const candidate90d = params.candidate['90d']!;

        if (candidate90d.maxDrawdown >= baseline90d.maxDrawdown) {
            rejectedReasons.push('90d maxDrawdown did not improve');
        }

        if (candidate90d.profitFactor < baseline90d.profitFactor) {
            rejectedReasons.push('90d profitFactor regressed');
        }

        if (candidate30d.winRate < baseline30d.winRate + 2) {
            rejectedReasons.push('30d winRate did not improve by at least 2 points');
        }

        if (candidate90d.winRate < baseline90d.winRate + 2) {
            rejectedReasons.push('90d winRate did not improve by at least 2 points');
        }

        if (candidate30d.totalTrades < baseline30d.totalTrades * 0.6) {
            rejectedReasons.push('30d totalTrades fell below 60% of baseline');
        }

        if (candidate90d.totalTrades < baseline90d.totalTrades * 0.6) {
            rejectedReasons.push('90d totalTrades fell below 60% of baseline');
        }

        if (
            candidate30d.diagnosticsConfidence !== 'high' ||
            candidate90d.diagnosticsConfidence !== 'high'
        ) {
            rejectedReasons.push('diagnostics confidence dropped below high on a required window');
        }
    }

    return {
        strategyId: params.strategyId,
        baseline: params.baseline,
        candidate: params.candidate,
        approved: rejectedReasons.length === 0,
        rejectedReasons,
    };
}
