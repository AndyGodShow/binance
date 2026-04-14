"use client";

import { useState, useEffect, useMemo, useRef } from 'react';
import { TickerData } from '@/lib/types';
import { StrategySignal, StrategySignalStatus } from '@/lib/strategyTypes';
import { APP_CONFIG } from '@/lib/config';
import { strategyRegistry } from '@/strategies/registry';

const MAX_SIGNAL_COUNT = APP_CONFIG.UI.MAX_ACTIVE_SIGNALS;
const DISMISSED_SIGNALS_STORAGE_KEY = 'dismissedSignals';
const STORED_SIGNALS_STORAGE_KEY = 'strategySignals';
const STRONG_BREAKOUT_ID = 'strong-breakout';

type DismissedSignalMap = Record<string, number>;


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

function hasStrongBreakoutReset(ticker: TickerData): boolean {
    const breakoutHigh = ticker.breakout21dHigh;
    const currentPrice = parseFloat(ticker.lastPrice);

    return typeof breakoutHigh === 'number'
        && Number.isFinite(breakoutHigh)
        && Number.isFinite(currentPrice)
        && currentPrice <= breakoutHigh;
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

export function useStrategyScanner(data: TickerData[]) {
    const [signals, setSignals] = useState<StrategySignal[]>([]);
    const signalsRef = useRef<StrategySignal[]>([]);
    const breakoutResetRef = useRef<Map<string, boolean>>(new Map());

    // 保存上一次的数据摘要，用于检测变化
    const prevDataDigest = useRef<Map<string, string>>(new Map());
    const prevStrategyVersion = useRef(0);

    const dismissedSignalsRef = useRef<DismissedSignalMap>({});
    const [strategyVersion, setStrategyVersion] = useState(0);
    const [isHydrated, setIsHydrated] = useState(false);
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
        const forceRescan = prevStrategyVersion.current !== strategyVersion;
        const isInitialScan = !hasCompletedInitialScan.current;

        const existingSignalsMap = new Map<string, StrategySignal>();
        signalsRef.current.forEach((sig) => {
            existingSignalsMap.set(sig.symbol, sig);
        });

        const currentDataDigest = new Map<string, string>();
        const scanResults = new Map<string, StrategySignal | null>();

        data.forEach(ticker => {
            const digest = JSON.stringify({
                lastPrice: ticker.lastPrice,
                priceChangePercent: ticker.priceChangePercent,
                change15m: ticker.change15m,
                change1h: ticker.change1h,
                change4h: ticker.change4h,
                breakout21dHigh: ticker.breakout21dHigh,
                breakout21dPercent: ticker.breakout21dPercent,
                ema5m20: ticker.ema5m20,
                ema5m60: ticker.ema5m60,
                ema5m100: ticker.ema5m100,
                ema5mDistancePercent: ticker.ema5mDistancePercent,
                gmmaTrend: ticker.gmmaTrend,
                gmmaShortScore: ticker.gmmaShortScore,
                gmmaLongScore: ticker.gmmaLongScore,
                gmmaSeparationPercent: ticker.gmmaSeparationPercent,
                multiEmaTrend: ticker.multiEmaTrend,
                multiEmaAlignmentScore: ticker.multiEmaAlignmentScore,
                quoteVolume: ticker.quoteVolume,
                openInterest: ticker.openInterest,
                openInterestValue: ticker.openInterestValue,
                oiChangePercent: ticker.oiChangePercent,
                fundingRate: ticker.fundingRate,
                rsrs: ticker.rsrs,
                rsrsZScore: ticker.rsrsZScore,
                rsrsFinal: ticker.rsrsFinal,
                rsrsR2: ticker.rsrsR2,
                rsrsROC: ticker.rsrsROC,
                rsrsAcceleration: ticker.rsrsAcceleration,
                rsrsDynamicLongThreshold: ticker.rsrsDynamicLongThreshold,
                rsrsDynamicShortThreshold: ticker.rsrsDynamicShortThreshold,
                atr: ticker.atr,
                volumeMA: ticker.volumeMA,
                volumeRatio: ticker.volumeRatio,
                betaToBTC: ticker.betaToBTC,
                correlationToBTC: ticker.correlationToBTC,
                cvd: ticker.cvd,
                cvdSlope: ticker.cvdSlope,
                vah: ticker.vah,
                val: ticker.val,
                poc: ticker.poc,
                bollingerUpper: ticker.bollingerUpper,
                bollingerLower: ticker.bollingerLower,
                keltnerUpper: ticker.keltnerUpper,
                keltnerMid: ticker.keltnerMid,
                keltnerLower: ticker.keltnerLower,
                squeezeStatus: ticker.squeezeStatus,
                prevSqueezeStatus: ticker.prevSqueezeStatus,
                squeezeDuration: ticker.squeezeDuration,
                lastSqueezeDuration: ticker.lastSqueezeDuration,
                squeezeStrength: ticker.squeezeStrength,
                releaseBarsAgo: ticker.releaseBarsAgo,
                squeezeBoxHigh: ticker.squeezeBoxHigh,
                squeezeBoxLow: ticker.squeezeBoxLow,
                momentumValue: ticker.momentumValue,
                momentumColor: ticker.momentumColor,
                adx: ticker.adx,
                bandwidthPercentile: ticker.bandwidthPercentile,
            });

            currentDataDigest.set(ticker.symbol, digest);

            const prevDigest = prevDataDigest.current.get(ticker.symbol);
            if (!forceRescan && prevDigest === digest) {
                return;
            }

            const symbolSignals: StrategySignal[] = [];
            enabledStrategies.forEach(strategy => {
                const signal = strategy.detect(ticker);
                if (signal) {
                    if (signal.confidence < APP_CONFIG.STRATEGY.MIN_CONFIDENCE) return;
                    signal.price = parseFloat(ticker.lastPrice);
                    symbolSignals.push({
                        ...signal,
                        status: 'active',
                        lastSeenAt: now,
                    });
                }
            });

            if (symbolSignals.length > 0) {
                const stackCount = symbolSignals.length;
                let comboBonus = 0;

                if (stackCount >= 3) {
                    comboBonus = 20;
                } else if (stackCount >= 2) {
                    comboBonus = 10;
                }

                const mainSignal = symbolSignals.reduce((max, signal) =>
                    signal.confidence > max.confidence ? signal : max
                );

                scanResults.set(ticker.symbol, {
                    ...mainSignal,
                    confidence: mainSignal.confidence + comboBonus,
                    stackCount,
                    stackedStrategies: symbolSignals.map(signal => signal.strategyName),
                    comboBonus,
                });
            } else {
                scanResults.set(ticker.symbol, null);
            }
        });

        prevDataDigest.current = currentDataDigest;
        prevStrategyVersion.current = strategyVersion;

        const updatedSignals: StrategySignal[] = [];
        data.forEach((ticker) => {
            const symbol = ticker.symbol;
            const scanResult = scanResults.get(symbol);
            const existing = existingSignalsMap.get(symbol);
            const dismissedAt = dismissedSignalsRef.current[symbol];
            const breakoutReset = hasStrongBreakoutReset(ticker);

            if (breakoutReset) {
                breakoutResetRef.current.set(symbol, true);
            }

            if (scanResult === undefined) {
                if (!existing || dismissedAt === existing.timestamp) {
                    return;
                }

                updatedSignals.push(existing);
                return;
            }

            if (scanResult) {
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

                if (dismissedAt === nextSignal.timestamp) {
                    return;
                }

                updatedSignals.push(nextSignal);
                return;
            }

            if (!existing) {
                return;
            }

            if (dismissedAt === existing.timestamp) {
                return;
            }

            updatedSignals.push({
                ...existing,
                status: 'cooling',
            });
        });

        const nextSignals = updatedSignals
            .sort(compareSignals)
            .slice(0, MAX_SIGNAL_COUNT);

        signalsRef.current = nextSignals;
        setSignals(nextSignals);
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

    }, [data, isHydrated, strategyVersion]);

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
            [signal.symbol]: signal.timestamp,
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
        dismissedSignalsRef.current = {};
        hasCompletedInitialScan.current = false;
        localStorage.removeItem(DISMISSED_SIGNALS_STORAGE_KEY);
        localStorage.removeItem(STORED_SIGNALS_STORAGE_KEY);
    };

    return {
        signals: sortedSignals,
        dismissSignal,
        clearAll,
    };
}
