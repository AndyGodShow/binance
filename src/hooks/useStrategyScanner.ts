"use client";

import { useState, useEffect, useMemo, useRef } from 'react';
import { TickerData } from '@/lib/types';
import { StrategySignal, StrategySignalStatus } from '@/lib/strategyTypes';
import { APP_CONFIG } from '@/lib/config';
import { strategyRegistry } from '@/strategies/registry';
import {
    buildStrategyScannerTickerDigest,
    selectScannerSignalForSymbol,
} from '@/lib/strategyScannerSnapshot';
import { singletonStrategyRuntimeState } from '@/lib/strategyRuntimeState';
import { evaluateSentimentHotspotExitMonitor } from '@/lib/sentimentHotspot';
import { createDismissedSignalKey } from '@/lib/strategySignalKeys';
import { detectVisibleStrategySignalsForTicker } from '@/lib/strategyScannerCore';
import { buildStrategyInputReadinessSummary } from '@/lib/strategyInputs';
import { getStrategyParameterConfig } from '@/lib/strategyParameters';
import type { DeepPartial, StrategyParameterConfigMap } from '@/lib/strategyParameters';
import type { StrategyId } from '@/lib/strategyParameters';
import type { StrategyInputReadinessSummary } from '@/lib/strategyInputs';

const MAX_SIGNAL_COUNT = APP_CONFIG.UI.MAX_ACTIVE_SIGNALS;
const DISMISSED_SIGNALS_STORAGE_KEY = 'dismissedSignals';
const STORED_SIGNALS_STORAGE_KEY = 'strategySignals';
const STRONG_BREAKOUT_ID = 'strong-breakout';
const SENTIMENT_HOTSPOT_ID = 'sentiment-hotspot';

type DismissedSignalMap = Record<string, number>;

interface UseStrategyScannerOptions {
    parameterOverrides?: DeepPartial<StrategyParameterConfigMap>;
}

export interface StrategyScanDiagnostics {
    totalCandidates: number;
    rescannedSymbols: number;
    digestSkippedSymbols: number;
    cooldownBlockedSignals: number;
    confidenceFilteredSignals: number;
    missingInputStrategyCount: number;
    lastScannedAt: number | null;
}

const STATUS_PRIORITY: Record<StrategySignalStatus, number> = {
    active: 2,
    snapshot: 1,
    cooling: 0,
};

function normalizeStoredSignal(signal: StrategySignal): StrategySignal {
    return {
        ...signal,
        status: signal.status === 'cooling' ? 'cooling' : 'snapshot',
    };
}

function compareSignals(a: StrategySignal, b: StrategySignal) {
    const aStatus = a.status ?? 'active';
    const bStatus = b.status ?? 'active';
    const statusDelta = STATUS_PRIORITY[bStatus] - STATUS_PRIORITY[aStatus];
    if (statusDelta !== 0) {
        return statusDelta;
    }
    return b.timestamp - a.timestamp;
}

function createEmptyScanDiagnostics(): StrategyScanDiagnostics {
    return {
        totalCandidates: 0,
        rescannedSymbols: 0,
        digestSkippedSymbols: 0,
        cooldownBlockedSignals: 0,
        confidenceFilteredSignals: 0,
        missingInputStrategyCount: 0,
        lastScannedAt: null,
    };
}

function stableStringify(value: unknown): string {
    if (value === null || typeof value !== 'object') {
        return JSON.stringify(value);
    }

    if (Array.isArray(value)) {
        return `[${value.map(stableStringify).join(',')}]`;
    }

    return `{${Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, entryValue]) => `${JSON.stringify(key)}:${stableStringify(entryValue)}`)
        .join(',')}}`;
}

function getSignalStrategyIds(signal: StrategySignal): string[] {
    const ids = new Set<string>([signal.strategyId]);
    signal.stackedSignalDetails?.forEach((detail) => ids.add(detail.strategyId));
    return Array.from(ids);
}

function getCooldownPeriodMs(
    strategyId: string,
    parameterOverrides?: DeepPartial<StrategyParameterConfigMap>,
): number | null {
    if (
        strategyId === 'strong-breakout' ||
        strategyId === 'trend-confirmation' ||
        strategyId === 'capital-inflow' ||
        strategyId === 'rsrs-trend' ||
        strategyId === 'volatility-squeeze'
    ) {
        return getStrategyParameterConfig(strategyId, parameterOverrides?.[strategyId]).cooldownPeriodMs;
    }

    if (strategyId === SENTIMENT_HOTSPOT_ID) {
        return getStrategyParameterConfig(SENTIMENT_HOTSPOT_ID, parameterOverrides?.[SENTIMENT_HOTSPOT_ID]).cooldownMs;
    }

    return null;
}

function isSignalInCooldown(
    signal: StrategySignal,
    parameterOverrides?: DeepPartial<StrategyParameterConfigMap>,
): boolean {
    return getSignalStrategyIds(signal).some((strategyId) => {
        const period = getCooldownPeriodMs(strategyId, parameterOverrides);
        return period !== null && singletonStrategyRuntimeState.cooldown.check(signal.symbol, strategyId, period);
    });
}

function recordSignalCooldown(
    signal: StrategySignal,
    parameterOverrides?: DeepPartial<StrategyParameterConfigMap>,
) {
    getSignalStrategyIds(signal).forEach((strategyId) => {
        const period = getCooldownPeriodMs(strategyId, parameterOverrides);
        if (period !== null) {
            singletonStrategyRuntimeState.cooldown.record(signal.symbol, strategyId);
        }
    });
}

function hasStrongBreakoutReset(ticker: TickerData): boolean {
    const breakoutHigh = ticker.breakout21dHigh;
    const currentPrice = parseFloat(ticker.lastPrice);

    return typeof breakoutHigh === 'number'
        && Number.isFinite(breakoutHigh)
        && Number.isFinite(currentPrice)
        && currentPrice <= breakoutHigh;
}

function calculatePercentChange(current: number, base: number): number {
    return Number.isFinite(current) && Number.isFinite(base) && base > 0
        ? ((current - base) / base) * 100
        : 0;
}

function applySentimentHotspotExitMonitor(
    existing: StrategySignal,
    ticker: TickerData,
    now: number,
): StrategySignal {
    if (existing.strategyId !== SENTIMENT_HOTSPOT_ID) {
        return existing;
    }

    const hotspot = ticker.strategyContexts?.sentimentHotspot;
    const currentPrice = parseFloat(ticker.lastPrice || '0');
    const signalPrice = existing.price ?? 0;
    const priceChangeSinceSignalPct = calculatePercentChange(currentPrice, signalPrice);
    const launchZoneLow = hotspot?.entry?.launchZoneLow ?? existing.metrics.launchZoneLow;
    const oiChangePct = hotspot?.oiChangePct ?? existing.metrics.oiChangePct ?? 0;
    const oiRising = hotspot?.oiRising ?? false;
    const fundingRatePct = hotspot?.fundingRatePct ?? (parseFloat(ticker.fundingRate || '0') * 100);
    const volumeSurgeRatio = hotspot?.volumeSurgeRatio ?? existing.metrics.volumeSurgeRatio ?? 0;

    const monitor = evaluateSentimentHotspotExitMonitor({
        currentPrice,
        launchZoneLow,
        oiChangePct,
        oiRising,
        fundingRatePct,
        volumeSurgeRatio,
        priceChangeSinceSignalPct,
        elapsedMs: now - existing.timestamp,
    });

    if (monitor.level === 'hold') {
        return existing;
    }

    const exitText = monitor.level === 'exit' ? '退出监控' : '风险预警';
    return {
        ...existing,
        reason: `${existing.reason} | ${exitText}: ${monitor.reasons.join('；')}`,
        metrics: {
            ...existing.metrics,
            exitMonitorLevel: monitor.level === 'exit' ? 2 : 1,
            exitReasonCount: monitor.reasons.length,
            priceChangeSinceSignalPct,
            currentPrice,
            currentOiChangePct: oiChangePct,
            currentFundingRatePct: fundingRatePct,
            currentVolumeSurgeRatio: volumeSurgeRatio,
        },
    };
}

function loadDismissedSignals(): DismissedSignalMap {
    if (typeof window === 'undefined') {
        return {};
    }

    const saved = localStorage.getItem(DISMISSED_SIGNALS_STORAGE_KEY);
    if (!saved) {
        return {};
    }

    try {
        const parsed = JSON.parse(saved);
        if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') {
            return {};
        }

        const next: DismissedSignalMap = {};
        Object.entries(parsed).forEach(([symbol, value]) => {
            if (typeof value === 'number' && Number.isFinite(value)) {
                next[symbol] = value;
            }
        });
        return next;
    } catch (err) {
        console.error('Failed to load dismissed signals:', err);
        return {};
    }
}

function persistDismissedSignals(value: DismissedSignalMap) {
    if (typeof window === 'undefined') {
        return;
    }

    try {
        localStorage.setItem(DISMISSED_SIGNALS_STORAGE_KEY, JSON.stringify(value));
    } catch (e) {
        console.warn('Failed to persist dismissed signals:', e);
    }
}

function loadStoredSignals(): StrategySignal[] {
    if (typeof window === 'undefined') {
        return [];
    }

    const saved = localStorage.getItem(STORED_SIGNALS_STORAGE_KEY);
    if (!saved) {
        return [];
    }

    try {
        const parsed = JSON.parse(saved);
        if (!Array.isArray(parsed)) {
            return [];
        }

        return parsed
            .filter((item): item is StrategySignal => {
                return Boolean(
                    item &&
                    typeof item === 'object' &&
                    typeof item.symbol === 'string' &&
                    typeof item.strategyId === 'string' &&
                    typeof item.strategyName === 'string' &&
                    (item.direction === 'long' || item.direction === 'short') &&
                    typeof item.confidence === 'number' &&
                    typeof item.reason === 'string' &&
                    item.metrics &&
                    typeof item.metrics === 'object' &&
                    typeof item.timestamp === 'number'
                );
            })
            .map(normalizeStoredSignal)
            .sort(compareSignals)
            .slice(0, MAX_SIGNAL_COUNT);
    } catch (err) {
        console.error('Failed to load stored strategy signals:', err);
        return [];
    }
}

function persistSignals(value: StrategySignal[]) {
    if (typeof window === 'undefined') {
        return;
    }

    try {
        localStorage.setItem(STORED_SIGNALS_STORAGE_KEY, JSON.stringify(value));
    } catch (e) {
        console.warn('Failed to persist strategy signals:', e);
    }
}

export function useStrategyScanner(data: TickerData[], options: UseStrategyScannerOptions = {}) {
    const [signals, setSignals] = useState<StrategySignal[]>([]);
    const signalsRef = useRef<StrategySignal[]>([]);
    const breakoutResetRef = useRef<Map<string, boolean>>(new Map());

    // 保存上一次的数据摘要，用于检测变化
    const prevDataDigest = useRef<Map<string, string>>(new Map());
    const prevStrategyVersion = useRef(0);
    const prevParameterDigest = useRef('');
    const prevReadinessDigest = useRef('');

    const dismissedSignalsRef = useRef<DismissedSignalMap>({});
    const [strategyVersion, setStrategyVersion] = useState(0);
    const [isHydrated, setIsHydrated] = useState(false);
    const [readinessSummary, setReadinessSummary] = useState<StrategyInputReadinessSummary | null>(null);
    const [scanDiagnostics, setScanDiagnostics] = useState<StrategyScanDiagnostics>(() => createEmptyScanDiagnostics());
    const hasCompletedInitialScan = useRef(false);

    // 在客户端加载后从 localStorage 读取
    useEffect(() => {
        const parsed = loadDismissedSignals();
        const storedSignals = loadStoredSignals();
        dismissedSignalsRef.current = parsed;
        signalsRef.current = storedSignals;
        // 首次挂载时恢复本地缓存，避免把老信号当成新信号。
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setSignals(storedSignals);
        setIsHydrated(true);
    }, []);

    useEffect(() => {
        return strategyRegistry.subscribe(() => {
            setStrategyVersion((prev) => prev + 1);
        });
    }, []);

    useEffect(() => {
        signalsRef.current = signals;
    }, [signals]);

    const lastScanTime = useRef<{ time: number, timeout: NodeJS.Timeout | null }>({ time: 0, timeout: null });

    // 扫描并生成信号
    useEffect(() => {
        if (!isHydrated || !data || data.length === 0) return;

        const performScan = () => {
            const now = Date.now();
            lastScanTime.current.time = now;
            const enabledStrategies = strategyRegistry.getEnabled();
            const enabledStrategyIds = enabledStrategies.map((strategy) => strategy.id)
                .filter((strategyId): strategyId is StrategyId => (
                    strategyId === 'strong-breakout' ||
                    strategyId === 'trend-confirmation' ||
                    strategyId === 'capital-inflow' ||
                    strategyId === 'rsrs-trend' ||
                    strategyId === 'volatility-squeeze' ||
                    strategyId === 'wei-shen-ledger' ||
                    strategyId === 'sentiment-hotspot'
                ));
            const readinessSummary = buildStrategyInputReadinessSummary(data, enabledStrategyIds);
            const readinessDigest = JSON.stringify(readinessSummary.byStrategy);
            const hasMissingInputs = Object.values(readinessSummary.byStrategy)
                .some((entry) => entry.symbolsMissingRequiredFields > 0);
            if (hasMissingInputs && readinessDigest !== prevReadinessDigest.current) {
                console.warn('[strategy-scanner] input readiness degraded', readinessSummary);
                prevReadinessDigest.current = readinessDigest;
            }
            if (!hasMissingInputs && prevReadinessDigest.current) {
                prevReadinessDigest.current = '';
            }
            setReadinessSummary(readinessSummary);
            const parameterOverrides = options.parameterOverrides;
            const parameterDigest = stableStringify(parameterOverrides || {});
            const forceRescan =
                prevStrategyVersion.current !== strategyVersion ||
                prevParameterDigest.current !== parameterDigest;
            const isInitialScan = !hasCompletedInitialScan.current;
            let rescannedSymbols = 0;
            let digestSkippedSymbols = 0;
            let confidenceFilteredSignals = 0;
            let cooldownBlockedSignals = 0;

            const existingSignalsMap = new Map<string, StrategySignal>();
            signalsRef.current.forEach((sig) => {
                existingSignalsMap.set(sig.symbol, sig);
            });

            const currentDataDigest = new Map<string, string>();
            const scanResults = new Map<string, StrategySignal | null>();

            data.forEach(ticker => {
                const digest = buildStrategyScannerTickerDigest(ticker);

            currentDataDigest.set(ticker.symbol, digest);

            const prevDigest = prevDataDigest.current.get(ticker.symbol);
            if (!forceRescan && prevDigest === digest) {
                digestSkippedSymbols += 1;
                return;
            }
            rescannedSymbols += 1;

            const symbolSignals = detectVisibleStrategySignalsForTicker({
                ticker,
                strategies: enabledStrategies,
                now,
                runtimeState: singletonStrategyRuntimeState,
                minConfidence: APP_CONFIG.STRATEGY.MIN_CONFIDENCE,
                parameterOverrides,
                onSignalFiltered: () => {
                    confidenceFilteredSignals += 1;
                },
            });

            scanResults.set(ticker.symbol, selectScannerSignalForSymbol(symbolSignals));
        });

        prevDataDigest.current = currentDataDigest;
        prevStrategyVersion.current = strategyVersion;
        prevParameterDigest.current = parameterDigest;

        const updatedSignals: StrategySignal[] = [];
        data.forEach((ticker) => {
            const symbol = ticker.symbol;
            const scanResult = scanResults.get(symbol);
            const existing = existingSignalsMap.get(symbol);
            const existingDismissedAt = existing
                ? dismissedSignalsRef.current[createDismissedSignalKey(existing)]
                : undefined;
            const breakoutReset = hasStrongBreakoutReset(ticker);

            if (breakoutReset) {
                breakoutResetRef.current.set(symbol, true);
            }

            if (scanResult === undefined) {
                if (!existing || existingDismissedAt === existing.timestamp) {
                    return;
                }

                updatedSignals.push(existing);
                return;
            }

            if (scanResult) {
                if (isSignalInCooldown(scanResult, parameterOverrides)) {
                    cooldownBlockedSignals += 1;
                }
                const existingStatus = existing?.status ?? 'active';
                const nextStatus: StrategySignalStatus = isInitialScan && existingStatus !== 'cooling'
                    ? 'snapshot'
                    : existing
                        ? (existingStatus === 'cooling' ? (isInitialScan ? 'snapshot' : 'active') : existingStatus)
                        : (isInitialScan ? 'snapshot' : 'active');
                const canRefreshStrongBreakout =
                    scanResult.strategyId === STRONG_BREAKOUT_ID &&
                    breakoutResetRef.current.get(symbol) === true;
                const nextTimestamp =
                    existing?.status === 'cooling'
                        ? (
                            scanResult.strategyId === STRONG_BREAKOUT_ID
                                ? (canRefreshStrongBreakout ? scanResult.timestamp : existing.timestamp)
                                : scanResult.timestamp
                        )
                        : (existing?.timestamp ?? scanResult.timestamp);
                const nextSignal = existing
                    ? {
                        ...scanResult,
                        status: nextStatus,
                        timestamp: nextTimestamp,
                    }
                    : {
                        ...scanResult,
                        status: nextStatus,
                    };

                if (scanResult.strategyId === STRONG_BREAKOUT_ID) {
                    breakoutResetRef.current.set(symbol, false);
                }

                if (
                    !existing ||
                    existing.status === 'cooling' ||
                    existing.strategyId !== nextSignal.strategyId
                ) {
                    recordSignalCooldown(nextSignal, parameterOverrides);
                }

                const nextDismissedAt = dismissedSignalsRef.current[createDismissedSignalKey(nextSignal)];
                if (nextDismissedAt === nextSignal.timestamp) {
                    return;
                }

                updatedSignals.push(nextSignal);
                return;
            }

            if (!existing) {
                return;
            }

            if (existingDismissedAt === existing.timestamp) {
                return;
            }

            const monitoredExisting = applySentimentHotspotExitMonitor(existing, ticker, now);
            updatedSignals.push({
                ...monitoredExisting,
                status: 'cooling',
            });
        });

        const nextSignals = updatedSignals
            .sort(compareSignals)
            .slice(0, MAX_SIGNAL_COUNT);

        signalsRef.current = nextSignals;
        setSignals(nextSignals);
        setScanDiagnostics({
            totalCandidates: data.length,
            rescannedSymbols,
            digestSkippedSymbols,
            cooldownBlockedSignals,
            confidenceFilteredSignals,
            missingInputStrategyCount: Object.values(readinessSummary.byStrategy)
                .filter((entry) => entry.symbolsMissingRequiredFields > 0)
                .length,
            lastScannedAt: now,
        });
        hasCompletedInitialScan.current = true;
        };

        const now = Date.now();
        const timeSinceLastScan = now - lastScanTime.current.time;

        if (timeSinceLastScan >= 1000) {
            if (lastScanTime.current.timeout) clearTimeout(lastScanTime.current.timeout);
            performScan();
        } else {
            if (lastScanTime.current.timeout) clearTimeout(lastScanTime.current.timeout);
            lastScanTime.current.timeout = setTimeout(() => {
                performScan();
            }, 1000 - timeSinceLastScan);
        }

    }, [data, isHydrated, strategyVersion, options.parameterOverrides]);

    useEffect(() => {
        if (!isHydrated) {
            return;
        }

        persistSignals(signals);
    }, [isHydrated, signals]);

    // 按状态和时间排序后的信号列表（实时触发 > 打开时已满足 > 回落保留）
    const sortedSignals = useMemo(() => {
        return [...signals].sort(compareSignals);
    }, [signals]);



    const dismissSignal = (signal: StrategySignal) => {
        const nextDismissedSignals = {
            ...dismissedSignalsRef.current,
            [createDismissedSignalKey(signal)]: signal.timestamp,
        };
        dismissedSignalsRef.current = nextDismissedSignals;
        persistDismissedSignals(nextDismissedSignals);
        setSignals(prev => {
            const nextSignals = prev.filter(s => !(s.symbol === signal.symbol && s.timestamp === signal.timestamp));
            signalsRef.current = nextSignals;
            return nextSignals;
        });
    };

    const clearAll = () => {
        signalsRef.current = [];
        breakoutResetRef.current.clear();
        setSignals([]);
        setScanDiagnostics(createEmptyScanDiagnostics());
        dismissedSignalsRef.current = {};
        hasCompletedInitialScan.current = false;
        localStorage.removeItem(DISMISSED_SIGNALS_STORAGE_KEY);
        localStorage.removeItem(STORED_SIGNALS_STORAGE_KEY);
    };

    return {
        signals: sortedSignals,
        readinessSummary,
        scanDiagnostics,
        dismissSignal,
        clearAll,
    };
}
