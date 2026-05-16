"use client";

import { useState, useEffect } from 'react';
import { StrategySignal } from '@/lib/strategyTypes';
import type { MarketDataStatus } from '@/lib/strategyScannerDiagnostics';
import {
    buildReadinessDebugRows,
    isMarketDataStatusDegraded,
} from '@/lib/strategyScannerDiagnostics';
import { filterScannerSignalsByEnabledStrategies } from '@/lib/strategyScannerSnapshot';
import type { StrategyInputReadinessSummary } from '@/lib/strategyInputs';
import { strategyRegistry } from '@/strategies/registry';
import SignalCard from './SignalCard';
import { ChevronDown, ChevronUp } from 'lucide-react';
import styles from './StrategyCenter.module.css';

interface StrategyCenterProps {
    signals: StrategySignal[]; // 从父组件接收
    dismissSignal: (signal: StrategySignal) => void; // 从父组件接收
    clearAllSignals?: () => void; // 一键清除全部
    onSymbolClick?: (symbol: string) => void;
    marketDataStatus: MarketDataStatus;
    readinessSummary?: StrategyInputReadinessSummary | null;
}

export default function StrategyCenter({
    signals,
    dismissSignal,
    clearAllSignals,
    onSymbolClick,
    marketDataStatus,
    readinessSummary,
}: StrategyCenterProps) {
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
    const filteredSignals = filterScannerSignalsByEnabledStrategies(signals, enabledStrategyIds);

    // 重新计算统计数据（基于过滤后的信号）
    const filteredStats = {
        total: filteredSignals.length,
        activeCount: filteredSignals.filter(s => (s.status ?? 'active') === 'active').length,
        snapshotCount: filteredSignals.filter(s => s.status === 'snapshot').length,
        coolingCount: filteredSignals.filter(s => s.status === 'cooling').length,
        longCount: filteredSignals.filter(s => s.direction === 'long').length,
        shortCount: filteredSignals.filter(s => s.direction === 'short').length,
        superSignals: filteredSignals.filter(s => (s.stackCount || 0) >= 3).length,
        strongSignals: filteredSignals.filter(s => (s.stackCount || 0) === 2).length,
    };

    // 折叠/展开状态
    const [isCollapsed, setIsCollapsed] = useState(false);
    const [showDebug, setShowDebug] = useState(false);
    const isDevelopment = process.env.NODE_ENV === 'development';
    const isDegraded = isMarketDataStatusDegraded(marketDataStatus);
    const readinessRows = buildReadinessDebugRows(readinessSummary);
    const missingStrategyCount = readinessRows.length;
    const missingFieldCount = readinessRows.reduce((sum, row) => sum + row.missingFields.length, 0);
    const missingFieldPreview = readinessRows
        .flatMap((row) => row.missingFields.map((field) => `${row.strategyId}:${field}`))
        .slice(0, 4)
        .join('，');

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

            {/* 右侧：信号列表 */}
            <div className={styles.right}>
                <div className={styles.signalHeader}>
                    <div className={styles.signalTitleGroup}>
                        <h2 className={styles.sectionTitle}>
                            信号池 ({filteredStats.total})
                        </h2>
                        <div className={styles.marketStatusLine}>
                            <span>market: {marketDataStatus.dataQuality}</span>
                            <span>build: {marketDataStatus.buildState}</span>
                            <span>source: {marketDataStatus.dataSource}</span>
                        </div>
                        {isDegraded && (
                            <div className={styles.degradedHint}>
                                {marketDataStatus.message || '部分外部数据源失败，结果已降级'}
                            </div>
                        )}
                        {missingStrategyCount > 0 && (
                            <div className={styles.degradedHint}>
                                策略输入缺字段：影响 {missingStrategyCount} 个策略，{missingFieldCount} 类字段
                                {missingFieldPreview ? `（${missingFieldPreview}）` : ''}
                            </div>
                        )}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                        <div className={styles.stats}>
                            实时: {filteredStats.activeCount} | 开页已有: {filteredStats.snapshotCount} | 回落保留: {filteredStats.coolingCount} | 🟢 做多: {filteredStats.longCount} | 🔴 做空: {filteredStats.shortCount}
                        </div>
                        {filteredSignals.length > 0 && clearAllSignals && (
                            <button
                                onClick={clearAllSignals}
                                style={{
                                    background: 'rgba(246,70,93,0.15)',
                                    border: '1px solid rgba(246,70,93,0.3)',
                                    color: '#F6465D',
                                    borderRadius: 6,
                                    padding: '4px 10px',
                                    fontSize: 12,
                                    fontWeight: 600,
                                    cursor: 'pointer',
                                }}
                            >
                                全部清除
                            </button>
                        )}
                    </div>
                </div>

                {isDevelopment && readinessRows.length > 0 && (
                    <details
                        className={styles.debugPanel}
                        open={showDebug}
                        onToggle={(event) => setShowDebug(event.currentTarget.open)}
                    >
                        <summary>策略输入诊断 ({readinessRows.length})</summary>
                        <div className={styles.debugRows}>
                            {readinessRows.map((row) => (
                                <div key={row.strategyId} className={styles.debugRow}>
                                    <strong>{row.strategyId}</strong>
                                    <span>缺字段币种 {row.missingSymbolCount}</span>
                                    <span>{row.missingFields.slice(0, 6).join(', ')}</span>
                                    <span>样本 {row.sampleSymbols.join(', ')}</span>
                                </div>
                            ))}
                        </div>
                    </details>
                )}

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
