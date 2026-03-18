"use client";

import { useState, useEffect, useMemo, useRef } from 'react';
import { TickerData } from '@/lib/types';
import { StrategySignal } from '@/lib/strategyTypes';
import { strategyRegistry } from '@/strategies/registry';

export function useStrategyScanner(data: TickerData[]) {
    const [signals, setSignals] = useState<StrategySignal[]>([]);
    // 使用 useRef 保存已存在信号的时间戳，key为 symbol-strategyId
    const signalTimestamps = useRef<Map<string, number>>(new Map());

    // 保存上一次的数据摘要，用于检测变化
    const prevDataDigest = useRef<Map<string, string>>(new Map());
    const prevStrategyVersion = useRef(0);

    // 🔧 修复 Hydration Mismatch：初始化为空，然后在客户端加载
    const [dismissedSignals, setDismissedSignals] = useState<Set<string>>(new Set());
    const dismissedSignalsRef = useRef<Set<string>>(new Set());
    const [strategyVersion, setStrategyVersion] = useState(0);

    // 在客户端加载后从 localStorage 读取
    useEffect(() => {
        if (typeof window !== 'undefined') {
            const saved = localStorage.getItem('dismissedSignals');
            if (saved) {
                try {
                    const parsed = new Set<string>(JSON.parse(saved));
                    setDismissedSignals(parsed);
                    dismissedSignalsRef.current = parsed;
                } catch (err) {
                    console.error('Failed to load dismissed signals:', err);
                }
            }
        }
    }, []);

    useEffect(() => {
        return strategyRegistry.subscribe(() => {
            setStrategyVersion((prev) => prev + 1);
        });
    }, []);

    // 扫描并生成信号
    useEffect(() => {
        if (!data || data.length === 0) return;

        const enabledStrategies = strategyRegistry.getEnabled();
        const forceRescan = prevStrategyVersion.current !== strategyVersion;

        const currentDataDigest = new Map<string, string>();
        const scanResults = new Map<string, StrategySignal | null>();
        const releasedDismissals = new Set<string>();
        const clearSignalTimestamps = (symbol: string) => {
            Array.from(signalTimestamps.current.keys()).forEach((key) => {
                if (key.startsWith(`${symbol}-`)) {
                    signalTimestamps.current.delete(key);
                }
            });
        };

        data.forEach(ticker => {
            const digest = JSON.stringify({
                lastPrice: ticker.lastPrice,
                priceChangePercent: ticker.priceChangePercent,
                change15m: ticker.change15m,
                change1h: ticker.change1h,
                change4h: ticker.change4h,
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
                squeezeStrength: ticker.squeezeStrength,
                momentumValue: ticker.momentumValue,
                momentumColor: ticker.momentumColor,
                adx: ticker.adx,
                adxSlope: ticker.adxSlope,
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
                    if (signal.confidence < 85) return;
                    signal.price = parseFloat(ticker.lastPrice);
                    const signalId = `${signal.symbol}-${signal.strategyId}`;
                    const existingTimestamp = signalTimestamps.current.get(signalId);
                    if (existingTimestamp) {
                        signal.timestamp = existingTimestamp;
                    } else {
                        signalTimestamps.current.set(signalId, signal.timestamp);
                    }
                    symbolSignals.push(signal);
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
                releasedDismissals.add(ticker.symbol);
                clearSignalTimestamps(ticker.symbol);
            }
        });

        prevDataDigest.current = currentDataDigest;
        prevStrategyVersion.current = strategyVersion;

        if (releasedDismissals.size > 0) {
            setDismissedSignals((prev) => {
                const next = new Set(prev);
                let changed = false;

                releasedDismissals.forEach((symbol) => {
                    if (next.delete(symbol)) {
                        changed = true;
                    }
                });

                if (changed) {
                    dismissedSignalsRef.current = next;
                    localStorage.setItem('dismissedSignals', JSON.stringify(Array.from(next)));
                    return next;
                }

                return prev;
            });
        }

        setSignals(prev => {
            const existingSignalsMap = new Map<string, StrategySignal>();
            prev.forEach(sig => {
                existingSignalsMap.set(sig.symbol, sig);
            });

            const updatedSignals: StrategySignal[] = [];
            data.forEach((ticker) => {
                const symbol = ticker.symbol;
                const scanResult = scanResults.get(symbol);

                if (scanResult === undefined) {
                    const existing = existingSignalsMap.get(symbol);
                    if (existing && !dismissedSignalsRef.current.has(symbol)) {
                        updatedSignals.push(existing);
                    }
                    return;
                }

                if (scanResult === null || dismissedSignalsRef.current.has(symbol)) {
                    return;
                }

                const existing = existingSignalsMap.get(symbol);
                updatedSignals.push(existing
                    ? { ...scanResult, timestamp: existing.timestamp }
                    : scanResult
                );
            });

            return updatedSignals
                .sort((a, b) => b.timestamp - a.timestamp)
                .slice(0, 50);
        });

        // 清理过期的触发记录和时间戳（5分钟）
        const cleanupTimer = setTimeout(() => {
            signalTimestamps.current = new Map();
        }, 5 * 60 * 1000);

        return () => clearTimeout(cleanupTimer);
    }, [data, strategyVersion]);

    // 按时间戳倒序排序的活跃信号（最新的在上面）
    const sortedSignals = useMemo(() => {
        return [...signals].sort((a, b) => b.timestamp - a.timestamp);
    }, [signals]);

    // 统计数据
    const stats = useMemo(() => {
        const total = signals.length;
        const longCount = signals.filter(s => s.direction === 'long').length;
        const shortCount = signals.filter(s => s.direction === 'short').length;
        const superSignals = signals.filter(s => (s.stackCount || 0) >= 3).length;
        const strongSignals = signals.filter(s => (s.stackCount || 0) === 2).length;

        return { total, longCount, shortCount, superSignals, strongSignals };
    }, [signals]);

    const dismissSignal = (id: string) => {
        setDismissedSignals(prev => {
            const newSet = new Set(prev);
            newSet.add(id);
            dismissedSignalsRef.current = newSet;
            // 🔧 保存到 localStorage
            localStorage.setItem('dismissedSignals', JSON.stringify(Array.from(newSet)));
            return newSet;
        });
        setSignals(prev => prev.filter(s => s.symbol !== id));
    };

    const clearAll = () => {
        setSignals([]);
        signalTimestamps.current = new Map();
        setDismissedSignals(new Set()); // 🔧 清空黑名单
        dismissedSignalsRef.current = new Set();
        localStorage.removeItem('dismissedSignals'); // 🔧 清空 localStorage
    };

    return {
        signals: sortedSignals,
        stats,
        dismissSignal,
        clearAll,
    };
}
