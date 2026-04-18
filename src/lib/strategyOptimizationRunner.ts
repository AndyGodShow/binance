import { BacktestEngine } from './backtestEngine.ts';
import type { BacktestResult } from './backtestEngine.ts';
import { buildBacktestDiagnostics } from './backtestDiagnostics.ts';
import type { BacktestDiagnostics } from './backtestDiagnostics.ts';
import { calculateDataQuality } from './dataQuality.ts';
import type { DataQualityMetrics } from './dataQuality.ts';
import { HistoricalDataFetcher } from './historicalDataFetcher.ts';
import { buildHistoricalTickerOverrides } from './historicalMultiTimeframe.ts';
import { runPortfolioBacktest } from './portfolioBacktestEngine.ts';
import type { PortfolioBacktestResult } from './portfolioBacktestEngine.ts';
import { calculateRiskManagement } from './risk/riskCalculator.ts';
import {
    buildStrategyParameterCandidates,
    withStrategyParameterOverrides,
} from './strategyParameters.ts';
import type {
    StrategyId,
    StrategyParameterCandidate,
} from './strategyParameters.ts';
import {
    createBaselineWindowMap,
    evaluateStrategyCandidate,
} from './strategyOptimization.ts';
import type {
    DiagnosticsConfidence,
    OptimizationWindow,
    StrategyOptimizationReport,
    StrategyWindowMetricMap,
    StrategyWindowMetrics,
} from './strategyOptimization.ts';
import type { TickerData } from './types.ts';
import { strategyRegistry } from '../strategies/registry.ts';

const DAY_MS = 24 * 60 * 60 * 1000;

export interface StrategyRunSymbolSummary {
    symbol: string;
    totalProfit: number;
    winRate: number;
    maxDrawdown: number;
    profitFactor: number;
    totalTrades: number;
    diagnosticsConfidence: DiagnosticsConfidence;
}

export interface StrategyWindowBatchSummary {
    requestedSymbols: number;
    completedSymbols: number;
    failedSymbols: string[];
    averageProfit: number;
    averageWinRate: number;
    averageMaxDrawdown: number;
    averageProfitFactor: number;
    averageTrades: number;
}

export interface StrategyWindowEvaluation {
    window: OptimizationWindow;
    portfolio: StrategyWindowMetrics;
    portfolioResult: PortfolioBacktestResult | null;
    diagnosticsConfidence: DiagnosticsConfidence;
    batch: StrategyWindowBatchSummary;
    symbolResults: StrategyRunSymbolSummary[];
}

export interface StrategyCandidateEvaluation {
    candidate: StrategyParameterCandidate;
    metrics: StrategyWindowMetricMap;
    windows: Partial<Record<OptimizationWindow, StrategyWindowEvaluation>>;
    report: StrategyOptimizationReport;
}

export interface StrategyOptimizationExecutionResult {
    strategyId: StrategyId;
    symbols: string[];
    baseline: Partial<Record<OptimizationWindow, StrategyWindowEvaluation>>;
    baselineMetrics: StrategyWindowMetricMap;
    candidates: StrategyCandidateEvaluation[];
    approvedCandidate: StrategyCandidateEvaluation | null;
}

export interface StrategyOptimizationRunnerOptions {
    baseUrl: string;
    symbolLimit?: number;
    symbols?: string[];
    windows?: OptimizationWindow[];
    strategyIds?: StrategyId[];
    signalInterval?: string;
    executionInterval?: string;
    initialCapital?: number;
    commission?: number;
    maxConcurrentPositions?: number;
    positionSizePercent?: number;
    onProgress?: (message: string) => void;
}

interface SingleBacktestRun {
    symbol: string;
    result: BacktestResult;
    diagnostics: BacktestDiagnostics;
    dataQuality: DataQualityMetrics;
}

function average(values: number[]): number {
    if (values.length === 0) {
        return 0;
    }

    return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function windowToPreset(window: OptimizationWindow): '30d' | '90d' | '180d' {
    return window;
}

function aggregateDiagnosticsConfidence(confidences: DiagnosticsConfidence[]): DiagnosticsConfidence {
    if (confidences.length === 0) {
        return 'low';
    }

    if (confidences.includes('low')) {
        return 'low';
    }

    if (confidences.includes('medium')) {
        return 'medium';
    }

    return 'high';
}

function buildRiskCalculationParams(
    ticker: TickerData,
    direction: 'long' | 'short',
    confidence: number,
    accountBalance: number,
): Parameters<typeof calculateRiskManagement>[1] {
    return {
        entryPrice: parseFloat(ticker.lastPrice),
        direction,
        confidence,
        atr: ticker.atr,
        keltnerMid: ticker.keltnerMid,
        keltnerUpper: ticker.keltnerUpper,
        keltnerLower: ticker.keltnerLower,
        vah: ticker.vah,
        val: ticker.val,
        poc: ticker.poc,
        bollingerLower: ticker.bollingerLower,
        bollingerUpper: ticker.bollingerUpper,
        momentumColor: ticker.momentumColor,
        cvdSlope: ticker.cvdSlope,
        fundingRateTrend: ticker.fundingRateTrend,
        rsrsZScore: ticker.rsrsZScore,
        squeezeDuration: ticker.squeezeDuration,
        bandwidthPercentile: ticker.bandwidthPercentile,
        adx: ticker.adx,
        oiChangePercent: ticker.oiChangePercent,
        volumeChangePercent: ticker.volumeChangePercent,
        betaToBTC: ticker.betaToBTC,
        rsrsR2: ticker.rsrsR2,
        accountBalance,
        riskPercentage: 1,
    };
}

async function fetchTopSymbols(baseUrl: string, limit: number): Promise<string[]> {
    const response = await fetch(`${baseUrl}/api/market`);
    const payload = await response.json().catch(() => null);

    if (!response.ok || !Array.isArray(payload)) {
        throw new Error(`获取成交额币池失败: HTTP ${response.status}`);
    }

    return payload
        .filter((ticker): ticker is { symbol: string; quoteVolume: string } =>
            ticker &&
            typeof ticker.symbol === 'string' &&
            typeof ticker.quoteVolume === 'string' &&
            ticker.symbol.endsWith('USDT')
        )
        .sort((a, b) => parseFloat(b.quoteVolume || '0') - parseFloat(a.quoteVolume || '0'))
        .slice(0, limit)
        .map((ticker) => ticker.symbol);
}

async function runSingleBacktest(params: {
    dataFetcher: HistoricalDataFetcher;
    strategyId: StrategyId;
    symbol: string;
    window: OptimizationWindow;
    signalInterval: string;
    executionInterval: string;
    initialCapital: number;
    commission: number;
}): Promise<SingleBacktestRun> {
    const strategy = strategyRegistry.getById(params.strategyId);
    if (!strategy) {
        throw new Error(`策略不存在: ${params.strategyId}`);
    }

    const { startTime, endTime } = HistoricalDataFetcher.getPresetRange(windowToPreset(params.window));
    const normalizedSymbol = params.symbol.trim().toUpperCase();
    const signalKlines = await params.dataFetcher.fetchRangeData(
        normalizedSymbol,
        params.signalInterval,
        startTime,
        endTime,
    );

    if (signalKlines.length === 0) {
        throw new Error(`未获取到 ${normalizedSymbol} 的历史数据`);
    }

    const historicalTickerOverrides = await buildHistoricalTickerOverrides({
        strategyId: params.strategyId,
        symbol: normalizedSymbol,
        startTime,
        endTime,
        baseInterval: params.signalInterval,
        baseKlines: signalKlines,
        fetchRangeData: (nextSymbol, nextInterval, nextStartTime, nextEndTime) =>
            params.dataFetcher.fetchRangeData(nextSymbol, nextInterval, nextStartTime, nextEndTime, {
                includeAuxiliary: false,
            }),
    });

    const engine = new BacktestEngine({
        initialCapital: params.initialCapital,
        commission: params.commission,
        slippage: 0.05,
        useStrategyRiskManagement: true,
    });

    const result = await engine.run({
        signalKlines,
        strategyDetector: (ticker: TickerData) => {
            const enrichedTicker = historicalTickerOverrides.size > 0
                ? { ...ticker, ...historicalTickerOverrides.get(ticker.closeTime) }
                : ticker;

            const signal = strategy.detect(enrichedTicker);
            if (!signal) {
                return null;
            }

            return {
                signal: signal.direction,
                confidence: signal.confidence,
                risk: signal.risk || calculateRiskManagement(
                    strategy.id,
                    buildRiskCalculationParams(enrichedTicker, signal.direction, signal.confidence, params.initialCapital),
                ),
            };
        },
        strategyName: strategy.name,
        symbol: normalizedSymbol,
        signalInterval: params.signalInterval,
        executionInterval: params.executionInterval,
        simulationEndTime: endTime,
        fetchExecutionKlines: params.executionInterval === params.signalInterval
            ? undefined
            : (nextStartTime, nextEndTime) => params.dataFetcher.fetchRangeData(
                normalizedSymbol,
                params.executionInterval,
                nextStartTime,
                nextEndTime,
                { includeAuxiliary: false },
            ),
    });

    const dataQuality = calculateDataQuality(signalKlines);
    const diagnostics = buildBacktestDiagnostics({
        strategyId: strategy.id,
        interval: params.signalInterval,
        executionInterval: params.executionInterval,
        requestedDays: (endTime - startTime) / DAY_MS,
        dataQuality,
        hasHistoricalMultiTimeframe: historicalTickerOverrides.size > 0,
    });

    return {
        symbol: normalizedSymbol,
        result,
        diagnostics,
        dataQuality,
    };
}

function toWindowMetrics(
    portfolioResult: PortfolioBacktestResult | null,
    diagnosticsConfidence: DiagnosticsConfidence,
): StrategyWindowMetrics {
    if (!portfolioResult) {
        return {
            totalProfit: 0,
            winRate: 0,
            maxDrawdown: 0,
            profitFactor: 0,
            totalTrades: 0,
            diagnosticsConfidence,
        };
    }

    return {
        totalProfit: portfolioResult.totalProfit,
        winRate: portfolioResult.winRate,
        maxDrawdown: portfolioResult.maxDrawdown,
        profitFactor: portfolioResult.profitFactor,
        totalTrades: portfolioResult.totalTrades,
        diagnosticsConfidence,
    };
}

async function runWindowEvaluation(params: {
    dataFetcher: HistoricalDataFetcher;
    strategyId: StrategyId;
    symbols: string[];
    window: OptimizationWindow;
    signalInterval: string;
    executionInterval: string;
    initialCapital: number;
    commission: number;
    maxConcurrentPositions: number;
    positionSizePercent: number;
    onProgress?: (message: string) => void;
}): Promise<StrategyWindowEvaluation> {
    const completedRuns: SingleBacktestRun[] = [];
    const failedSymbols: string[] = [];

    for (const [index, symbol] of params.symbols.entries()) {
        params.onProgress?.(
            `[${params.strategyId}][${params.window}] 回测 ${symbol} (${index + 1}/${params.symbols.length})`
        );

        try {
            completedRuns.push(await runSingleBacktest({
                dataFetcher: params.dataFetcher,
                strategyId: params.strategyId,
                symbol,
                window: params.window,
                signalInterval: params.signalInterval,
                executionInterval: params.executionInterval,
                initialCapital: params.initialCapital,
                commission: params.commission,
            }));
        } catch {
            failedSymbols.push(symbol);
        }
    }

    const symbolResults = completedRuns.map((run) => ({
        symbol: run.symbol,
        totalProfit: run.result.totalProfit,
        winRate: run.result.winRate,
        maxDrawdown: run.result.maxDrawdown,
        profitFactor: run.result.profitFactor,
        totalTrades: run.result.totalTrades,
        diagnosticsConfidence: run.diagnostics.confidence,
    }));
    const diagnosticsConfidence = aggregateDiagnosticsConfidence(
        completedRuns.map((run) => run.diagnostics.confidence),
    );

    const portfolioResult = completedRuns.length > 0
        ? runPortfolioBacktest(
            completedRuns.map((run) => ({
                symbol: run.symbol,
                result: run.result,
            })),
            {
                initialCapital: params.initialCapital,
                maxConcurrentPositions: params.maxConcurrentPositions,
                positionSizePercent: params.positionSizePercent,
            },
        )
        : null;

    return {
        window: params.window,
        portfolio: toWindowMetrics(portfolioResult, diagnosticsConfidence),
        portfolioResult,
        diagnosticsConfidence,
        batch: {
            requestedSymbols: params.symbols.length,
            completedSymbols: completedRuns.length,
            failedSymbols,
            averageProfit: average(symbolResults.map((item) => item.totalProfit)),
            averageWinRate: average(symbolResults.map((item) => item.winRate)),
            averageMaxDrawdown: average(symbolResults.map((item) => item.maxDrawdown)),
            averageProfitFactor: average(symbolResults.map((item) => item.profitFactor)),
            averageTrades: average(symbolResults.map((item) => item.totalTrades)),
        },
        symbolResults,
    };
}

function pickApprovedCandidate(candidates: StrategyCandidateEvaluation[]): StrategyCandidateEvaluation | null {
    const approvedCandidates = candidates.filter((candidate) => candidate.report.approved);
    if (approvedCandidates.length === 0) {
        return null;
    }

    return approvedCandidates.sort((left, right) => {
        const left90d = left.metrics['90d'];
        const right90d = right.metrics['90d'];

        if (!left90d && !right90d) {
            return 0;
        }
        if (!left90d) {
            return 1;
        }
        if (!right90d) {
            return -1;
        }

        if (left90d.maxDrawdown !== right90d.maxDrawdown) {
            return left90d.maxDrawdown - right90d.maxDrawdown;
        }

        return right90d.profitFactor - left90d.profitFactor;
    })[0];
}

async function runCandidateEvaluation(params: {
    dataFetcher: HistoricalDataFetcher;
    strategyId: StrategyId;
    candidate: StrategyParameterCandidate;
    baselineMetrics: StrategyWindowMetricMap;
    symbols: string[];
    windows: OptimizationWindow[];
    signalInterval: string;
    executionInterval: string;
    initialCapital: number;
    commission: number;
    maxConcurrentPositions: number;
    positionSizePercent: number;
    onProgress?: (message: string) => void;
}): Promise<StrategyCandidateEvaluation> {
    const windowResults: Partial<Record<OptimizationWindow, StrategyWindowEvaluation>> = {};

    await withStrategyParameterOverrides(params.candidate.overrides, async () => {
        for (const window of params.windows) {
            windowResults[window] = await runWindowEvaluation({
                dataFetcher: params.dataFetcher,
                strategyId: params.strategyId,
                symbols: params.symbols,
                window,
                signalInterval: params.signalInterval,
                executionInterval: params.executionInterval,
                initialCapital: params.initialCapital,
                commission: params.commission,
                maxConcurrentPositions: params.maxConcurrentPositions,
                positionSizePercent: params.positionSizePercent,
                onProgress: params.onProgress,
            });
        }
    });

    const metrics = createBaselineWindowMap(
        Object.fromEntries(
            Object.entries(windowResults).map(([window, evaluation]) => [window, evaluation?.portfolio]),
        ) as StrategyWindowMetricMap,
    );

    return {
        candidate: params.candidate,
        metrics,
        windows: windowResults,
        report: evaluateStrategyCandidate({
            strategyId: params.strategyId,
            baseline: params.baselineMetrics,
            candidate: metrics,
        }),
    };
}

export async function runStrategyOptimization(options: StrategyOptimizationRunnerOptions): Promise<StrategyOptimizationExecutionResult[]> {
    const strategyIds = options.strategyIds ?? [
        'strong-breakout',
        'trend-confirmation',
        'capital-inflow',
        'rsrs-trend',
        'volatility-squeeze',
    ];
    const windows = options.windows ?? ['30d', '90d', '180d'];
    const symbols = options.symbols ?? await fetchTopSymbols(options.baseUrl, options.symbolLimit ?? 30);
    const signalInterval = options.signalInterval ?? '1h';
    const executionInterval = options.executionInterval ?? '1m';
    const initialCapital = options.initialCapital ?? 10_000;
    const commission = options.commission ?? 0.04;
    const maxConcurrentPositions = options.maxConcurrentPositions ?? 3;
    const positionSizePercent = options.positionSizePercent ?? 30;
    const dataFetcher = new HistoricalDataFetcher({
        baseUrl: `${options.baseUrl}/api/backtest/klines`,
    });

    const results: StrategyOptimizationExecutionResult[] = [];

    for (const strategyId of strategyIds) {
        options.onProgress?.(`开始冻结 ${strategyId} baseline`);

        const baselineWindows: Partial<Record<OptimizationWindow, StrategyWindowEvaluation>> = {};
        for (const window of windows) {
            baselineWindows[window] = await runWindowEvaluation({
                dataFetcher,
                strategyId,
                symbols,
                window,
                signalInterval,
                executionInterval,
                initialCapital,
                commission,
                maxConcurrentPositions,
                positionSizePercent,
                onProgress: options.onProgress,
            });
        }

        const baselineMetrics = createBaselineWindowMap(
            Object.fromEntries(
                Object.entries(baselineWindows).map(([window, evaluation]) => [window, evaluation?.portfolio]),
            ) as StrategyWindowMetricMap,
        );

        const candidates: StrategyCandidateEvaluation[] = [];
        for (const candidate of buildStrategyParameterCandidates(strategyId)) {
            options.onProgress?.(`开始评估 ${strategyId} 候选 ${candidate.label}`);
            candidates.push(await runCandidateEvaluation({
                dataFetcher,
                strategyId,
                candidate,
                baselineMetrics,
                symbols,
                windows,
                signalInterval,
                executionInterval,
                initialCapital,
                commission,
                maxConcurrentPositions,
                positionSizePercent,
                onProgress: options.onProgress,
            }));
        }

        results.push({
            strategyId,
            symbols,
            baseline: baselineWindows,
            baselineMetrics,
            candidates,
            approvedCandidate: pickApprovedCandidate(candidates),
        });
    }

    return results;
}
