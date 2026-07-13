"use client";

import type { Dispatch, SetStateAction } from 'react';
import type { StrategyRiskConfig } from '@/lib/risk/riskConfig';
import type {
    DeepPartial,
    StrategyId,
    StrategyParameterConfigMap,
} from '@/lib/strategyParameters';
import type {
    ExecutionIntervalOption,
    PresetRange,
    SymbolIssueDetail,
} from '@/lib/backtestSymbolValidation';
import { getExecutionOptions, type BacktestSymbolSource } from '@/lib/backtestPanelSupport';
import DataQualityCard from '../DataQualityCard';
import RiskConfigPanel from '../RiskConfigPanel';
import StrategyParameterPanel from '../StrategyParameterPanel';
import styles from '../BacktestPanel.module.css';
import type { BacktestRunDetail } from './types';

interface StrategyOption {
    id: string;
    name: string;
    description: string;
}

interface BacktestControlsProps {
    selection: {
        detailRun: BacktestRunDetail | null;
        symbolSource: BacktestSymbolSource;
        setSymbolSource: Dispatch<SetStateAction<BacktestSymbolSource>>;
        topN: number;
        setTopN: Dispatch<SetStateAction<number>>;
        rangeStart: number;
        setRangeStart: Dispatch<SetStateAction<number>>;
        rangeEnd: number;
        setRangeEnd: Dispatch<SetStateAction<number>>;
        customSymbols: string;
        setCustomSymbols: Dispatch<SetStateAction<string>>;
    };
    execution: {
        interval: string;
        setInterval: Dispatch<SetStateAction<string>>;
        executionInterval: ExecutionIntervalOption;
        setExecutionInterval: Dispatch<SetStateAction<ExecutionIntervalOption>>;
        executionOptions: ExecutionIntervalOption[];
        preset: PresetRange;
        setPreset: Dispatch<SetStateAction<PresetRange>>;
    };
    strategy: {
        strategies: StrategyOption[];
        selectedStrategy: string;
        setSelectedStrategy: Dispatch<SetStateAction<string>>;
        selectedStrategyId: StrategyId | '';
        strategyParameterOverrides: DeepPartial<StrategyParameterConfigMap>;
        setStrategyParameterOverrides: Dispatch<SetStateAction<DeepPartial<StrategyParameterConfigMap>>>;
        setRiskConfig: Dispatch<SetStateAction<StrategyRiskConfig | null>>;
    };
    risk: {
        initialCapital: number;
        setInitialCapital: Dispatch<SetStateAction<number>>;
        commission: number;
        setCommission: Dispatch<SetStateAction<number>>;
        maxConcurrentPositions: number;
        setMaxConcurrentPositions: Dispatch<SetStateAction<number>>;
        positionSizePercent: number;
        setPositionSizePercent: Dispatch<SetStateAction<number>>;
    };
    status: {
        loading: boolean;
        handleBacktest: () => void;
        downloadStatus: string;
        resolvedSymbols: string[];
        executionIntervalsBySymbol: Record<string, string>;
        skippedSymbols: string[];
        skippedDetails: SymbolIssueDetail[];
        error: string | null;
    };
}

export default function BacktestControls(props: BacktestControlsProps) {
    const {
        detailRun, symbolSource, setSymbolSource, topN, setTopN, rangeStart, setRangeStart,
        rangeEnd, setRangeEnd, customSymbols, setCustomSymbols,
    } = props.selection;
    const {
        interval, setInterval, executionInterval, setExecutionInterval, executionOptions,
        preset, setPreset,
    } = props.execution;
    const {
        strategies, selectedStrategy, setSelectedStrategy, selectedStrategyId,
        strategyParameterOverrides, setStrategyParameterOverrides, setRiskConfig,
    } = props.strategy;
    const {
        initialCapital, setInitialCapital, commission, setCommission,
        maxConcurrentPositions, setMaxConcurrentPositions, positionSizePercent,
        setPositionSizePercent,
    } = props.risk;
    const {
        loading, handleBacktest, downloadStatus, resolvedSymbols, executionIntervalsBySymbol,
        skippedSymbols, skippedDetails, error,
    } = props.status;

    return (
        <>
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
    <select value={symbolSource} onChange={(e) => setSymbolSource(e.target.value as BacktestSymbolSource)}>
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
        </>
    );
}
