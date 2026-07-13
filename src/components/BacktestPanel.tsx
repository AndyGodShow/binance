"use client";

import { useEffect, useRef, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import { historicalDataFetcher, HistoricalDataFetcher } from '@/lib/historicalDataFetcher';
import { BacktestEngine, BacktestConfig } from '@/lib/backtestEngine';
import { strategyRegistry } from '@/strategies/registry';
import { TickerData } from '@/lib/types';
import { logger } from '@/lib/logger';
import { calculateDataQuality } from '@/lib/dataQuality';
import { StrategyRiskConfig } from '@/lib/risk/riskConfig';
import { calculateRiskManagement } from '@/lib/risk/riskCalculator';
import { applyRiskConfigOverrides } from '@/lib/risk/overrideRiskManagement';
import { buildHistoricalTickerOverrides } from '@/lib/historicalMultiTimeframe';
import { buildBacktestDiagnostics } from '@/lib/backtestDiagnostics';
import {
    resolveExecutableBacktestRange,
    runBacktestHistoryPreflight,
} from '@/lib/backtestHistoryPreflight';
import { runPortfolioBacktest, PortfolioBacktestResult } from '@/lib/portfolioBacktestEngine';
import { createStrategyRuntimeState } from '@/lib/strategyRuntimeState';
import {
    isWeiShenStrategy,
} from '@/lib/weiShenStrategy';
import { createLatestRunGuard } from '@/lib/backtestValidation';
import {
    validateBacktestSymbols,
    type ExecutionIntervalOption,
    type PresetRange,
    type SymbolIssueDetail,
} from '@/lib/backtestSymbolValidation';
import BacktestResults from './backtest/BacktestResults';
import BacktestControls from './backtest/BacktestControls';
import type { BacktestRunDetail, BacktestTaskResult, BatchBacktestItem } from './backtest/types';
import styles from './BacktestPanel.module.css';
import type {
    DeepPartial,
    StrategyId,
    StrategyParameterConfigMap,
} from '@/lib/strategyParameters';

const DAY_MS = 24 * 60 * 60 * 1000;

const MAX_BACKTEST_CONCURRENCY = 2;

interface BacktestPanelProps {
    strategyParameterOverrides?: DeepPartial<StrategyParameterConfigMap>;
    onStrategyParameterOverridesChange?: Dispatch<SetStateAction<DeepPartial<StrategyParameterConfigMap>>>;
}

import {
    type BacktestSymbolSource,
    buildRiskCalculationParams,
    fetchCoverage,
    getArchiveDateRange,
    getExecutionOptions,
    getTargetSupportedSymbolCount,
    paginateTrades,
    requestHistoricalDataDownload,
    resolveBacktestSymbols,
    resolveStrategyBacktestIntervalsWithOverrides,
    runWithConcurrency,
} from '@/lib/backtestPanelSupport';

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
    const [symbolSource, setSymbolSource] = useState<BacktestSymbolSource>('top');
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
    const runGuardRef = useRef(createLatestRunGuard());

    useEffect(() => () => {
        runGuardRef.current.begin();
    }, []);

    const strategies = strategyRegistry.getAll();
    const executionOptions = getExecutionOptions(interval);
    const selectedStrategyId = selectedStrategy as StrategyId | '';

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
                    { includeAuxiliary: true }
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

        const runToken = runGuardRef.current.begin();
        const isCurrentRun = () => runGuardRef.current.isCurrent(runToken);
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
            const symbols = await resolveBacktestSymbols({
                selectedStrategy,
                symbolSource,
                customSymbols,
                rangeStart,
                rangeEnd,
                topN,
            });
            if (!isCurrentRun()) return;
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
                    if (!isCurrentRun()) return;
                    setDownloadStatus(
                        `🔎 正在检查历史回测可用性：${completed}/${total}，最近完成 ${symbol}` +
                        `，当前可回测 ${supportedCount}` +
                        (skippedCount > 0 ? `，跳过 ${skippedCount}` : '') +
                        '...'
                    );
                },
            });
            if (!isCurrentRun()) return;
            if (supportedSymbols.length === 0) {
                throw new Error('所选币池都无法通过历史数据校验，请缩小范围或改用自定义币种。');
            }

            const targetSupportedCount = getTargetSupportedSymbolCount(symbolSource, topN, symbols.length);
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
                    if (!isCurrentRun()) {
                        return { symbol, error: new Error('回测任务已被新任务替代') };
                    }
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
                        if (!isCurrentRun()) {
                            return { symbol, error: new Error('回测任务已被新任务替代') };
                        }
                        finishedCount += 1;
                        successCount += 1;
                        setDownloadStatus(`⏳ 已完成 ${finishedCount}/${runnableSymbols.length}，成功 ${successCount} 个...`);
                        return { symbol, run };
                    } catch (runError) {
                        if (!isCurrentRun()) {
                            return { symbol, error: new Error('回测任务已被新任务替代') };
                        }
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
            if (!isCurrentRun()) return;
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
            if (!isCurrentRun()) return;
            logger.error('Backtest failed', err as Error);
            setError(err instanceof Error ? err.message : '回测失败');
        } finally {
            if (isCurrentRun()) {
                setLoading(false);
            }
        }
    };


    const portfolioPagination = portfolioResult
        ? paginateTrades(portfolioResult.trades, portfolioTradePage)
        : null;
    const detailPagination = detailRun
        ? paginateTrades(detailRun.result.trades, detailTradePage)
        : null;

    return (
        <div className={styles.container}>
            <BacktestControls
                selection={{
                    detailRun, symbolSource, setSymbolSource, topN, setTopN,
                    rangeStart, setRangeStart, rangeEnd, setRangeEnd,
                    customSymbols, setCustomSymbols,
                }}
                execution={{
                    interval, setInterval, executionInterval, setExecutionInterval,
                    executionOptions, preset, setPreset,
                }}
                strategy={{
                    strategies, selectedStrategy, setSelectedStrategy, selectedStrategyId,
                    strategyParameterOverrides, setStrategyParameterOverrides, setRiskConfig,
                }}
                risk={{
                    initialCapital, setInitialCapital, commission, setCommission,
                    maxConcurrentPositions, setMaxConcurrentPositions,
                    positionSizePercent, setPositionSizePercent,
                }}
                status={{
                    loading, handleBacktest, downloadStatus, resolvedSymbols,
                    executionIntervalsBySymbol, skippedSymbols, skippedDetails, error,
                }}
            />

            <BacktestResults
                batchResults={batchResults}
                failedSymbols={failedSymbols}
                failedDetails={failedDetails}
                detailRun={detailRun}
                allRuns={allRuns}
                setDetailRun={setDetailRun}
                setDetailTradePage={setDetailTradePage}
                portfolioResult={portfolioResult}
                maxConcurrentPositions={maxConcurrentPositions}
                positionSizePercent={positionSizePercent}
                portfolioPagination={portfolioPagination}
                setPortfolioTradePage={setPortfolioTradePage}
                detailPagination={detailPagination}
            />
        </div>
    );
}
