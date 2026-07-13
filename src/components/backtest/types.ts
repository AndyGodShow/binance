import type { BacktestResult } from '@/lib/backtestEngine';
import type { BacktestDiagnostics } from '@/lib/backtestDiagnostics';
import type { DataQualityMetrics } from '@/lib/dataQuality';
import type { BacktestHistoryPreflightReport } from '@/lib/backtestHistoryPreflight';

export interface BacktestRunDetail {
    symbol: string;
    result: BacktestResult;
    diagnostics: BacktestDiagnostics;
    dataQuality: DataQualityMetrics;
    preflight: BacktestHistoryPreflightReport;
    rangeAdjusted: boolean;
    rangeAdjustmentReason?: string;
}

export interface BatchBacktestItem {
    symbol: string;
    totalProfit: number;
    totalProfitUSDT: number;
    winRate: number;
    maxDrawdown: number;
    profitFactor: number;
    totalTrades: number;
}

export interface BacktestTaskResult {
    symbol: string;
    run?: BacktestRunDetail;
    error?: Error;
}
