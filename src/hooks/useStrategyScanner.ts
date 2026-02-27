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

    // 🔧 修复 Hydration Mismatch：初始化为空，然后在客户端加载
    const [dismissedSignals, setDismissedSignals] = useState<Set<string>>(new Set());

    // 在客户端加载后从 localStorage 读取
    useEffect(() => {
        if (typeof window !== 'undefined') {
            const saved = localStorage.getItem('dismissedSignals');
            if (saved) {
                try {
                    setDismissedSignals(new Set(JSON.parse(saved)));
                } catch (err) {
                    console.error('Failed to load dismissed signals:', err);
                }
            }
        }
    }, []);

    // 扫描并生成信号
    useEffect(() => {
        if (!data || data.length === 0) return;

        const enabledStrategies = strategyRegistry.getEnabled();

        // 第1步：按币种分组收集所有策略信号
        const signalsBySymbol = new Map<string, StrategySignal[]>();

        // 创建当前数据摘要，用于下次比较
        const currentDataDigest = new Map<string, string>();

        data.forEach(ticker => {
            // 为每个ticker创建包含关键字段的摘要
            const digest = JSON.stringify({
                lastPrice: ticker.lastPrice,
                change15m: ticker.change15m,
                change1h: ticker.change1h,
                change4h: ticker.change4h,
                quoteVolume: ticker.quoteVolume,
                openInterest: ticker.openInterest,
                fundingRate: ticker.fundingRate,
                // 添加其他策略可能用到的字段
                rsrs: ticker.rsrs,
                rsrsZScore: ticker.rsrsZScore,
                atr: ticker.atr,
            });

            currentDataDigest.set(ticker.symbol, digest);

            // 只对数据有变化的币种重新扫描策略
            const prevDigest = prevDataDigest.current.get(ticker.symbol);
            if (prevDigest === digest) {
                // 数据没变化，跳过策略扫描
                return;
            }

            const symbolSignals: StrategySignal[] = [];

            // 对每个币种应用所有启用的策略
            enabledStrategies.forEach(strategy => {
                const signal = strategy.detect(ticker);
                if (signal) {
                    // 只保留置信度≥85分的高质量信号
                    if (signal.confidence < 85) return;

                    // 添加触发时的价格
                    signal.price = parseFloat(ticker.lastPrice);

                    // 生成信号的唯一标识
                    const signalId = `${signal.symbol}-${signal.strategyId}`;

                    // 如果这个信号之前已经存在，使用原来的时间戳
                    const existingTimestamp = signalTimestamps.current.get(signalId);
                    if (existingTimestamp) {
                        signal.timestamp = existingTimestamp;
                    } else {
                        // 新信号，记录时间戳
                        signalTimestamps.current.set(signalId, signal.timestamp);
                    }

                    symbolSignals.push(signal);
                }
            });

            // 如果该币种有触发任何策略，加入分组
            if (symbolSignals.length > 0) {
                signalsBySymbol.set(ticker.symbol, symbolSignals);
            }
        });

        // 更新数据摘要缓存
        prevDataDigest.current = currentDataDigest;

        // 第2步：计算叠加加成并合并信号
        const currentSignals: StrategySignal[] = []; // Renamed from newSignals

        signalsBySymbol.forEach((symbolSignals, symbol) => {
            const stackCount = symbolSignals.length;

            // 计算叠加加成
            let comboBonus = 0;
            if (stackCount >= 3) {
                comboBonus = 20; // 🔥 超级信号
            } else if (stackCount >= 2) {
                comboBonus = 10; // ⚡ 强信号
            }

            // 选择置信度最高的策略作为主信号
            const mainSignal = symbolSignals.reduce((max, s) =>
                s.confidence > max.confidence ? s : max
            );

            // 生成唯一key用于去重 // Removed
            // const signalKey = `${symbol}`; // Removed

            // 检查是否在5分钟内已触发过（防止重复） // Removed
            // if (!triggeredSet.has(signalKey)) { // Removed
            // 创建增强的信号（带叠加信息）
            const boostedSignal: StrategySignal = {
                ...mainSignal,
                confidence: mainSignal.confidence + comboBonus,
                stackCount,
                stackedStrategies: symbolSignals.map(s => s.strategyName),
                comboBonus,
            };

            currentSignals.push(boostedSignal); // Pushed to currentSignals
            // triggeredSet.add(signalKey); // Removed
            // } // Removed
        });

        // 第3步：更新信号列表（保持现有信号，只添加新的）
        setSignals(prev => {
            // 创建一个Map来快速查找现有信号
            const existingSignalsMap = new Map<string, StrategySignal>();
            prev.forEach(sig => {
                existingSignalsMap.set(sig.symbol, sig);
            });

            // 更新或添加信号
            const updatedSignals: StrategySignal[] = [];
            const processedSymbols = new Set<string>();

            // 处理当前检测到的信号
            currentSignals.forEach(newSig => {
                // 🔧 跳过用户已手动关闭的信号
                if (dismissedSignals.has(newSig.symbol)) {
                    return;
                }

                processedSymbols.add(newSig.symbol);
                const existing = existingSignalsMap.get(newSig.symbol);

                if (existing) {
                    // 更新现有信号，但保留原始时间戳
                    updatedSignals.push({
                        ...newSig,
                        timestamp: existing.timestamp
                    });
                } else {
                    // 新信号
                    updatedSignals.push(newSig);
                }
            });

            // 保留未被更新的旧信号（条件不再满足但还在列表中的）
            prev.forEach(oldSig => {
                if (!processedSymbols.has(oldSig.symbol)) {
                    updatedSignals.push(oldSig);
                }
            });

            // 按时间戳倒序排序（最新的在上面）并限制数量
            return updatedSignals
                .sort((a, b) => b.timestamp - a.timestamp)
                .slice(0, 50);
        });

        // 清理过期的触发记录和时间戳（5分钟） // Modified
        const cleanupTimer = setTimeout(() => {
            // setTriggeredSet(new Set()); // Removed
            signalTimestamps.current = new Map();
        }, 5 * 60 * 1000);

        return () => clearTimeout(cleanupTimer);
    }, [data, dismissedSignals]); // 添加 dismissedSignals 依赖

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
        localStorage.removeItem('dismissedSignals'); // 🔧 清空 localStorage
    };

    return {
        signals: sortedSignals,
        stats,
        dismissSignal,
        clearAll,
    };
}
