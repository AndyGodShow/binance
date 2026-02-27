"use client";

import { useState, useEffect } from 'react';
import { TickerData } from '@/lib/types';
import { StrategySignal } from '@/lib/strategyTypes';
import { strategyRegistry } from '@/strategies/registry';
import SignalCard from './SignalCard';
import { ChevronDown, ChevronUp } from 'lucide-react';
import styles from './StrategyCenter.module.css';

interface StrategyCenterProps {
    data: TickerData[];
    signals: StrategySignal[]; // 从父组件接收
    dismissSignal: (id: string) => void; // 从父组件接收
    onSymbolClick?: (symbol: string) => void;
}

export default function StrategyCenter({ data, signals, dismissSignal, onSymbolClick }: StrategyCenterProps) {
    // 使用本地状态存储策略列表，以便响应式更新
    const [allStrategies, setAllStrategies] = useState(() => strategyRegistry.getAll());

    // 订阅策略变化，实现响应式更新
    useEffect(() => {
        const unsubscribe = strategyRegistry.subscribe(() => {
            setAllStrategies([...strategyRegistry.getAll()]);
        });
        return unsubscribe;
    }, []);

    const enabledStrategyIds = new Set(allStrategies.filter(s => s.enabled).map(s => s.id));

    // 🔧 根据启用的策略过滤信号
    const filteredSignals = signals.filter(signal => enabledStrategyIds.has(signal.strategyId));

    // 重新计算统计数据（基于过滤后的信号）
    const filteredStats = {
        total: filteredSignals.length,
        longCount: filteredSignals.filter(s => s.direction === 'long').length,
        shortCount: filteredSignals.filter(s => s.direction === 'short').length,
        superSignals: filteredSignals.filter(s => (s.stackCount || 0) >= 3).length,
        strongSignals: filteredSignals.filter(s => (s.stackCount || 0) === 2).length,
    };

    // 折叠/展开状态
    const [isCollapsed, setIsCollapsed] = useState(false);

    const handleToggle = (id: string) => {
        strategyRegistry.toggleStrategy(id);
    };

    return (
        <div className={styles.container}>
            {/* 左侧：策略库 */}
            <div className={styles.left}>
                <div className={styles.strategyHeader}>
                    <h2 className={styles.sectionTitle}>策略库</h2>
                    <button
                        className={styles.collapseBtn}
                        onClick={() => setIsCollapsed(!isCollapsed)}
                        title={isCollapsed ? '展开策略' : '收起策略'}
                    >
                        {isCollapsed ? <ChevronDown size={20} /> : <ChevronUp size={20} />}
                    </button>
                </div>

                {!isCollapsed && (
                    <div className={styles.strategies}>
                        {allStrategies.map(strategy => (
                            <div key={strategy.id} className={styles.strategyItem}>
                                <div className={styles.strategyItemHeader}>
                                    <input
                                        type="checkbox"
                                        checked={strategy.enabled}
                                        onChange={() => handleToggle(strategy.id)}
                                    />
                                    <span className={styles.strategyName}>{strategy.name}</span>
                                </div>
                                <div className={styles.strategyDesc}>{strategy.description}</div>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {/* 右侧：活跃信号 */}
            <div className={styles.right}>
                <div className={styles.signalHeader}>
                    <h2 className={styles.sectionTitle}>
                        活跃信号 ({filteredStats.total})
                    </h2>
                    <div className={styles.stats}>
                        🟢 做多: {filteredStats.longCount} | 🔴 做空: {filteredStats.shortCount}
                    </div>
                </div>

                <div className={styles.signalList}>
                    {filteredSignals.length === 0 ? (
                        <div className={styles.empty}>
                            暂无信号，等待策略触发...
                        </div>
                    ) : (
                        filteredSignals.map(signal => (
                            <SignalCard
                                key={`${signal.strategyId}-${signal.symbol}-${signal.timestamp}`}
                                signal={signal}
                                onDismiss={dismissSignal}
                                onSymbolClick={onSymbolClick}
                            />
                        ))
                    )}
                </div>
            </div>
        </div>
    );
}
