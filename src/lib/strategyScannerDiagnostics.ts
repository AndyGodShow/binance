import type { StrategyId } from './strategyParameters.ts';
import type { StrategyInputReadinessSummary } from './strategyInputs.ts';

export type MarketDataQuality = 'enriched' | 'lightweight' | 'unknown';
export type MarketBuildState = 'ready' | 'building' | 'stale' | 'unknown';

export interface MarketDataStatusInput {
    dataQuality?: string;
    buildState?: string;
    dataSource?: string;
}

export interface MarketDataStatus {
    dataQuality: MarketDataQuality;
    buildState: MarketBuildState;
    dataSource: string;
}

export interface StrategyReadinessDebugRow {
    strategyId: StrategyId;
    missingSymbolCount: number;
    missingFields: string[];
    sampleSymbols: string[];
}

function normalizeDataQuality(value: string | undefined): MarketDataQuality {
    return value === 'enriched' || value === 'lightweight' ? value : 'unknown';
}

function normalizeBuildState(value: string | undefined): MarketBuildState {
    return value === 'ready' || value === 'building' || value === 'stale' ? value : 'unknown';
}

export function buildMarketDataStatus(input: MarketDataStatusInput): MarketDataStatus {
    return {
        dataQuality: normalizeDataQuality(input.dataQuality),
        buildState: normalizeBuildState(input.buildState),
        dataSource: input.dataSource || 'unknown',
    };
}

export function isMarketDataStatusDegraded(status: MarketDataStatus): boolean {
    return status.dataQuality === 'lightweight' || status.buildState === 'stale';
}

export function buildReadinessDebugRows(
    summary: StrategyInputReadinessSummary | null | undefined,
): StrategyReadinessDebugRow[] {
    if (!summary) {
        return [];
    }

    return Object.entries(summary.byStrategy)
        .map(([strategyId, entry]) => ({
            strategyId: strategyId as StrategyId,
            missingSymbolCount: entry.symbolsMissingRequiredFields,
            missingFields: Object.entries(entry.missingFieldCounts)
                .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
                .map(([field, count]) => `${field}:${count}`),
            sampleSymbols: entry.sampleSymbols,
        }))
        .filter((row) => row.missingSymbolCount > 0);
}
