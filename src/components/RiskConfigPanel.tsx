"use client";

import { useState, useEffect } from 'react';
import { StrategyRiskConfig, getDefaultRiskConfig, StopLossConfig, TakeProfitTargetConfig } from '@/lib/risk/riskConfig';
import styles from './BacktestPanel.module.css';

interface RiskConfigPanelProps {
    strategyId: string;
    onChange: (config: StrategyRiskConfig) => void;
}

export default function RiskConfigPanel({ strategyId, onChange }: RiskConfigPanelProps) {
    const defaults = getDefaultRiskConfig(strategyId);
    const [config, setConfig] = useState<StrategyRiskConfig>(defaults);
    const [expanded, setExpanded] = useState(false);

    // 策略切换时重置为默认值
    useEffect(() => {
        const nextDefaults = getDefaultRiskConfig(strategyId);
        setConfig(nextDefaults);
        onChange(nextDefaults);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [strategyId]);

    const update = (partial: Partial<StrategyRiskConfig>) => {
        const newConfig = { ...config, ...partial };
        setConfig(newConfig);
        onChange(newConfig);
    };

    const updateStopLoss = (partial: Partial<StopLossConfig>) => {
        update({ stopLoss: { ...config.stopLoss, ...partial } });
    };

    const updateTarget = (index: number, partial: Partial<TakeProfitTargetConfig>) => {
        const newTargets = [...config.takeProfit.targets];
        newTargets[index] = { ...newTargets[index], ...partial };
        update({ takeProfit: { targets: newTargets } });
    };

    const addTarget = () => {
        const newTargets = [...config.takeProfit.targets, {
            atrMultiplier: 3,
            closePercentage: 100,
            moveStopToEntry: false,
        }];
        update({ takeProfit: { targets: newTargets } });
    };

    const removeTarget = (index: number) => {
        if (config.takeProfit.targets.length <= 1) return;
        const newTargets = config.takeProfit.targets.filter((_, i) => i !== index);
        update({ takeProfit: { targets: newTargets } });
    };

    const resetToDefaults = () => {
        const newDefaults = getDefaultRiskConfig(strategyId);
        setConfig(newDefaults);
        onChange(newDefaults);
    };

    const stopLossTypeLabels: Record<string, string> = {
        'fixed': '固定百分比',
        'trailing': '跟踪止损',
        'atr': 'ATR 倍数',
        'indicator': '技术指标',
    };

    return (
        <div className={styles.section}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <h3 onClick={() => setExpanded(!expanded)} style={{ cursor: 'pointer', userSelect: 'none' }}>
                    🎯 策略风控参数 {expanded ? '▾' : '▸'}
                </h3>
                {expanded && (
                    <button
                        onClick={resetToDefaults}
                        style={{
                            background: 'rgba(246,70,93,0.15)',
                            border: '1px solid rgba(246,70,93,0.3)',
                            color: '#F6465D',
                            borderRadius: 6,
                            padding: '4px 10px',
                            fontSize: 12,
                            cursor: 'pointer',
                        }}
                    >
                        重置默认
                    </button>
                )}
            </div>

            {expanded && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 16, marginTop: 8 }}>
                    {/* ===== 止损区域 ===== */}
                    <div style={sectionStyle}>
                        <div style={sectionTitleStyle}>🛡️ 止损设置</div>
                        <div className={styles.fields}>
                            <div className={styles.field}>
                                <label>止损类型</label>
                                <select
                                    value={config.stopLoss.type}
                                    onChange={(e) => updateStopLoss({ type: e.target.value as StopLossConfig['type'] })}
                                >
                                    {Object.entries(stopLossTypeLabels).map(([k, v]) => (
                                        <option key={k} value={k}>{v}</option>
                                    ))}
                                </select>
                            </div>

                            {(config.stopLoss.type === 'atr' || config.stopLoss.type === 'trailing') && (
                                <div className={styles.field}>
                                    <label>ATR 倍数</label>
                                    <input
                                        type="number"
                                        value={config.stopLoss.atrMultiplier || 1.5}
                                        onChange={(e) => updateStopLoss({ atrMultiplier: Number(e.target.value) })}
                                        min="0.5" max="5" step="0.5"
                                    />
                                </div>
                            )}

                            {config.stopLoss.type === 'fixed' && (
                                <div className={styles.field}>
                                    <label>固定止损 (%)</label>
                                    <input
                                        type="number"
                                        value={config.stopLoss.fixedPercentage || 3}
                                        onChange={(e) => updateStopLoss({ fixedPercentage: Number(e.target.value) })}
                                        min="0.5" max="10" step="0.5"
                                    />
                                </div>
                            )}

                            <div className={styles.field}>
                                <label>止损上限 (%)</label>
                                <input
                                    type="number"
                                    value={config.stopLoss.maxPercentage || 5}
                                    onChange={(e) => updateStopLoss({ maxPercentage: Number(e.target.value) })}
                                    min="1" max="15" step="0.5"
                                />
                            </div>
                        </div>
                    </div>

                    {/* ===== 止盈区域 ===== */}
                    <div style={sectionStyle}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <div style={sectionTitleStyle}>💰 止盈目标 ({config.takeProfit.targets.length}级)</div>
                            <button onClick={addTarget} style={addBtnStyle}>+ 添加</button>
                        </div>

                        {config.takeProfit.targets.map((target, idx) => (
                            <div key={idx} style={targetRowStyle}>
                                <span style={targetLabelStyle}>T{idx + 1}</span>
                                <div className={styles.fields} style={{ flex: 1 }}>
                                    {target.atrMultiplier !== undefined && (
                                        <div className={styles.field}>
                                            <label>ATR倍数</label>
                                            <input
                                                type="number"
                                                value={target.atrMultiplier}
                                                onChange={(e) => updateTarget(idx, { atrMultiplier: Number(e.target.value) })}
                                                min="1" max="10" step="0.5"
                                            />
                                        </div>
                                    )}
                                    {target.stopMultiplier !== undefined && (
                                        <div className={styles.field}>
                                            <label>止损倍数</label>
                                            <input
                                                type="number"
                                                value={target.stopMultiplier}
                                                onChange={(e) => updateTarget(idx, { stopMultiplier: Number(e.target.value) })}
                                                min="1" max="10" step="0.5"
                                            />
                                        </div>
                                    )}
                                    {target.fixedPercentage !== undefined && (
                                        <div className={styles.field}>
                                            <label>固定%</label>
                                            <input
                                                type="number"
                                                value={target.fixedPercentage}
                                                onChange={(e) => updateTarget(idx, { fixedPercentage: Number(e.target.value) })}
                                                min="0.5" max="20" step="0.5"
                                            />
                                        </div>
                                    )}
                                    <div className={styles.field}>
                                        <label>平仓%</label>
                                        <input
                                            type="number"
                                            value={target.closePercentage}
                                            onChange={(e) => updateTarget(idx, { closePercentage: Number(e.target.value) })}
                                            min="10" max="100" step="10"
                                        />
                                    </div>
                                    <div className={styles.field} style={{ minWidth: 'auto' }}>
                                        <label>保本</label>
                                        <input
                                            type="checkbox"
                                            checked={target.moveStopToEntry || false}
                                            onChange={(e) => updateTarget(idx, { moveStopToEntry: e.target.checked })}
                                            style={{ width: 18, height: 18 }}
                                        />
                                    </div>
                                </div>
                                {config.takeProfit.targets.length > 1 && (
                                    <button onClick={() => removeTarget(idx)} style={removeBtnStyle}>✕</button>
                                )}
                            </div>
                        ))}
                    </div>

                    {/* ===== 其他参数 ===== */}
                    <div style={sectionStyle}>
                        <div style={sectionTitleStyle}>⚙️ 其他参数</div>
                        <div className={styles.fields}>
                            <div className={styles.field}>
                                <label>最大杠杆</label>
                                <input
                                    type="number"
                                    value={config.maxLeverage}
                                    onChange={(e) => update({ maxLeverage: Number(e.target.value) })}
                                    min="1" max="20" step="1"
                                />
                            </div>
                            {config.timeStop && (
                                <>
                                    <div className={styles.field}>
                                        <label>时间止损 (K线数)</label>
                                        <input
                                            type="number"
                                            value={config.timeStop.maxBars}
                                            onChange={(e) => update({
                                                timeStop: {
                                                    ...config.timeStop!,
                                                    maxBars: Number(e.target.value)
                                                }
                                            })}
                                            min="1" max="50" step="1"
                                        />
                                    </div>
                                    <div className={styles.field}>
                                        <label>利润阈值 (%)</label>
                                        <input
                                            type="number"
                                            value={config.timeStop.profitThreshold}
                                            onChange={(e) => update({
                                                timeStop: {
                                                    ...config.timeStop!,
                                                    profitThreshold: Number(e.target.value)
                                                }
                                            })}
                                            min="0" max="10" step="0.5"
                                        />
                                    </div>
                                </>
                            )}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

// ===== Inline styles =====
const sectionStyle: React.CSSProperties = {
    background: 'rgba(43,49,57,0.4)',
    borderRadius: 8,
    padding: '12px 16px',
    border: '1px solid rgba(43,49,57,0.8)',
};

const sectionTitleStyle: React.CSSProperties = {
    fontSize: 13,
    fontWeight: 600,
    color: '#EAECEF',
    marginBottom: 8,
};

const targetRowStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    marginTop: 8,
    padding: '8px 0',
    borderTop: '1px solid rgba(43,49,57,0.6)',
};

const targetLabelStyle: React.CSSProperties = {
    fontSize: 12,
    fontWeight: 700,
    color: '#0ECB81',
    background: 'rgba(14,203,129,0.15)',
    borderRadius: 4,
    padding: '2px 8px',
    minWidth: 28,
    textAlign: 'center',
};

const addBtnStyle: React.CSSProperties = {
    background: 'rgba(14,203,129,0.15)',
    border: '1px solid rgba(14,203,129,0.3)',
    color: '#0ECB81',
    borderRadius: 6,
    padding: '3px 10px',
    fontSize: 12,
    cursor: 'pointer',
};

const removeBtnStyle: React.CSSProperties = {
    background: 'rgba(246,70,93,0.15)',
    border: '1px solid rgba(246,70,93,0.3)',
    color: '#F6465D',
    borderRadius: 4,
    padding: '2px 8px',
    fontSize: 11,
    cursor: 'pointer',
    lineHeight: '16px',
};
