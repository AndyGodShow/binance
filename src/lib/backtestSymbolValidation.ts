import { HistoricalDataFetcher } from './historicalDataFetcher.ts';
import { getRequiredHistoricalIntervals } from './historicalMultiTimeframe.ts';
import { buildExecutionIntervalFallbackCandidates } from './backtestExecutionResolution.ts';
import { buildBacktestValidationStageRequest } from './backtestValidationPlanner.ts';
import { classifyBacktestValidationProbe } from './backtestValidation.ts';
import { isBacktestSymbolCandidate } from './backtestSymbolSelection.ts';
import {
    WEI_SHEN_UNIVERSE,
    filterWeiShenUniverseSymbols,
    getDefaultUniverseForStrategy,
} from './weiShenUniverse.ts';
import { resolveStrategyIntervalsWithOverrides } from './weiShenStrategy.ts';
import type { DeepPartial, StrategyParameterConfigMap } from './strategyParameters.ts';

export type PresetRange = '1d' | '7d' | '30d' | '90d' | '180d' | '1y';
export type ExecutionIntervalOption = 'same' | '1m' | '5m' | '15m';

export interface SymbolIssueDetail {
    symbol: string;
    reason: string;
}

export interface SymbolValidationResult {
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

export interface BacktestValidationStage {
    name: string;
    interval: string;
    startTime: number;
    endTime: number;
    minCount: number;
}

export interface ProbeBacktestValidationResult {
    status: 'passed' | 'failed' | 'deferred';
    reason?: string;
}

interface SymbolValidationSuccess {
    symbol: string;
    ok: true;
    executionInterval: string;
    degraded: boolean;
}

interface SymbolValidationFailure {
    symbol: string;
    ok: false;
    reason: string;
}

type SymbolValidationProbeResult = SymbolValidationSuccess | SymbolValidationFailure;
type Sleep = (milliseconds: number) => Promise<void>;

const SYMBOL_VALIDATION_CONCURRENCY = 2;
const BACKTEST_VALIDATION_LIMIT = 1500;
const DAY_MS = 24 * 60 * 60 * 1000;
const HISTORICAL_LOOKBACK_BUFFER_MS = 35 * DAY_MS;
const EXECUTION_VALIDATION_OFFSET_MS = 50 * 60 * 60 * 1000;
const EXECUTION_VALIDATION_CHUNK_MS = 1200 * 60 * 1000;
const defaultSleep: Sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

function intervalToMs(interval: string): number {
    const match = interval.match(/^(\d+)(m|h|d|w|M)$/);
    if (!match) return 0;
    const value = Number.parseInt(match[1], 10);
    return value * ({ m: 60_000, h: 3_600_000, d: DAY_MS, w: 7 * DAY_MS, M: 30 * DAY_MS }[match[2]] ?? 0);
}

function resolveExecutionInterval(selection: ExecutionIntervalOption, signalInterval: string): string {
    if (selection === 'same') return signalInterval;
    return intervalToMs(selection) <= intervalToMs(signalInterval) ? selection : signalInterval;
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

function estimateStageMinCount(startTime: number, endTime: number, interval: string, fallbackMinimum: number): number {
    const intervalMs = intervalToMs(interval);
    if (!intervalMs) return fallbackMinimum;
    const estimatedBars = Math.max(1, Math.floor((endTime - startTime) / intervalMs));
    return Math.max(fallbackMinimum, Math.min(BACKTEST_VALIDATION_LIMIT, Math.floor(estimatedBars * 0.7)));
}

function buildSignalValidationStages(signalInterval: string, startTime: number, endTime: number): BacktestValidationStage[] {
    const intervalMs = intervalToMs(signalInterval);
    if (!intervalMs) return [];
    const fullRangeBars = Math.max(1, Math.floor((endTime - startTime) / intervalMs));
    if (fullRangeBars <= BACKTEST_VALIDATION_LIMIT) {
        return [{ name: `signal-${signalInterval}`, interval: signalInterval, startTime, endTime, minCount: estimateStageMinCount(startTime, endTime, signalInterval, 24) }];
    }
    const firstStageEnd = Math.min(endTime, startTime + (intervalMs * (BACKTEST_VALIDATION_LIMIT - 1)));
    const lastStageStart = Math.max(startTime, endTime - (intervalMs * (BACKTEST_VALIDATION_LIMIT - 1)));
    return [
        { name: `signal-${signalInterval}-head`, interval: signalInterval, startTime, endTime: firstStageEnd, minCount: Math.max(240, Math.floor(BACKTEST_VALIDATION_LIMIT * 0.8)) },
        { name: `signal-${signalInterval}-tail`, interval: signalInterval, startTime: lastStageStart, endTime, minCount: Math.max(240, Math.floor(BACKTEST_VALIDATION_LIMIT * 0.8)) },
    ];
}

function buildExecutionValidationStages(executionInterval: string, startTime: number, endTime: number): BacktestValidationStage[] {
    const firstStageStart = Math.min(endTime, startTime + EXECUTION_VALIDATION_OFFSET_MS);
    const firstStageEnd = Math.min(endTime, firstStageStart + EXECUTION_VALIDATION_CHUNK_MS);
    const stages = [{ name: `execution-${executionInterval}-1`, interval: executionInterval, startTime: firstStageStart, endTime: firstStageEnd, minCount: estimateStageMinCount(firstStageStart, firstStageEnd, executionInterval, 60) }];
    const secondStageStart = firstStageEnd + 1;
    if (secondStageStart < endTime) {
        const secondStageEnd = Math.min(endTime, secondStageStart + EXECUTION_VALIDATION_CHUNK_MS);
        stages.push({ name: `execution-${executionInterval}-2`, interval: executionInterval, startTime: secondStageStart, endTime: secondStageEnd, minCount: estimateStageMinCount(secondStageStart, secondStageEnd, executionInterval, 60) });
    }
    return stages;
}

interface ValidationStageParams {
    strategyId: string;
    preset: PresetRange;
    signalInterval: string;
    executionSelection: ExecutionIntervalOption;
    executionIntervalOverride?: string;
    parameterOverrides?: DeepPartial<StrategyParameterConfigMap>;
}

function buildBacktestValidationStages(params: ValidationStageParams): BacktestValidationStage[] {
    const base = resolveStrategyBacktestIntervalsWithOverrides(params.strategyId, params.signalInterval, params.executionSelection, params.parameterOverrides);
    const resolved = { ...base, executionInterval: params.executionIntervalOverride ?? base.executionInterval };
    const { startTime, endTime } = HistoricalDataFetcher.getPresetRange(params.preset);
    const stages = buildSignalValidationStages(resolved.signalInterval, startTime, endTime);
    const lookbackStartTime = Math.max(0, startTime - HISTORICAL_LOOKBACK_BUFFER_MS);
    getRequiredHistoricalIntervals(params.strategyId, params.parameterOverrides)
        .filter((interval) => interval !== resolved.signalInterval)
        .forEach((interval) => stages.push({
            name: `mtf-${interval}`,
            interval,
            startTime: lookbackStartTime,
            endTime,
            minCount: interval === '5m' ? 120 : interval === '1d' ? 21 : 8,
        }));
    if (resolved.executionInterval !== resolved.signalInterval) {
        stages.push(...buildExecutionValidationStages(resolved.executionInterval, startTime, endTime));
    }
    return stages;
}

function isRetryableValidationStatus(status: number): boolean {
    return status === 408 || status === 429 || status >= 500;
}

export async function probeBacktestValidationStage(
    symbol: string,
    stage: BacktestValidationStage,
    dependencies: { fetchImpl?: typeof fetch; sleep?: Sleep } = {},
): Promise<ProbeBacktestValidationResult> {
    const fetchImpl = dependencies.fetchImpl ?? fetch;
    const sleep = dependencies.sleep ?? defaultSleep;
    for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
            const url = buildBacktestValidationStageRequest({ symbol, interval: stage.interval, startTime: stage.startTime, endTime: stage.endTime }).url;
            const response = await fetchImpl(url);
            const payload = await response.json().catch(() => null);
            if (response.ok && stage.name.startsWith('mtf-')) return { status: 'passed' };
            const classification = classifyBacktestValidationProbe({ kind: 'response', httpStatus: response.status, ok: response.ok, payload });
            if (classification.status !== 'failed') return classification;
            if (response.ok) return { status: 'failed', reason: `${stage.name} ${classification.reason ?? '校验未通过'}` };
            if (!isRetryableValidationStatus(response.status) || attempt === 2) {
                const payloadMessage = typeof payload?.error === 'string' ? payload.error : typeof payload?.details === 'string' ? payload.details : `HTTP ${response.status}`;
                return { status: 'failed', reason: `${stage.name} 请求失败：${payloadMessage}` };
            }
        } catch {
            if (attempt === 2) return classifyBacktestValidationProbe({ kind: 'network-error', reason: `${stage.name} 网络校验延后到实际回测` });
        }
        await sleep(250 * (attempt + 1));
    }
    return { status: 'failed', reason: `${stage.name} 校验未通过` };
}

export interface ValidateBacktestSymbolsOptions extends ValidationStageParams {
    onProgress?: (progress: SymbolValidationProgress) => void;
    concurrency?: number;
    executionIntervalCandidates?: string[];
    buildStages?: (params: ValidationStageParams) => BacktestValidationStage[];
    probeStage?: (symbol: string, stage: BacktestValidationStage) => Promise<ProbeBacktestValidationResult>;
    sleep?: Sleep;
}

async function runWithConcurrency<T, R>(items: T[], concurrency: number, worker: (item: T) => Promise<R>): Promise<R[]> {
    if (items.length === 0) return [];
    const results: R[] = new Array(items.length);
    let nextIndex = 0;
    const runWorker = async () => {
        while (nextIndex < items.length) {
            const currentIndex = nextIndex++;
            results[currentIndex] = await worker(items[currentIndex]);
        }
    };
    await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => runWorker()));
    return results;
}

export async function validateBacktestSymbols(symbols: string[], options: ValidateBacktestSymbolsOptions): Promise<SymbolValidationResult> {
    const normalizedSymbols = Array.from(new Set(symbols.map((symbol) => symbol.trim().toUpperCase()))).filter(Boolean).filter(isBacktestSymbolCandidate);
    const strategyUniverse = getDefaultUniverseForStrategy(options.strategyId);
    const uniqueCandidates = strategyUniverse ? filterWeiShenUniverseSymbols(normalizedSymbols) : normalizedSymbols;
    const invalidSymbols = symbols.map((symbol) => symbol.trim().toUpperCase()).filter((symbol) => symbol && (!isBacktestSymbolCandidate(symbol) || (strategyUniverse ? !WEI_SHEN_UNIVERSE.includes(symbol as (typeof WEI_SHEN_UNIVERSE)[number]) : false)));
    const invalidDetails = invalidSymbols.map((symbol) => ({ symbol, reason: strategyUniverse && !WEI_SHEN_UNIVERSE.includes(symbol as (typeof WEI_SHEN_UNIVERSE)[number]) ? '不在该策略允许的币池内' : '币种格式不符合 U 本位回测要求' }));
    const resolved = resolveStrategyBacktestIntervalsWithOverrides(options.strategyId, options.signalInterval, options.executionSelection, options.parameterOverrides);
    const candidates = options.executionIntervalCandidates ?? buildExecutionIntervalFallbackCandidates({ preferredExecutionInterval: resolved.executionInterval, signalInterval: resolved.signalInterval });
    const buildStages = options.buildStages ?? buildBacktestValidationStages;
    const probeStage = options.probeStage ?? probeBacktestValidationStage;
    const sleep = options.sleep ?? defaultSleep;
    let completedCount = 0;
    let supportedCount = 0;
    let skippedCount = 0;
    const probeResults = await runWithConcurrency<string, SymbolValidationProbeResult>(uniqueCandidates, options.concurrency ?? SYMBOL_VALIDATION_CONCURRENCY, async (symbol) => {
        let lastFailureReason = '';
        for (const executionIntervalOverride of candidates) {
            let candidatePassed = true;
            for (const validationStage of buildStages({ ...options, executionIntervalOverride })) {
                const probe = await probeStage(symbol, validationStage);
                if (probe.status === 'failed') {
                    candidatePassed = false;
                    lastFailureReason = probe.reason || `${validationStage.name} 校验未通过`;
                    break;
                }
                await sleep(80);
            }
            if (candidatePassed) {
                completedCount += 1;
                supportedCount += 1;
                options.onProgress?.({ symbol, completed: completedCount, total: uniqueCandidates.length, supportedCount, skippedCount });
                return { symbol, ok: true, executionInterval: executionIntervalOverride, degraded: executionIntervalOverride !== candidates[0] };
            }
        }
        completedCount += 1;
        skippedCount += 1;
        options.onProgress?.({ symbol, completed: completedCount, total: uniqueCandidates.length, supportedCount, skippedCount });
        return { symbol, ok: false, reason: lastFailureReason || '历史数据校验未通过' };
    });
    const supportedSymbols = probeResults.filter((result) => result.ok).map((result) => result.symbol);
    const skippedSymbols = [...invalidSymbols, ...probeResults.filter((result) => !result.ok).map((result) => result.symbol)];
    const skippedDetails = [...invalidDetails, ...probeResults.filter((result) => !result.ok).map((result) => ({ symbol: result.symbol, reason: result.reason || '历史数据校验未通过' }))];
    const executionIntervalsBySymbol = Object.fromEntries(probeResults.filter((result): result is SymbolValidationSuccess => result.ok).map((result) => [result.symbol, result.executionInterval]));
    return { supportedSymbols, skippedSymbols, skippedDetails, executionIntervalsBySymbol };
}
