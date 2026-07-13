import type { StrategyId } from './strategyParameters.ts';
import type { StrategyInputReadinessSummary } from './strategyInputs.ts';
import { summarizeTimedPayloadQuality, type UnifiedBuildState, type UnifiedDataQuality } from './dataQualityStatus.ts';

type MarketDataQuality = UnifiedDataQuality;
type MarketBuildState = UnifiedBuildState;

export interface MarketDataStatusInput {
    dataQuality?: string;
    buildState?: string;
    dataSource?: string;
}

export interface MarketDataStatus {
    dataQuality: MarketDataQuality;
    buildState: MarketBuildState;
    dataSource: string;
    isDegraded: boolean;
    isUnavailable: boolean;
    message?: string;
}

export interface StrategyReadinessDebugRow {
    strategyId: StrategyId;
    missingSymbolCount: number;
    missingFields: string[];
    sampleSymbols: string[];
}

export function buildMarketDataStatus(input: MarketDataStatusInput): MarketDataStatus {
    const summary = summarizeTimedPayloadQuality(input);
    return {
        dataQuality: summary.dataQuality,
        buildState: summary.buildState,
        dataSource: summary.dataSource,
        isDegraded: summary.isDegraded,
        isUnavailable: summary.isUnavailable,
        message: summary.message,
    };
}

export function isMarketDataStatusDegraded(status: MarketDataStatus): boolean {
    return status.isDegraded;
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
