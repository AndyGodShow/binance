"use client";

import { useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import { historicalDataFetcher, HistoricalDataFetcher } from '@/lib/historicalDataFetcher';
import { BacktestEngine, BacktestResult, BacktestConfig, Trade } from '@/lib/backtestEngine';
import { strategyRegistry } from '@/strategies/registry';
import { TickerData } from '@/lib/types';
import { logger } from '@/lib/logger';
import { calculateDataQuality, DataQualityMetrics } from '@/lib/dataQuality';
import { StrategyRiskConfig } from '@/lib/risk/riskConfig';
import { calculateRiskManagement } from '@/lib/risk/riskCalculator';
import { applyRiskConfigOverrides } from '@/lib/risk/overrideRiskManagement';
import { buildHistoricalTickerOverrides, getRequiredHistoricalIntervals } from '@/lib/historicalMultiTimeframe';
import { buildBacktestDiagnostics, BacktestDiagnostics } from '@/lib/backtestDiagnostics';
import { buildExecutionIntervalFallbackCandidates as buildExecutionIntervalFallbackCandidateList } from '@/lib/backtestExecutionResolution';
import {
    resolveExecutableBacktestRange,
    runBacktestHistoryPreflight,
    type BacktestHistoryPreflightReport,
} from '@/lib/backtestHistoryPreflight';
import { runPortfolioBacktest, PortfolioBacktestResult } from '@/lib/portfolioBacktestEngine';
import { createStrategyRuntimeState } from '@/lib/strategyRuntimeState';
import {
    WEI_SHEN_UNIVERSE,
    filterWeiShenUniverseSymbols,
    getDefaultUniverseForStrategy,
} from '@/lib/weiShenUniverse';
import {
    isWeiShenStrategy,
    resolveStrategyIntervalsWithOverrides,
} from '@/lib/weiShenStrategy';
import { buildBacktestValidationStageRequest } from '@/lib/backtestValidationPlanner';
import { shouldDeferBacktestValidationFailure } from '@/lib/backtestValidation';
import DataQualityCard from './DataQualityCard';
import RiskConfigPanel from './RiskConfigPanel';
import StrategyParameterPanel from './StrategyParameterPanel';
import { EquityCurveChart, DrawdownChart, ProfitDistributionChart, HoldingTimeChart } from './BacktestCharts';
import styles from './BacktestPanel.module.css';
import type {
    DeepPartial,
    StrategyId,
    StrategyParameterConfigMap,
} from '@/lib/strategyParameters';

type PresetRange = '1d' | '7d' | '30d' | '90d' | '180d' | '1y';
type SymbolSource = 'top' | 'range' | 'custom';
type ExecutionIntervalOption = 'same' | '1m' | '5m' | '15m';
const TRADE_PAGE_SIZE = 20;
const DAY_MS = 24 * 60 * 60 * 1000;
const SYMBOL_VALIDATION_CONCURRENCY = 2;
const BACKTEST_VALIDATION_LIMIT = 1500;
const HISTORICAL_LOOKBACK_BUFFER_MS = 35 * DAY_MS;
const EXECUTION_VALIDATION_OFFSET_MS = 50 * 60 * 60 * 1000;
const EXECUTION_VALIDATION_CHUNK_MS = 1200 * 60 * 1000;

interface DownloadRequestResult {
    ok: boolean;
    status: number;
    message: string;
    unsupported: boolean;
}

interface CoverageResult {
    coveragePercent: number;
    totalDays: number;
    availableDays: number;
    missingDates: string[];
}

interface BacktestRunDetail {
    symbol: string;
    result: BacktestResult;
    diagnostics: BacktestDiagnostics;
    dataQuality: DataQualityMetrics;
    preflight: BacktestHistoryPreflightReport;
    rangeAdjusted: boolean;
    rangeAdjustmentReason?: string;
}

interface BatchBacktestItem {
    symbol: string;
    totalProfit: number;
    totalProfitUSDT: number;
    winRate: number;
    maxDrawdown: number;
    profitFactor: number;
    totalTrades: number;
}

interface BacktestTaskResult {
    symbol: string;
    run?: BacktestRunDetail;
    error?: Error;
}

interface SymbolIssueDetail {
    symbol: string;
    reason: string;
}

interface SymbolValidationResult {
    supportedSymbols: string[];
    skippedSymbols: string[];
    skippedDetails: SymbolIssueDetail[];
    executionIntervalsBySymbol: Record<string, string>;
}

interface SymbolValidationProgress {
    symbol: string;
    completed: number;
    total: number;
    supportedCount: number;
    skippedCount: number;
}

interface BacktestValidationStage {
    name: string;
    interval: string;
    startTime: number;
    endTime: number;
    minCount: number;
}

interface ProbeBacktestValidationResult {
    ok: boolean;
    reason?: string;
}

interface SymbolValidationSuccess {
    symbol: string;
    ok: true;
    executionInterval: string;
    degraded: boolean;
    reason?: undefined;
}

interface SymbolValidationFailure {
    symbol: string;
    ok: false;
    reason: string;
}

type SymbolValidationProbeResult = SymbolValidationSuccess | SymbolValidationFailure;

const MAX_BACKTEST_CONCURRENCY = 2;

interface BacktestPanelProps {
    strategyParameterOverrides?: DeepPartial<StrategyParameterConfigMap>;
    onStrategyParameterOverridesChange?: Dispatch<SetStateAction<DeepPartial<StrategyParameterConfigMap>>>;
}

async function requestHistoricalDataDownload(
    symbol: string,
    type: 'metrics' | 'fundingRate',
    startDate: string,
    endDate: string
): Promise<DownloadRequestResult> {
    try {
        const response = await fetch('/api/data/download', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ symbol, type, startDate, endDate }),
        });

        const payload = await response.json().catch(() => null);
        const message = typeof payload?.error === 'string'
            ? payload.error
            : typeof payload?.message === 'string'
                ? payload.message
                : `HTTP ${response.status}`;

        return {
            ok: response.ok,
            status: response.status,
            message,
            unsupported: payload?.status === 'unsupported',
        };
    } catch (error) {
        return {
            ok: false,
            status: 0,
            message: error instanceof Error ? error.message : '下载请求失败',
            unsupported: false,
        };
    }
}

async function fetchCoverage(
    symbol: string,
    type: 'metrics' | 'fundingRate',
    startDate: string,
    endDate: string
): Promise<CoverageResult> {
    try {
        const params = new URLSearchParams({
            symbol,
            type,
            startDate,
            endDate,
        });
        const response = await fetch(`/api/data/download?${params.toString()}`);
        const payload = await response.json().catch(() => null);

        if (!response.ok || !payload) {
            return {
                coveragePercent: 0,
                totalDays: 0,
                availableDays: 0,
                missingDates: [],
            };
        }

        return {
            coveragePercent: typeof payload.coveragePercent === 'number' ? payload.coveragePercent : 0,
            totalDays: typeof payload.totalDays === 'number' ? payload.totalDays : 0,
            availableDays: typeof payload.availableDays === 'number' ? payload.availableDays : 0,
            missingDates: Array.isArray(payload.missingDates) ? payload.missingDates : [],
        };
    } catch {
        return {
            coveragePercent: 0,
            totalDays: 0,
            availableDays: 0,
            missingDates: [],
        };
    }
}

function buildRiskCalculationParams(
    ticker: TickerData,
    direction: 'long' | 'short',
    confidence: number,
    accountBalance: number
) {
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

function parseCustomSymbols(input: string): string[] {
    return Array.from(
        new Set(
            input
                .split(/[\s,]+/)
                .map((item) => item.trim().toUpperCase())
                .filter(Boolean)
        )
    );
}

function resolveStrategyBacktestIntervalsWithOverrides(
    strategyId: string,
    signalInterval: string,
    executionSelection: ExecutionIntervalOption,
    parameterOverrides?: DeepPartial<StrategyParameterConfigMap>,
) {
    return resolveStrategyIntervalsWithOverrides({
        strategyId,
        signalInterval,
        executionInterval: resolveExecutionInterval(executionSelection, signalInterval),
        parameterOverrides,
    });
}

function isBacktestSymbolCandidate(symbol: string): boolean {
    return /^[A-Z0-9]+USDT$/.test(symbol);
}

function buildBacktestValidationUrl(symbol: string, stage: BacktestValidationStage): string {
    return buildBacktestValidationStageRequest({
        symbol,
        interval: stage.interval,
        startTime: stage.startTime,
        endTime: stage.endTime,
    }).url;
}

function estimateStageMinCount(startTime: number, endTime: number, interval: string, fallbackMinimum: number): number {
    const intervalMs = intervalToMs(interval);
    if (!intervalMs) {
        return fallbackMinimum;
    }

    const estimatedBars = Math.max(1, Math.floor((endTime - startTime) / intervalMs));
    return Math.max(fallbackMinimum, Math.min(BACKTEST_VALIDATION_LIMIT, Math.floor(estimatedBars * 0.7)));
}

function buildSignalValidationStages(
    signalInterval: string,
    startTime: number,
    endTime: number
): BacktestValidationStage[] {
    const intervalMs = intervalToMs(signalInterval);
    if (!intervalMs) {
        return [];
    }

    const fullRangeBars = Math.max(1, Math.floor((endTime - startTime) / intervalMs));
    if (fullRangeBars <= BACKTEST_VALIDATION_LIMIT) {
        return [{
            name: `signal-${signalInterval}`,
            interval: signalInterval,
            startTime,
            endTime,
            minCount: estimateStageMinCount(startTime, endTime, signalInterval, 24),
        }];
    }

    const firstStageEnd = Math.min(endTime, startTime + (intervalMs * (BACKTEST_VALIDATION_LIMIT - 1)));
    const lastStageStart = Math.max(startTime, endTime - (intervalMs * (BACKTEST_VALIDATION_LIMIT - 1)));

    return [
        {
            name: `signal-${signalInterval}-head`,
            interval: signalInterval,
            startTime,
            endTime: firstStageEnd,
            minCount: Math.max(240, Math.floor(BACKTEST_VALIDATION_LIMIT * 0.8)),
        },
        {
            name: `signal-${signalInterval}-tail`,
            interval: signalInterval,
            startTime: lastStageStart,
            endTime,
            minCount: Math.max(240, Math.floor(BACKTEST_VALIDATION_LIMIT * 0.8)),
        },
    ];
}

function buildExecutionValidationStages(
    executionInterval: string,
    startTime: number,
    endTime: number
): BacktestValidationStage[] {
    const firstStageStart = Math.min(endTime, startTime + EXECUTION_VALIDATION_OFFSET_MS);
    const firstStageEnd = Math.min(endTime, firstStageStart + EXECUTION_VALIDATION_CHUNK_MS);
    const stages: BacktestValidationStage[] = [{
        name: `execution-${executionInterval}-1`,
        interval: executionInterval,
        startTime: firstStageStart,
        endTime: firstStageEnd,
        minCount: estimateStageMinCount(firstStageStart, firstStageEnd, executionInterval, 60),
    }];

    const secondStageStart = firstStageEnd + 1;
    if (secondStageStart < endTime) {
        const secondStageEnd = Math.min(endTime, secondStageStart + EXECUTION_VALIDATION_CHUNK_MS);
        stages.push({
            name: `execution-${executionInterval}-2`,
            interval: executionInterval,
            startTime: secondStageStart,
            endTime: secondStageEnd,
            minCount: estimateStageMinCount(secondStageStart, secondStageEnd, executionInterval, 60),
        });
    }

    return stages;
}

function buildBacktestValidationStages(params: {
    strategyId: string;
    preset: PresetRange;
    signalInterval: string;
    executionSelection: ExecutionIntervalOption;
    executionIntervalOverride?: string;
    parameterOverrides?: DeepPartial<StrategyParameterConfigMap>;
}): BacktestValidationStage[] {
    const baseResolvedIntervals = resolveStrategyBacktestIntervalsWithOverrides(
        params.strategyId,
        params.signalInterval,
        params.executionSelection,
        params.parameterOverrides,
    );
    const resolvedIntervals = {
        ...baseResolvedIntervals,
        executionInterval: params.executionIntervalOverride ?? baseResolvedIntervals.executionInterval,
    };
    const { startTime, endTime } = HistoricalDataFetcher.getPresetRange(params.preset);
    const stages = buildSignalValidationStages(resolvedIntervals.signalInterval, startTime, endTime);
    const lookbackStartTime = Math.max(0, startTime - HISTORICAL_LOOKBACK_BUFFER_MS);

    getRequiredHistoricalIntervals(params.strategyId, params.parameterOverrides)
        .filter((interval) => interval !== resolvedIntervals.signalInterval)
        .forEach((interval) => {
            stages.push({
                name: `mtf-${interval}`,
                interval,
                startTime: lookbackStartTime,
                endTime,
                minCount: interval === '5m'
                    ? 120
                    : interval === '1d'
                        ? 21
                        : 8,
            });
        });

    if (resolvedIntervals.executionInterval !== resolvedIntervals.signalInterval) {
        stages.push(...buildExecutionValidationStages(resolvedIntervals.executionInterval, startTime, endTime));
    }

    return stages;
}

function resolveExecutionIntervalFallbackCandidates(params: {
    strategyId: string;
    signalInterval: string;
    executionSelection: ExecutionIntervalOption;
    parameterOverrides?: DeepPartial<StrategyParameterConfigMap>;
}): string[] {
    const resolvedIntervals = resolveStrategyBacktestIntervalsWithOverrides(
        params.strategyId,
        params.signalInterval,
        params.executionSelection,
        params.parameterOverrides,
    );
    return buildExecutionIntervalFallbackCandidateList({
        preferredExecutionInterval: resolvedIntervals.executionInterval,
        signalInterval: resolvedIntervals.signalInterval,
    });
}

function isRetryableValidationStatus(status: number): boolean {
    return status === 408 || status === 429 || status >= 500;
}

async function probeBacktestValidationStage(symbol: string, stage: BacktestValidationStage): Promise<ProbeBacktestValidationResult> {
    for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
            const response = await fetch(buildBacktestValidationUrl(symbol, stage));
            const payload = await response.json().catch(() => null);
            const count = Array.isArray(payload?.data) ? payload.data.length : 0;

            if (response.ok) {
                return count > 0 || stage.name.startsWith('mtf-')
                    ? { ok: true }
                    : {
                        ok: false,
                        reason: `${stage.name} 没有可用 K 线`,
                    };
            }

            if (shouldDeferBacktestValidationFailure(response.status, payload)) {
                return { ok: true };
            }

            if (!isRetryableValidationStatus(response.status) || attempt === 2) {
                const payloadMessage = typeof payload?.error === 'string'
                    ? payload.error
                    : typeof payload?.details === 'string'
                        ? payload.details
                        : `HTTP ${response.status}`;
                return {
                    ok: false,
                    reason: `${stage.name} 请求失败：${payloadMessage}`,
                };
            }
        } catch {
            if (attempt === 2) {
                // Network jitter during batch preflight should not block the whole batch.
                // The actual backtest run still performs stricter per-symbol data checks.
                return { ok: true };
            }
        }

        await new Promise((resolve) => setTimeout(resolve, 250 * (attempt + 1)));
    }

    return { ok: false, reason: `${stage.name} 校验未通过` };
}

function intervalToMs(interval: string): number {
    const match = interval.match(/^(\d+)(m|h|d|w|M)$/);
    if (!match) {
        return 0;
    }

    const value = Number.parseInt(match[1], 10);
    const unit = match[2];

    switch (unit) {
        case 'm':
            return value * 60 * 1000;
        case 'h':
            return value * 60 * 60 * 1000;
        case 'd':
            return value * 24 * 60 * 60 * 1000;
        case 'w':
            return value * 7 * 24 * 60 * 60 * 1000;
        case 'M':
            return value * 30 * 24 * 60 * 60 * 1000;
        default:
            return 0;
    }
}

function toUtcDateString(timestamp: number): string {
    const date = new Date(timestamp);
    const year = date.getUTCFullYear();
    const month = String(date.getUTCMonth() + 1).padStart(2, '0');
    const day = String(date.getUTCDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function getUtcDayStart(timestamp: number): number {
    const date = new Date(timestamp);
    return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

function getArchiveDateRange(startTime: number, endTime: number): { startDate: string; endDate: string } | null {
    const currentUtcDayStart = getUtcDayStart(Date.now());
    const archiveEndTime = endTime >= currentUtcDayStart
        ? currentUtcDayStart - 1
        : endTime;

    if (archiveEndTime < startTime) {
        return null;
    }

    return {
        startDate: toUtcDateString(startTime),
        endDate: toUtcDateString(archiveEndTime),
    };
}

function resolveExecutionInterval(selection: ExecutionIntervalOption, signalInterval: string): string {
    if (selection === 'same') {
        return signalInterval;
    }

    return intervalToMs(selection) <= intervalToMs(signalInterval)
        ? selection
        : signalInterval;
}

function getExecutionOptions(signalInterval: string): ExecutionIntervalOption[] {
    return (['same', '1m', '5m', '15m'] as ExecutionIntervalOption[]).filter((option) =>
        option === 'same' || intervalToMs(option) <= intervalToMs(signalInterval)
    );
}

async function fetchSymbolsByVolume(): Promise<string[]> {
    const response = await fetch('/api/market');
    if (!response.ok) {
        throw new Error(`获取市场数据失败: HTTP ${response.status}`);
    }

    const payload = await response.json();
    if (!Array.isArray(payload)) {
        throw new Error('市场数据格式异常');
    }

    return payload
        .filter((ticker): ticker is TickerData =>
            ticker &&
            typeof ticker.symbol === 'string' &&
            typeof ticker.quoteVolume === 'string' &&
            ticker.symbol.endsWith('USDT')
        )
        .sort((a, b) => parseFloat(b.quoteVolume || '0') - parseFloat(a.quoteVolume || '0'))
        .map((ticker) => ticker.symbol);
}

async function runWithConcurrency<T, R>(
    items: T[],
    concurrency: number,
    worker: (item: T, index: number) => Promise<R>
): Promise<R[]> {
    if (items.length === 0) {
        return [];
    }

    const results: R[] = new Array(items.length);
    let nextIndex = 0;

    const runWorker = async () => {
        while (nextIndex < items.length) {
            const currentIndex = nextIndex;
            nextIndex += 1;
            results[currentIndex] = await worker(items[currentIndex], currentIndex);
        }
    };

    const workerCount = Math.min(concurrency, items.length);
    await Promise.all(Array.from({ length: workerCount }, () => runWorker()));
    return results;
}

async function validateBacktestSymbols(
    symbols: string[],
    options: {
        strategyId: string;
        preset: PresetRange;
        signalInterval: string;
        executionSelection: ExecutionIntervalOption;
        parameterOverrides?: DeepPartial<StrategyParameterConfigMap>;
        onProgress?: (progress: SymbolValidationProgress) => void;
    }
): Promise<SymbolValidationResult> {
    const normalizedSymbols = Array.from(new Set(symbols.map((symbol) => symbol.trim().toUpperCase())))
        .filter(Boolean)
        .filter(isBacktestSymbolCandidate);
    const strategyUniverse = getDefaultUniverseForStrategy(options.strategyId);
    const uniqueCandidates = strategyUniverse
        ? filterWeiShenUniverseSymbols(normalizedSymbols)
        : normalizedSymbols;

    const invalidSymbols = symbols
        .map((symbol) => symbol.trim().toUpperCase())
        .filter((symbol) => symbol && (!isBacktestSymbolCandidate(symbol) || (strategyUniverse ? !WEI_SHEN_UNIVERSE.includes(symbol as (typeof WEI_SHEN_UNIVERSE)[number]) : false)));
    const invalidDetails = invalidSymbols.map((symbol) => ({
        symbol,
        reason: strategyUniverse && !WEI_SHEN_UNIVERSE.includes(symbol as (typeof WEI_SHEN_UNIVERSE)[number])
            ? '不在该策略允许的币池内'
            : '币种格式不符合 U 本位回测要求',
    }));

    const executionIntervalCandidates = resolveExecutionIntervalFallbackCandidates(options);
    let completedCount = 0;
    let supportedCount = 0;
    let skippedCount = 0;

    const probeResults = await runWithConcurrency<string, SymbolValidationProbeResult>(
        uniqueCandidates,
        SYMBOL_VALIDATION_CONCURRENCY,
        async (symbol) => {
            let lastFailureReason = '';

            for (const candidateExecutionInterval of executionIntervalCandidates) {
                const validationStages = buildBacktestValidationStages({
                    ...options,
                    executionIntervalOverride: candidateExecutionInterval,
                });
                let candidatePassed = true;

                for (const stage of validationStages) {
                    const probe = await probeBacktestValidationStage(symbol, stage);
                    if (!probe.ok) {
                        candidatePassed = false;
                        lastFailureReason = probe.reason || `${stage.name} 校验未通过`;
                        break;
                    }

                    await new Promise((resolve) => setTimeout(resolve, 80));
                }

                if (candidatePassed) {
                    completedCount += 1;
                    supportedCount += 1;
                    options.onProgress?.({
                        symbol,
                        completed: completedCount,
                        total: uniqueCandidates.length,
                        supportedCount,
                        skippedCount,
                    });
                    return {
                        symbol,
                        ok: true,
                        executionInterval: candidateExecutionInterval,
                        degraded: candidateExecutionInterval !== executionIntervalCandidates[0],
                    };
                }
            }

            completedCount += 1;
            skippedCount += 1;
            options.onProgress?.({
                symbol,
                completed: completedCount,
                total: uniqueCandidates.length,
                supportedCount,
                skippedCount,
            });
            return {
                symbol,
                ok: false,
                reason: lastFailureReason || '历史数据校验未通过',
            };
        }
    );

    const supportedSymbols = probeResults
        .filter((result) => result.ok)
        .map((result) => result.symbol);
    const skippedSymbols = [
        ...invalidSymbols,
        ...probeResults.filter((result) => !result.ok).map((result) => result.symbol),
    ];
    const skippedDetails = [
        ...invalidDetails,
        ...probeResults
            .filter((result) => !result.ok)
            .map((result) => ({
                symbol: result.symbol,
                reason: result.reason || '历史数据校验未通过',
            })),
    ];
    const executionIntervalsBySymbol = Object.fromEntries(
        probeResults
            .filter((result): result is SymbolValidationSuccess => result.ok)
            .map((result) => [result.symbol, result.executionInterval])
    );

    return {
        supportedSymbols,
        skippedSymbols,
        skippedDetails,
        executionIntervalsBySymbol,
    };
}

export default function BacktestPanel({
    strategyParameterOverrides: controlledStrategyParameterOverrides,
    onStrategyParameterOverridesChange,
}: BacktestPanelProps = {}) {
    const [interval, setInterval] = useState('1h');
    const [executionInterval, setExecutionInterval] = useState<ExecutionIntervalOption>('1m');
    const [preset, setPreset] = useState<PresetRange>('30d');
    const [selectedStrategy, setSelectedStrategy] = useState<string>('');
    const [initialCapital, setInitialCapital] = useState(10000);
    const [commission, setCommission] = useState(0.04);
    const [riskConfig, setRiskConfig] = useState<StrategyRiskConfig | null>(null);
    const [symbolSource, setSymbolSource] = useState<SymbolSource>('top');
    const [topN, setTopN] = useState(30);
    const [rangeStart, setRangeStart] = useState(30);
    const [rangeEnd, setRangeEnd] = useState(100);
    const [customSymbols, setCustomSymbols] = useState('BTCUSDT,ETHUSDT,SOLUSDT');
    const [maxConcurrentPositions, setMaxConcurrentPositions] = useState(3);
    const [positionSizePercent, setPositionSizePercent] = useState(30);
    const [uncontrolledStrategyParameterOverrides, setUncontrolledStrategyParameterOverrides] = useState<DeepPartial<StrategyParameterConfigMap>>({});
    const strategyParameterOverrides = controlledStrategyParameterOverrides ?? uncontrolledStrategyParameterOverrides;
    const setStrategyParameterOverrides = onStrategyParameterOverridesChange ?? setUncontrolledStrategyParameterOverrides;

    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [downloadStatus, setDownloadStatus] = useState<string>('');
    const [resolvedSymbols, setResolvedSymbols] = useState<string[]>([]);
    const [detailRun, setDetailRun] = useState<BacktestRunDetail | null>(null);
    const [allRuns, setAllRuns] = useState<BacktestRunDetail[]>([]);
    const [batchResults, setBatchResults] = useState<BatchBacktestItem[]>([]);
    const [failedSymbols, setFailedSymbols] = useState<string[]>([]);
    const [skippedSymbols, setSkippedSymbols] = useState<string[]>([]);
    const [failedDetails, setFailedDetails] = useState<SymbolIssueDetail[]>([]);
    const [skippedDetails, setSkippedDetails] = useState<SymbolIssueDetail[]>([]);
    const [executionIntervalsBySymbol, setExecutionIntervalsBySymbol] = useState<Record<string, string>>({});
    const [portfolioResult, setPortfolioResult] = useState<PortfolioBacktestResult | null>(null);
    const [portfolioTradePage, setPortfolioTradePage] = useState(1);
    const [detailTradePage, setDetailTradePage] = useState(1);

    const strategies = strategyRegistry.getAll();
    const executionOptions = getExecutionOptions(interval);
    const selectedStrategyId = selectedStrategy as StrategyId | '';

    const resolveSymbols = async () => {
        const strategyUniverse = getDefaultUniverseForStrategy(selectedStrategy);
        if (strategyUniverse) {
            if (symbolSource === 'custom') {
                const filtered = filterWeiShenUniverseSymbols(parseCustomSymbols(customSymbols));
                if (filtered.length === 0) {
                    throw new Error('魏神策略只允许 BTCUSDT / ETHUSDT / SOLUSDT / XRPUSDT / DOGEUSDT');
                }
                return filtered;
            }

            return [...strategyUniverse];
        }

        if (symbolSource === 'range') {
            const start = Math.max(1, Math.floor(rangeStart));
            const end = Math.max(start, Math.floor(rangeEnd));
            const symbols = await fetchSymbolsByVolume();
            const sliced = symbols.slice(start - 1, end);
            if (sliced.length === 0) {
                throw new Error('成交额区间没有可回测币种');
            }
            return sliced;
        }

        if (symbolSource === 'custom') {
            const symbols = parseCustomSymbols(customSymbols);
            if (symbols.length === 0) {
                throw new Error('请至少输入一个自定义币种');
            }
            return symbols;
        }

        const candidateLimit = Math.max(topN * 3, topN + 20);
        const topCandidates = (await fetchSymbolsByVolume()).slice(0, candidateLimit);
        if (topCandidates.length === 0) {
            throw new Error('未获取到可回测币种');
        }
        return topCandidates;
    };

    const getTargetSupportedSymbolCount = (candidateCount: number) => {
        if (symbolSource === 'top') {
            return Math.min(topN, candidateCount);
        }

        return candidateCount;
    };

    const runSingleBacktest = async (
        symbol: string,
        strategyId: string,
        activePreset: PresetRange,
        activeInterval: string,
        activeExecutionSelection: ExecutionIntervalOption,
        executionIntervalOverride?: string,
    ): Promise<BacktestRunDetail> => {
        const strategy = strategies.find((item) => item.id === strategyId);
        if (!strategy) {
            throw new Error('策略不存在');
        }

        const { signalInterval: resolvedSignalInterval, executionInterval: resolvedExecutionInterval } = resolveStrategyBacktestIntervalsWithOverrides(
            strategyId,
            activeInterval,
            activeExecutionSelection,
            strategyParameterOverrides,
        );
        const activeExecutionInterval = executionIntervalOverride ?? resolvedExecutionInterval;
        const requestedRange = HistoricalDataFetcher.getPresetRange(activePreset);
        let activeStartTime = requestedRange.startTime;
        let activeEndTime = requestedRange.endTime;
        let rangeAdjusted = false;
        let rangeAdjustmentReason: string | undefined;
        const daysDiff = (requestedRange.endTime - requestedRange.startTime) / DAY_MS;
        const archiveDateRange = getArchiveDateRange(requestedRange.startTime, requestedRange.endTime);
        const normalizedSymbol = symbol.trim().toUpperCase();
        let nextDownloadStatus = '';

        if (daysDiff > 30 && archiveDateRange) {
            const [metricsCoverage, fundingCoverage] = await Promise.all([
                fetchCoverage(normalizedSymbol, 'metrics', archiveDateRange.startDate, archiveDateRange.endDate),
                fetchCoverage(normalizedSymbol, 'fundingRate', archiveDateRange.startDate, archiveDateRange.endDate),
            ]);

            const avgCoverage = (metricsCoverage.coveragePercent + fundingCoverage.coveragePercent) / 2;

            if (avgCoverage < 50) {
                nextDownloadStatus = `📥 ${normalizedSymbol} 本地历史数据覆盖率仅 ${avgCoverage.toFixed(0)}%，正在自动补齐...`;
                setDownloadStatus(nextDownloadStatus);

                const downloadTypes = ['metrics', 'fundingRate'] as const;
                const downloadResults = await Promise.all(
                    downloadTypes.map((type) =>
                        requestHistoricalDataDownload(normalizedSymbol, type, archiveDateRange.startDate, archiveDateRange.endDate)
                    )
                );

                if (downloadResults.some((result) => result.unsupported)) {
                    nextDownloadStatus = `ℹ️ ${normalizedSymbol} 当前环境不支持本地历史数据补齐，本次继续使用 API 数据。`;
                } else if (downloadResults.some((result) => result.ok)) {
                    nextDownloadStatus = `📥 ${normalizedSymbol} 已发起后台历史数据补齐，本次先使用当前可用数据。`;
                } else {
                    nextDownloadStatus = `⚠️ ${normalizedSymbol} 历史数据补齐请求失败，本次继续使用当前可用数据。`;
                }
                setDownloadStatus(nextDownloadStatus);
            }
        }

        let klines = await historicalDataFetcher.fetchRangeData(
            normalizedSymbol,
            resolvedSignalInterval,
            activeStartTime,
            activeEndTime
        );

        let preflight = await runBacktestHistoryPreflight({
            dataFetcher: historicalDataFetcher,
            strategyId,
            symbol: normalizedSymbol,
            startTime: activeStartTime,
            endTime: activeEndTime,
            signalInterval: resolvedSignalInterval,
            executionInterval: activeExecutionInterval,
            parameterOverrides: strategyParameterOverrides,
        });

        if (!preflight.passed) {
            const executableRange = resolveExecutableBacktestRange(preflight);
            if (!executableRange) {
                throw new Error(
                    `历史数据 preflight 未通过：${preflight.reasons[0] || `${normalizedSymbol} 关键周期覆盖不足`}`,
                );
            }

            activeStartTime = executableRange.startTime;
            activeEndTime = executableRange.endTime;
            rangeAdjusted = executableRange.degraded;
            rangeAdjustmentReason = executableRange.reason;
            setDownloadStatus(
                `🧭 ${normalizedSymbol} 历史数据不足以覆盖完整目标周期，已改用 ` +
                `${new Date(activeStartTime).toLocaleDateString()} - ${new Date(activeEndTime).toLocaleDateString()} 可用区间。`
            );

            klines = await historicalDataFetcher.fetchRangeData(
                normalizedSymbol,
                resolvedSignalInterval,
                activeStartTime,
                activeEndTime,
            );
            preflight = await runBacktestHistoryPreflight({
                dataFetcher: historicalDataFetcher,
                strategyId,
                symbol: normalizedSymbol,
                startTime: activeStartTime,
                endTime: activeEndTime,
                signalInterval: resolvedSignalInterval,
                executionInterval: activeExecutionInterval,
                parameterOverrides: strategyParameterOverrides,
            });
        }

        if (klines.length === 0) {
            throw new Error('未获取到历史数据');
        }

        const dataQuality = calculateDataQuality(klines);
        if (dataQuality.dataQualityScore < 60 && !nextDownloadStatus) {
            setDownloadStatus(`⚠️ ${normalizedSymbol} 当前回测数据质量一般。`);
        }

        const historicalTickerOverrides = await buildHistoricalTickerOverrides({
            strategyId,
            symbol: normalizedSymbol,
            startTime: activeStartTime,
            endTime: activeEndTime,
            baseInterval: resolvedSignalInterval,
            baseKlines: klines,
            parameterOverrides: strategyParameterOverrides,
            fetchRangeData: (nextSymbol, nextInterval, nextStartTime, nextEndTime) =>
                historicalDataFetcher.fetchRangeData(nextSymbol, nextInterval, nextStartTime, nextEndTime, {
                    includeAuxiliary: false,
                }),
        });

        const config: Partial<BacktestConfig> = {
            initialCapital,
            commission,
            slippage: 0.05,
            useStrategyRiskManagement: true,
        };

        const engine = new BacktestEngine(config);
        const activeRiskConfig = riskConfig;
        const runtimeState = createStrategyRuntimeState();

        const result = await engine.run({
            signalKlines: klines,
            strategyDetector: (ticker: TickerData) => {
                const enrichedTicker = historicalTickerOverrides.size > 0
                    ? { ...ticker, ...historicalTickerOverrides.get(ticker.closeTime) }
                    : ticker;

                const signal = strategy.detect(enrichedTicker, {
                    now: ticker.closeTime,
                    runtimeState,
                    parameterOverrides: strategyParameterOverrides,
                });
                if (!signal || signal.executionMode === 'observe') return null;

                const baseRisk = signal.risk || (
                    isWeiShenStrategy(strategy.id)
                        ? undefined
                        : calculateRiskManagement(
                            strategy.id,
                            buildRiskCalculationParams(enrichedTicker, signal.direction, signal.confidence, initialCapital),
                        )
                );
                if (!baseRisk) {
                    return null;
                }

                const effectiveRisk = applyRiskConfigOverrides({
                    strategyId: strategy.id,
                    baseRisk,
                    overrideConfig: activeRiskConfig,
                    ticker: enrichedTicker,
                    direction: signal.direction,
                });

                return {
                    signal: signal.direction,
                    confidence: signal.confidence,
                    risk: effectiveRisk,
                };
            },
            strategyName: strategy.name,
            symbol: normalizedSymbol,
            signalInterval: resolvedSignalInterval,
            executionInterval: activeExecutionInterval,
            simulationEndTime: activeEndTime,
            fetchExecutionKlines: activeExecutionInterval === resolvedSignalInterval
                ? undefined
                : (nextStartTime, nextEndTime) => historicalDataFetcher.fetchRangeData(
                    normalizedSymbol,
                    activeExecutionInterval,
                    nextStartTime,
                    nextEndTime,
                    { includeAuxiliary: false }
                ),
        });

        const diagnostics = buildBacktestDiagnostics({
            strategyId: strategy.id,
            interval: resolvedSignalInterval,
            executionInterval: activeExecutionInterval,
            requestedDays: (activeEndTime - activeStartTime) / DAY_MS,
            dataQuality,
            hasHistoricalMultiTimeframe: historicalTickerOverrides.size > 0,
        });

        return {
            symbol: normalizedSymbol,
            result,
            diagnostics,
            dataQuality,
            preflight,
            rangeAdjusted,
            rangeAdjustmentReason,
        };
    };

    const handleBacktest = async () => {
        if (!selectedStrategy) {
            setError('请选择一个策略');
            return;
        }

        setLoading(true);
        setError(null);
        setDownloadStatus('');
        setResolvedSymbols([]);
        setDetailRun(null);
        setAllRuns([]);
        setBatchResults([]);
        setFailedSymbols([]);
        setSkippedSymbols([]);
        setFailedDetails([]);
        setSkippedDetails([]);
        setExecutionIntervalsBySymbol({});
        setPortfolioResult(null);
        setPortfolioTradePage(1);
        setDetailTradePage(1);

        try {
            const symbols = await resolveSymbols();
            setDownloadStatus(`🔎 已选中 ${symbols.length} 个币种，正在检查历史回测可用性...`);

            const {
                supportedSymbols,
                skippedSymbols: nextSkippedSymbols,
                skippedDetails: nextSkippedDetails,
                executionIntervalsBySymbol: nextExecutionIntervalsBySymbol,
            } = await validateBacktestSymbols(symbols, {
                strategyId: selectedStrategy,
                preset,
                signalInterval: interval,
                executionSelection: executionInterval,
                parameterOverrides: strategyParameterOverrides,
                onProgress: ({ symbol, completed, total, supportedCount, skippedCount }) => {
                    setDownloadStatus(
                        `🔎 正在检查历史回测可用性：${completed}/${total}，最近完成 ${symbol}` +
                        `，当前可回测 ${supportedCount}` +
                        (skippedCount > 0 ? `，跳过 ${skippedCount}` : '') +
                        '...'
                    );
                },
            });
            if (supportedSymbols.length === 0) {
                throw new Error('所选币池都无法通过历史数据校验，请缩小范围或改用自定义币种。');
            }

            const targetSupportedCount = getTargetSupportedSymbolCount(symbols.length);
            const runnableSymbols = supportedSymbols.slice(0, targetSupportedCount);
            const runnableExecutionIntervalsBySymbol = Object.fromEntries(
                runnableSymbols.map((symbol) => [symbol, nextExecutionIntervalsBySymbol[symbol]])
            );

            setResolvedSymbols(runnableSymbols);
            setSkippedSymbols(nextSkippedSymbols);
            setSkippedDetails(nextSkippedDetails);
            setExecutionIntervalsBySymbol(runnableExecutionIntervalsBySymbol);
            const preferredExecutionInterval = resolveStrategyBacktestIntervalsWithOverrides(
                selectedStrategy,
                interval,
                executionInterval,
                strategyParameterOverrides,
            ).executionInterval;
            const degradedSymbols = runnableSymbols.filter((symbol) =>
                runnableExecutionIntervalsBySymbol[symbol] &&
                runnableExecutionIntervalsBySymbol[symbol] !== preferredExecutionInterval
            );
            const replacementCount = symbolSource === 'top'
                ? Math.max(0, runnableSymbols.length - Math.min(topN, symbols.slice(0, topN).filter((symbol) => supportedSymbols.includes(symbol)).length))
                : 0;
            setDownloadStatus(
                `🔎 历史数据校验完成：可回测 ${runnableSymbols.length}/${targetSupportedCount} 个` +
                (replacementCount > 0 ? `，自动补位 ${replacementCount} 个` : '') +
                (nextSkippedSymbols.length > 0 ? `，跳过 ${nextSkippedSymbols.length} 个` : '') +
                (degradedSymbols.length > 0 ? `，${degradedSymbols.length} 个自动降级执行周期` : '') +
                '，开始并发回测...'
            );

            let finishedCount = 0;
            let successCount = 0;
            const taskResults = await runWithConcurrency<string, BacktestTaskResult>(
                runnableSymbols,
                MAX_BACKTEST_CONCURRENCY,
                async (symbol, index) => {
                    setDownloadStatus(`⏳ 正在回测 ${symbol} (${index + 1}/${runnableSymbols.length})，已完成 ${finishedCount}/${runnableSymbols.length}...`);

                    try {
                        const run = await runSingleBacktest(
                            symbol,
                            selectedStrategy,
                            preset,
                            interval,
                            executionInterval,
                            runnableExecutionIntervalsBySymbol[symbol],
                        );
                        finishedCount += 1;
                        successCount += 1;
                        setDownloadStatus(`⏳ 已完成 ${finishedCount}/${runnableSymbols.length}，成功 ${successCount} 个...`);
                        return { symbol, run };
                    } catch (runError) {
                        finishedCount += 1;
                        setDownloadStatus(`⏳ 已完成 ${finishedCount}/${runnableSymbols.length}，成功 ${successCount} 个...`);
                        logger.error(`Backtest failed for ${symbol}`, runError as Error);
                        return {
                            symbol,
                            error: runError instanceof Error ? runError : new Error('回测失败'),
                        };
                    }
                }
            );
            const completedRuns = taskResults
                .filter((item): item is BacktestTaskResult & { run: BacktestRunDetail } => Boolean(item.run))
                .map((item) => item.run);
            const failed = taskResults
                .filter((item) => item.error)
                .map((item) => item.symbol);
            const nextFailedDetails = taskResults
                .filter((item): item is BacktestTaskResult & { error: Error } => Boolean(item.error))
                .map((item) => ({
                    symbol: item.symbol,
                    reason: item.error.message,
                }));

            if (completedRuns.length === 0) {
                throw new Error('批量回测失败，所有币种都未跑出结果');
            }

            const sortedRuns = [...completedRuns].sort((a, b) => b.result.totalProfit - a.result.totalProfit);
            const nextPortfolioResult = runPortfolioBacktest(
                completedRuns.map((run) => ({
                    symbol: run.symbol,
                    result: run.result,
                })),
                {
                    initialCapital,
                    maxConcurrentPositions,
                    positionSizePercent,
                    strategyId: selectedStrategy,
                    parameterOverrides: strategyParameterOverrides,
                }
            );
            setAllRuns(sortedRuns);
            setBatchResults(sortedRuns.map((run) => ({
                symbol: run.symbol,
                totalProfit: run.result.totalProfit,
                totalProfitUSDT: run.result.totalProfitUSDT,
                winRate: run.result.winRate,
                maxDrawdown: run.result.maxDrawdown,
                profitFactor: run.result.profitFactor,
                totalTrades: run.result.totalTrades,
            })));
            setDetailRun(sortedRuns[0]);
            setDetailTradePage(1);
            setFailedSymbols(failed);
            setFailedDetails(nextFailedDetails);
            setPortfolioResult(nextPortfolioResult);
            setPortfolioTradePage(1);

            const zeroTradeCount = completedRuns.filter((run) => run.result.totalTrades === 0).length;
            const completedCount = completedRuns.length;
            setDownloadStatus(
                `✅ 批量回测完成：成功 ${completedCount}/${supportedSymbols.length}` +
                (failed.length > 0 ? `，失败 ${failed.length}` : '') +
                (nextSkippedSymbols.length > 0 ? `，预筛跳过 ${nextSkippedSymbols.length}` : '') +
                (zeroTradeCount > 0 ? `，其中 ${zeroTradeCount} 个币种未产生交易` : '')
            );

            if (failed.length > 0) {
                setError(`部分币种回测失败：${failed.slice(0, 8).join(', ')}${failed.length > 8 ? ' ...' : ''}`);
            } else if (completedRuns.every((run) => run.result.totalTrades === 0)) {
                setError('批量回测完成，但所有币种都未产生交易，建议尝试更长周期或更活跃的策略。');
            }
        } catch (err) {
            logger.error('Backtest failed', err as Error);
            setError(err instanceof Error ? err.message : '回测失败');
        } finally {
            setLoading(false);
        }
    };

    const formatDuration = (ms: number) => {
        const hours = Math.floor(ms / (1000 * 60 * 60));
        const minutes = Math.floor((ms % (1000 * 60 * 60)) / (1000 * 60));
        if (hours > 0) return `${hours}小时${minutes}分钟`;
        return `${minutes}分钟`;
    };

    const formatSignedPercent = (value: number) => `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`;
    const formatSignedUsdt = (value: number) => `${value >= 0 ? '+' : ''}${value.toFixed(2)} USDT`;
    const formatProfitFactor = (value: number, totalTrades: number) => {
        if (totalTrades === 0) {
            return '--';
        }
        if (!Number.isFinite(value)) {
            return '∞';
        }
        return value.toFixed(2);
    };
    const paginateTrades = (trades: Trade[], page: number) => {
        const orderedTrades = [...trades].reverse();
        const totalPages = Math.max(1, Math.ceil(orderedTrades.length / TRADE_PAGE_SIZE));
        const currentPage = Math.min(page, totalPages);
        const startIndex = (currentPage - 1) * TRADE_PAGE_SIZE;

        return {
            currentPage,
            totalPages,
            visibleTrades: orderedTrades.slice(startIndex, startIndex + TRADE_PAGE_SIZE),
        };
    };

    const portfolioPagination = portfolioResult
        ? paginateTrades(portfolioResult.trades, portfolioTradePage)
        : null;
    const detailPagination = detailRun
        ? paginateTrades(detailRun.result.trades, detailTradePage)
        : null;

    return (
        <div className={styles.container}>
            <div className={styles.header}>
                <h2>🔬 策略回测</h2>
                <p>使用历史数据测试策略表现</p>
            </div>

            <div className={styles.autoInfo}>
                超过 30 天的回测会自动检查并补齐本地 OI / 资金费率数据。简易批量版支持按成交额 Top N 或自定义币种列表回测，默认 Top 30。
            </div>

            {detailRun && (
                <DataQualityCard metrics={detailRun.dataQuality} />
            )}

            <div className={styles.configPanel}>
                <div className={styles.section}>
                    <h3>📊 回测范围</h3>
                    <div className={styles.fields}>
                        <div className={styles.field}>
                            <label>币池来源</label>
                            <select value={symbolSource} onChange={(e) => setSymbolSource(e.target.value as SymbolSource)}>
                                <option value="top">成交额 Top N</option>
                                <option value="range">成交额区间</option>
                                <option value="custom">自定义币种</option>
                            </select>
                        </div>
                        {symbolSource === 'top' ? (
                            <div className={styles.field}>
                                <label>成交额排名</label>
                                <select value={topN} onChange={(e) => setTopN(Number(e.target.value))}>
                                    <option value={10}>Top 10</option>
                                    <option value={20}>Top 20</option>
                                    <option value={30}>Top 30</option>
                                    <option value={50}>Top 50</option>
                                    <option value={100}>Top 100</option>
                                </select>
                            </div>
                        ) : symbolSource === 'range' ? (
                            <>
                                <div className={styles.field}>
                                    <label>起始排名</label>
                                    <input
                                        type="number"
                                        value={rangeStart}
                                        onChange={(e) => setRangeStart(Number(e.target.value))}
                                        min="1"
                                        step="1"
                                    />
                                </div>
                                <div className={styles.field}>
                                    <label>结束排名</label>
                                    <input
                                        type="number"
                                        value={rangeEnd}
                                        onChange={(e) => setRangeEnd(Number(e.target.value))}
                                        min="1"
                                        step="1"
                                    />
                                </div>
                            </>
                        ) : (
                            <div className={`${styles.field} ${styles.fieldWide}`}>
                                <label>自定义币种</label>
                                <textarea
                                    className={styles.textarea}
                                    value={customSymbols}
                                    onChange={(e) => setCustomSymbols(e.target.value.toUpperCase())}
                                    placeholder="BTCUSDT, ETHUSDT, SOLUSDT"
                                />
                            </div>
                        )}
                        <div className={styles.field}>
                            <label>时间周期</label>
                            <select
                                value={interval}
                                onChange={(e) => {
                                    const nextInterval = e.target.value;
                                    setInterval(nextInterval);
                                    if (!getExecutionOptions(nextInterval).includes(executionInterval)) {
                                        setExecutionInterval('same');
                                    }
                                }}
                            >
                                <option value="5m">5分钟</option>
                                <option value="15m">15分钟</option>
                                <option value="30m">30分钟</option>
                                <option value="1h">1小时</option>
                                <option value="4h">4小时</option>
                                <option value="1d">1天</option>
                            </select>
                        </div>
                        <div className={styles.field}>
                            <label>执行周期</label>
                            <select value={executionInterval} onChange={(e) => setExecutionInterval(e.target.value as ExecutionIntervalOption)}>
                                {executionOptions.map((option) => (
                                    <option key={option} value={option}>
                                        {option === 'same' ? '跟随信号周期' : option}
                                    </option>
                                ))}
                            </select>
                        </div>
                        <div className={styles.field}>
                            <label>回测周期</label>
                            <select value={preset} onChange={(e) => setPreset(e.target.value as PresetRange)}>
                                <option value="7d">最近7天</option>
                                <option value="30d">最近30天</option>
                                <option value="90d">最近90天</option>
                                <option value="180d">最近180天</option>
                                <option value="1y">最近1年</option>
                            </select>
                        </div>
                    </div>
                </div>

                <div className={styles.section}>
                    <h3>🎯 策略选择</h3>
                    <div className={styles.strategyGrid}>
                        {strategies.map((strategy) => (
                            <button
                                key={strategy.id}
                                className={`${styles.strategyBtn} ${selectedStrategy === strategy.id ? styles.active : ''}`}
                                onClick={() => setSelectedStrategy(strategy.id)}
                            >
                                <span className={styles.strategyName}>{strategy.name}</span>
                                <span className={styles.strategyDesc}>{strategy.description}</span>
                            </button>
                        ))}
                    </div>
                </div>

                <div className={styles.section}>
                    <h3>⚙️ 基础参数</h3>
                    <div className={styles.fields}>
                        <div className={styles.field}>
                            <label>初始资金 (USDT)</label>
                            <input
                                type="number"
                                value={initialCapital}
                                onChange={(e) => setInitialCapital(Number(e.target.value))}
                                min="100"
                                step="1000"
                            />
                        </div>
                        <div className={styles.field}>
                            <label>手续费 (%)</label>
                            <input
                                type="number"
                                value={commission}
                                onChange={(e) => setCommission(Number(e.target.value))}
                                min="0"
                                step="0.01"
                            />
                        </div>
                        <div className={styles.field}>
                            <label>组合最大持仓</label>
                            <input
                                type="number"
                                value={maxConcurrentPositions}
                                onChange={(e) => setMaxConcurrentPositions(Number(e.target.value))}
                                min="1"
                                max="10"
                                step="1"
                            />
                        </div>
                        <div className={styles.field}>
                            <label>单笔仓位 (%)</label>
                            <input
                                type="number"
                                value={positionSizePercent}
                                onChange={(e) => setPositionSizePercent(Number(e.target.value))}
                                min="1"
                                max="100"
                                step="1"
                            />
                        </div>
                    </div>
                </div>

                {selectedStrategy && (
                    <StrategyParameterPanel
                        key={selectedStrategy}
                        strategyId={selectedStrategy as StrategyId}
                        overrideValue={selectedStrategyId ? strategyParameterOverrides[selectedStrategyId] : undefined}
                        onChange={(value) => {
                            const strategyId = selectedStrategy as StrategyId;
                            setStrategyParameterOverrides((prev) => {
                                const next = { ...prev };
                                if (value) {
                                    next[strategyId] = value;
                                } else {
                                    delete next[strategyId];
                                }
                                return next;
                            });
                        }}
                    />
                )}

                {selectedStrategy && (
                    <RiskConfigPanel
                        strategyId={selectedStrategy}
                        onChange={setRiskConfig}
                    />
                )}

                <button
                    className={styles.runBtn}
                    onClick={handleBacktest}
                    disabled={loading || !selectedStrategy}
                >
                    {loading ? '⏳ 批量回测中...' : '🚀 开始批量回测'}
                </button>
            </div>

            {downloadStatus && (
                <div className={styles.info}>
                    {downloadStatus}
                </div>
            )}

            {resolvedSymbols.length > 0 && (
                <div className={styles.poolInfo}>
                    本次币池：{resolvedSymbols.join(', ')}
                    {Object.keys(executionIntervalsBySymbol).length > 0 && (
                        <div className={styles.executionMap}>
                            执行周期：{resolvedSymbols.map((symbol) =>
                                `${symbol}=${executionIntervalsBySymbol[symbol] || '默认'}`
                            ).join(', ')}
                        </div>
                    )}
                </div>
            )}

            {skippedSymbols.length > 0 && (
                <div className={styles.info}>
                    已跳过不可回测标的：{skippedSymbols.join(', ')}
                    {skippedDetails.length > 0 && (
                        <ul className={styles.issueList}>
                            {skippedDetails.slice(0, 8).map((item) => (
                                <li key={`skipped-${item.symbol}`}>
                                    <strong>{item.symbol}</strong>：{item.reason}
                                </li>
                            ))}
                            {skippedDetails.length > 8 && (
                                <li>还有 {skippedDetails.length - 8} 个标的被跳过。</li>
                            )}
                        </ul>
                    )}
                </div>
            )}

            {error && (
                <div className={styles.error}>
                    ❌ {error}
                </div>
            )}

            {batchResults.length > 0 && (
                <div className={styles.resultPanel}>
                    <h3>📊 批量回测排名</h3>

                    <div className={styles.overview}>
                        <div className={styles.overviewCard}>
                            <span className={styles.label}>成功币种</span>
                            <span className={styles.value}>{batchResults.length}</span>
                            <span className={styles.subValue}>
                                {failedSymbols.length > 0 ? `失败 ${failedSymbols.length} 个` : '全部成功'}
                            </span>
                        </div>
                        <div className={styles.overviewCard}>
                            <span className={styles.label}>最佳币种</span>
                            <span className={styles.value}>{batchResults[0]?.symbol}</span>
                            <span className={`${styles.subValue} ${(batchResults[0]?.totalProfit ?? 0) >= 0 ? styles.positive : styles.negative}`}>
                                {batchResults[0] ? formatSignedPercent(batchResults[0].totalProfit) : '-'}
                            </span>
                        </div>
                        <div className={styles.overviewCard}>
                            <span className={styles.label}>有交易币种</span>
                            <span className={styles.value}>
                                {batchResults.filter((item) => item.totalTrades > 0).length}
                            </span>
                            <span className={styles.subValue}>按总交易次数大于 0 统计</span>
                        </div>
                    </div>

                    <div className={styles.tradesSection}>
                        <h4>🏆 收益排名</h4>
                        <div className={styles.tableWrapper}>
                            <table className={styles.tradesTable}>
                                <thead>
                                    <tr>
                                        <th>排名</th>
                                        <th>币种</th>
                                        <th>总收益</th>
                                        <th>收益额</th>
                                        <th>胜率</th>
                                        <th>最大回撤</th>
                                        <th>盈亏比</th>
                                        <th>交易次数</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {batchResults.map((item, index) => (
                                        <tr
                                            key={item.symbol}
                                            className={detailRun?.symbol === item.symbol ? styles.selectedRow : ''}
                                        >
                                            <td>{index + 1}</td>
                                            <td>
                                                <button
                                                    type="button"
                                                    className={styles.linkButton}
                                                    onClick={() => {
                                                        const matchedRun = allRuns[index];
                                                        if (!matchedRun) return;
                                                        setDetailRun(matchedRun);
                                                        setDetailTradePage(1);
                                                    }}
                                                >
                                                    {item.symbol}
                                                </button>
                                            </td>
                                            <td className={item.totalProfit >= 0 ? styles.positive : styles.negative}>
                                                {formatSignedPercent(item.totalProfit)}
                                            </td>
                                            <td className={item.totalProfitUSDT >= 0 ? styles.positive : styles.negative}>
                                                {formatSignedUsdt(item.totalProfitUSDT)}
                                            </td>
                                            <td>{item.winRate.toFixed(2)}%</td>
                                            <td className={styles.negative}>{item.maxDrawdown.toFixed(2)}%</td>
                                            <td>{formatProfitFactor(item.profitFactor, item.totalTrades)}</td>
                                            <td>{item.totalTrades}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>

                    {failedSymbols.length > 0 && (
                        <div className={styles.errorList}>
                            失败币种：{failedSymbols.join(', ')}
                            {failedDetails.length > 0 && (
                                <ul className={styles.issueList}>
                                    {failedDetails.slice(0, 8).map((item) => (
                                        <li key={`failed-${item.symbol}`}>
                                            <strong>{item.symbol}</strong>：{item.reason}
                                        </li>
                                    ))}
                                    {failedDetails.length > 8 && (
                                        <li>还有 {failedDetails.length - 8} 个失败原因未展示。</li>
                                    )}
                                </ul>
                            )}
                        </div>
                    )}
                </div>
            )}

            {portfolioResult && (
                <div className={styles.resultPanel}>
                    <h3>🧪 组合回测（试验版）</h3>

                    <div className={styles.detailHint}>
                        这版按所有单币交易记录的真实时间顺序合并，用共享资金池统一撮合。
                        当前规则：最多同时持仓 {maxConcurrentPositions} 个，单笔仓位 {positionSizePercent}%。
                    </div>

                    <div className={styles.overview}>
                        <div className={styles.overviewCard}>
                            <span className={styles.label}>组合总收益</span>
                            <span className={`${styles.value} ${portfolioResult.totalProfit >= 0 ? styles.positive : styles.negative}`}>
                                {portfolioResult.totalProfit.toFixed(2)}%
                            </span>
                            <span className={styles.subValue}>{formatSignedUsdt(portfolioResult.totalProfitUSDT)}</span>
                        </div>
                        <div className={styles.overviewCard}>
                            <span className={styles.label}>最终资金</span>
                            <span className={styles.value}>{portfolioResult.finalCapital.toFixed(2)} U</span>
                            <span className={styles.subValue}>初始 {portfolioResult.initialCapital.toFixed(2)} U</span>
                        </div>
                        <div className={styles.overviewCard}>
                            <span className={styles.label}>最大回撤</span>
                            <span className={`${styles.value} ${styles.negative}`}>
                                {portfolioResult.maxDrawdown.toFixed(2)}%
                            </span>
                            <span className={styles.subValue}>共享资金口径</span>
                        </div>
                        <div className={styles.overviewCard}>
                            <span className={styles.label}>执行交易</span>
                            <span className={styles.value}>{portfolioResult.executedTrades}</span>
                            <span className={styles.subValue}>
                                跳过 {portfolioResult.skippedTrades} / 候选 {portfolioResult.totalTrades}
                            </span>
                        </div>
                        <div className={styles.overviewCard}>
                            <span className={styles.label}>胜率</span>
                            <span className={styles.value}>{portfolioResult.winRate.toFixed(2)}%</span>
                            <span className={styles.subValue}>
                                {portfolioResult.winningTrades}胜 / {portfolioResult.losingTrades}负
                            </span>
                        </div>
                        <div className={styles.overviewCard}>
                            <span className={styles.label}>盈亏比</span>
                            <span className={styles.value}>{formatProfitFactor(portfolioResult.profitFactor, portfolioResult.totalTrades)}</span>
                            <span className={styles.subValue}>
                                覆盖币种 {portfolioResult.activeSymbols} 个
                            </span>
                        </div>
                    </div>

                    <div className={styles.chartsSection}>
                        <EquityCurveChart data={portfolioResult.equityCurve} trades={portfolioResult.trades} />
                        <div className={styles.chartsGrid}>
                            <DrawdownChart data={portfolioResult.equityCurve} />
                            <ProfitDistributionChart trades={portfolioResult.trades} />
                            <HoldingTimeChart trades={portfolioResult.trades} />
                        </div>
                    </div>

                    <div className={styles.metricsGrid}>
                        <div className={styles.metric}>
                            <span>平均盈亏</span>
                            <strong className={portfolioResult.averageProfit >= 0 ? styles.positive : styles.negative}>
                                {portfolioResult.averageProfit.toFixed(2)}%
                            </strong>
                        </div>
                        <div className={styles.metric}>
                            <span>平均盈利</span>
                            <strong className={styles.positive}>{portfolioResult.averageWin.toFixed(2)}%</strong>
                        </div>
                        <div className={styles.metric}>
                            <span>平均亏损</span>
                            <strong className={styles.negative}>{portfolioResult.averageLoss.toFixed(2)}%</strong>
                        </div>
                        <div className={styles.metric}>
                            <span>最大盈利</span>
                            <strong className={styles.positive}>{portfolioResult.largestWin.toFixed(2)}%</strong>
                        </div>
                        <div className={styles.metric}>
                            <span>最大亏损</span>
                            <strong className={styles.negative}>{portfolioResult.largestLoss.toFixed(2)}%</strong>
                        </div>
                        <div className={styles.metric}>
                            <span>夏普比率</span>
                            <strong>{portfolioResult.sharpeRatio.toFixed(2)}</strong>
                        </div>
                        <div className={styles.metric}>
                            <span>Sortino比率</span>
                            <strong>{portfolioResult.sortinoRatio.toFixed(2)}</strong>
                        </div>
                        <div className={styles.metric}>
                            <span>Calmar比率</span>
                            <strong>{portfolioResult.calmarRatio.toFixed(2)}</strong>
                        </div>
                        <div className={styles.metric}>
                            <span>恢复因子</span>
                            <strong>{portfolioResult.recoveryFactor.toFixed(2)}</strong>
                        </div>
                        <div className={styles.metric}>
                            <span>平均持仓</span>
                            <strong>{formatDuration(portfolioResult.averageHoldingTime)}</strong>
                        </div>
                        <div className={styles.metric}>
                            <span>最大同时持仓</span>
                            <strong>{portfolioResult.maxConcurrentPositionsUsed}</strong>
                        </div>
                        <div className={styles.metric}>
                            <span>期望值</span>
                            <strong className={portfolioResult.expectancy >= 0 ? styles.positive : styles.negative}>
                                {portfolioResult.expectancy.toFixed(2)}%
                            </strong>
                        </div>
                    </div>

                    <div className={styles.tradesSection}>
                        <div className={styles.paginationBar}>
                            <h4>🧾 组合成交记录</h4>
                            {portfolioPagination && (
                                <div className={styles.paginationInfo}>
                                    第 {portfolioPagination.currentPage} / {portfolioPagination.totalPages} 页，共 {portfolioResult.totalTrades} 笔
                                </div>
                            )}
                        </div>
                        <div className={styles.tableWrapper}>
                            <table className={styles.tradesTable}>
                                <thead>
                                    <tr>
                                        <th>币种</th>
                                        <th>方向</th>
                                        <th>开仓时间</th>
                                        <th>平仓时间</th>
                                        <th>盈亏</th>
                                        <th>收益额</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {portfolioPagination?.visibleTrades.map((trade, idx) => (
                                        <tr key={`${trade.symbol}-${trade.entryTime}-${idx}`}>
                                            <td>{trade.symbol || '-'}</td>
                                            <td>
                                                <span className={trade.direction === 'long' ? styles.long : styles.short}>
                                                    {trade.direction === 'long' ? '做多' : '做空'}
                                                </span>
                                            </td>
                                            <td>{new Date(trade.entryTime).toLocaleString()}</td>
                                            <td>{new Date(trade.exitTime).toLocaleString()}</td>
                                            <td className={trade.profit >= 0 ? styles.positive : styles.negative}>
                                                {formatSignedPercent(trade.profit)}
                                            </td>
                                            <td className={trade.profitUSDT >= 0 ? styles.positive : styles.negative}>
                                                {formatSignedUsdt(trade.profitUSDT)}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                        {portfolioPagination && portfolioPagination.totalPages > 1 && (
                            <div className={styles.paginationControls}>
                                <button
                                    type="button"
                                    className={styles.pageButton}
                                    onClick={() => setPortfolioTradePage((page) => Math.max(1, page - 1))}
                                    disabled={portfolioPagination.currentPage <= 1}
                                >
                                    上一页
                                </button>
                                <button
                                    type="button"
                                    className={styles.pageButton}
                                    onClick={() => setPortfolioTradePage((page) => Math.min(portfolioPagination.totalPages, page + 1))}
                                    disabled={portfolioPagination.currentPage >= portfolioPagination.totalPages}
                                >
                                    下一页
                                </button>
                            </div>
                        )}
                    </div>
                </div>
            )}

            {detailRun && (
                <div className={styles.resultPanel}>
                    <h3>📈 详细结果 · {detailRun.symbol}</h3>

                    <div className={styles.detailHint}>
                        当前展示批量结果中的详细回测。信号周期 {detailRun.result.interval}，执行周期 {detailRun.result.executionInterval}。
                        {detailRun.rangeAdjusted && (
                            <> 实际区间已收缩为 {new Date(detailRun.result.startTime).toLocaleDateString()} - {new Date(detailRun.result.endTime).toLocaleDateString()}：{detailRun.rangeAdjustmentReason}</>
                        )}
                    </div>

                    <div className={styles.diagnosticsPanel}>
                        <div className={styles.diagnosticsHeader}>
                            <div>
                                <div className={styles.diagnosticsTitle}>结果可信度</div>
                                <div className={styles.diagnosticsSummary}>{detailRun.diagnostics.summary}</div>
                            </div>
                            <span className={`${styles.diagnosticBadge} ${styles[`confidence${detailRun.diagnostics.confidence}`]}`}>
                                {detailRun.diagnostics.confidence === 'high' ? '较高' : detailRun.diagnostics.confidence === 'medium' ? '中等' : '偏低'}
                            </span>
                        </div>

                        <div className={styles.diagnosticsGrid}>
                            {detailRun.diagnostics.checks.map((check) => (
                                <div key={check.key} className={styles.diagnosticItem}>
                                    <div className={styles.diagnosticItemHeader}>
                                        <span className={`${styles.diagnosticStatus} ${styles[`status${check.status}`]}`}>
                                            {check.status === 'pass' ? '通过' : check.status === 'warn' ? '注意' : '风险'}
                                        </span>
                                        <span className={styles.diagnosticLabel}>{check.label}</span>
                                    </div>
                                    <div className={styles.diagnosticDetail}>{check.detail}</div>
                                </div>
                            ))}
                        </div>
                    </div>

                    <div className={styles.chartsSection}>
                        <EquityCurveChart data={detailRun.result.equityCurve} trades={detailRun.result.trades} />
                        <div className={styles.chartsGrid}>
                            <DrawdownChart data={detailRun.result.equityCurve} />
                            <ProfitDistributionChart trades={detailRun.result.trades} />
                            <HoldingTimeChart trades={detailRun.result.trades} />
                        </div>
                    </div>

                    <div className={styles.overview}>
                        <div className={styles.overviewCard}>
                            <span className={styles.label}>总收益</span>
                            <span className={`${styles.value} ${detailRun.result.totalProfit >= 0 ? styles.positive : styles.negative}`}>
                                {detailRun.result.totalProfit.toFixed(2)}%
                            </span>
                            <span className={styles.subValue}>
                                {formatSignedUsdt(detailRun.result.totalProfitUSDT)}
                            </span>
                        </div>
                        <div className={styles.overviewCard}>
                            <span className={styles.label}>胜率</span>
                            <span className={styles.value}>{detailRun.result.winRate.toFixed(2)}%</span>
                            <span className={styles.subValue}>
                                {detailRun.result.winningTrades}胜 / {detailRun.result.losingTrades}负
                            </span>
                        </div>
                        <div className={styles.overviewCard}>
                            <span className={styles.label}>最大回撤</span>
                            <span className={`${styles.value} ${styles.negative}`}>
                                {detailRun.result.maxDrawdown.toFixed(2)}%
                            </span>
                        </div>
                        <div className={styles.overviewCard}>
                            <span className={styles.label}>盈亏比</span>
                            <span className={styles.value}>{formatProfitFactor(detailRun.result.profitFactor, detailRun.result.totalTrades)}</span>
                        </div>
                        <div className={styles.overviewCard}>
                            <span className={styles.label}>Sortino比率</span>
                            <span className={styles.value}>{detailRun.result.sortinoRatio.toFixed(2)}</span>
                        </div>
                        <div className={styles.overviewCard}>
                            <span className={styles.label}>执行K线</span>
                            <span className={styles.value}>{detailRun.result.executionInterval}</span>
                            <span className={styles.subValue}>
                                细粒度处理 {detailRun.result.executionBarsProcessed.toLocaleString()} 根
                            </span>
                        </div>
                        <div className={styles.overviewCard}>
                            <span className={styles.label}>Calmar比率</span>
                            <span className={styles.value}>{detailRun.result.calmarRatio.toFixed(2)}</span>
                        </div>
                    </div>

                    <div className={styles.metricsGrid}>
                        <div className={styles.metric}>
                            <span>总交易次数</span>
                            <strong>{detailRun.result.totalTrades}</strong>
                        </div>
                        <div className={styles.metric}>
                            <span>平均盈亏</span>
                            <strong className={detailRun.result.averageProfit >= 0 ? styles.positive : styles.negative}>
                                {detailRun.result.averageProfit.toFixed(2)}%
                            </strong>
                        </div>
                        <div className={styles.metric}>
                            <span>平均盈利</span>
                            <strong className={styles.positive}>{detailRun.result.averageWin.toFixed(2)}%</strong>
                        </div>
                        <div className={styles.metric}>
                            <span>平均亏损</span>
                            <strong className={styles.negative}>{detailRun.result.averageLoss.toFixed(2)}%</strong>
                        </div>
                        <div className={styles.metric}>
                            <span>最大盈利</span>
                            <strong className={styles.positive}>{detailRun.result.largestWin.toFixed(2)}%</strong>
                        </div>
                        <div className={styles.metric}>
                            <span>最大亏损</span>
                            <strong className={styles.negative}>{detailRun.result.largestLoss.toFixed(2)}%</strong>
                        </div>
                        <div className={styles.metric}>
                            <span>夏普比率</span>
                            <strong>{detailRun.result.sharpeRatio.toFixed(2)}</strong>
                        </div>
                        <div className={styles.metric}>
                            <span>平均持仓</span>
                            <strong>{formatDuration(detailRun.result.averageHoldingTime)}</strong>
                        </div>
                        <div className={styles.metric}>
                            <span>期望值</span>
                            <strong className={detailRun.result.expectancy >= 0 ? styles.positive : styles.negative}>
                                {detailRun.result.expectancy.toFixed(2)}%
                            </strong>
                        </div>
                        <div className={styles.metric}>
                            <span>恢复因子</span>
                            <strong>{detailRun.result.recoveryFactor.toFixed(2)}</strong>
                        </div>
                        <div className={styles.metric}>
                            <span>最大连续盈利</span>
                            <strong className={styles.positive}>{detailRun.result.maxConsecutiveWins} 笔</strong>
                        </div>
                        <div className={styles.metric}>
                            <span>最大连续亏损</span>
                            <strong className={styles.negative}>{detailRun.result.maxConsecutiveLosses} 笔</strong>
                        </div>
                    </div>

                    <div className={styles.tradesSection}>
                        <div className={styles.paginationBar}>
                            <h4>📝 交易记录</h4>
                            {detailPagination && (
                                <div className={styles.paginationInfo}>
                                    第 {detailPagination.currentPage} / {detailPagination.totalPages} 页，共 {detailRun.result.totalTrades} 笔
                                </div>
                            )}
                        </div>
                        <div className={styles.tableWrapper}>
                            <table className={styles.tradesTable}>
                                <thead>
                                    <tr>
                                        <th>方向</th>
                                        <th>开仓时间</th>
                                        <th>平仓时间</th>
                                        <th>开仓价</th>
                                        <th>平仓价</th>
                                        <th>盈亏</th>
                                        <th>持仓时间</th>
                                        <th>平仓原因</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {detailPagination?.visibleTrades.map((trade, idx) => (
                                        <tr key={idx}>
                                            <td>
                                                <span className={trade.direction === 'long' ? styles.long : styles.short}>
                                                    {trade.direction === 'long' ? '做多' : '做空'}
                                                </span>
                                            </td>
                                            <td>{new Date(trade.entryTime).toLocaleString()}</td>
                                            <td>{new Date(trade.exitTime).toLocaleString()}</td>
                                            <td>${trade.entryPrice.toFixed(2)}</td>
                                            <td>${trade.exitPrice.toFixed(2)}</td>
                                            <td className={trade.profit >= 0 ? styles.positive : styles.negative}>
                                                {formatSignedPercent(trade.profit)}
                                            </td>
                                            <td>{formatDuration(trade.holdingTime)}</td>
                                            <td>
                                                {trade.exitReason === 'stop_loss' ? '止损' :
                                                    trade.exitReason === 'take_profit' ? '止盈' :
                                                        trade.exitReason === 'signal' ? '反向信号' :
                                                            trade.exitReason === 'time_stop' ? '时间止损' : '结束'}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                        {detailPagination && detailPagination.totalPages > 1 && (
                            <div className={styles.paginationControls}>
                                <button
                                    type="button"
                                    className={styles.pageButton}
                                    onClick={() => setDetailTradePage((page) => Math.max(1, page - 1))}
                                    disabled={detailPagination.currentPage <= 1}
                                >
                                    上一页
                                </button>
                                <button
                                    type="button"
                                    className={styles.pageButton}
                                    onClick={() => setDetailTradePage((page) => Math.min(detailPagination.totalPages, page + 1))}
                                    disabled={detailPagination.currentPage >= detailPagination.totalPages}
                                >
                                    下一页
                                </button>
                            </div>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}
