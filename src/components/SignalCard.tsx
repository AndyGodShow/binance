"use client";

import { StrategySignal } from '@/lib/strategyTypes';
import { formatPrice } from '@/lib/risk/priceUtils';
import styles from './SignalCard.module.css';

interface SignalCardProps {
    signal: StrategySignal;
    onDismiss: (signal: StrategySignal) => void;
    onSymbolClick?: (symbol: string) => void;
}

export default function SignalCard({ signal, onDismiss, onSymbolClick }: SignalCardProps) {
    const cleanSymbol = signal.symbol.replace('USDT', '');
    const directionColor = signal.direction === 'long' ? styles.long : styles.short;
    const directionIcon = signal.direction === 'long' ? '🟢' : '🔴';
    const directionText = signal.direction === 'long' ? '做多' : '做空';
    const isCooling = signal.status === 'cooling';
    const isSnapshot = signal.status === 'snapshot';
    const risk = signal.risk;
    const formatDateTime = (value: number) => new Date(value).toLocaleString('zh-CN', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false
    });

    // 叠加信号等级标识
    const stackCount = signal.stackCount || 1;
    let stackBadge = '';
    let stackLabel = '';
    let cardStyle = styles.card;

    if (stackCount >= 3) {
        stackBadge = '🔥';
        stackLabel = '超级信号';
        cardStyle = `${styles.card} ${styles.superSignal}`;
    } else if (stackCount === 2) {
        stackBadge = '⚡';
        stackLabel = '强信号';
        cardStyle = `${styles.card} ${styles.strongSignal}`;
    }

    const statusClassName = isCooling
        ? styles.statusCooling
        : isSnapshot
            ? styles.statusSnapshot
            : styles.statusActive;
    const statusLabel = isCooling
        ? '回落保留'
        : isSnapshot
            ? '打开时已满足'
            : '实时触发';
    const statusHint = isCooling
        ? '条件已回落，手动关闭前会一直保留'
        : isSnapshot
            ? '页面打开时该信号已经成立，无法确认精确触发时点'
            : null;
    const primaryTimeLabel = isSnapshot ? '首次记录' : '触发时间';

    return (
        <div className={`${cardStyle} ${directionColor} ${isCooling ? styles.coolingCard : ''}`}>
            <div className={styles.header}>
                <div className={styles.symbol} onClick={() => onSymbolClick?.(signal.symbol)}>
                    {directionIcon} {cleanSymbol}
                    {signal.price && (
                        <span className={styles.price}>
                            ${formatPrice(signal.price)}
                        </span>
                    )}
                </div>
                <div className={styles.confidenceGroup}>
                    {stackBadge && <span className={styles.stackBadge}>{stackBadge}</span>}
                    <div className={styles.confidence}>{signal.confidence}分</div>
                    <button
                        className={styles.closeBtn}
                        onClick={(e) => {
                            e.stopPropagation();
                            onDismiss(signal);
                        }}
                        title="关闭此信号"
                    >
                        ✕
                    </button>
                </div>
            </div>

            <div className={styles.statusRow}>
                <span className={`${styles.statusBadge} ${statusClassName}`}>
                    {statusLabel}
                </span>
                {statusHint && (
                    <span className={styles.statusHint}>
                        {statusHint}
                    </span>
                )}
            </div>

            {/* 叠加策略信息 */}
            {stackCount > 1 && (
                <div className={styles.stackInfo}>
                    <span className={styles.stackLabel}>
                        {stackLabel} - {stackCount}个策略共振
                        {signal.comboBonus && <span className={styles.bonus}>(+{signal.comboBonus}分)</span>}
                    </span>
                </div>
            )}

            <div className={styles.strategy}>{signal.strategyName}</div>
            <div className={styles.direction}>建议方向：{directionText}</div>
            <div className={styles.reason}>{signal.reason}</div>

            {/* 复合策略条件显示 */}
            {signal.isComposite && signal.conditions && (
                <div className={styles.compositeConditions}>
                    <div className={styles.conditionsTitle}>
                        条件满足度: {signal.conditionsMet}/{signal.totalConditions}
                    </div>
                    {signal.conditions.map((condition, idx) => (
                        <div
                            key={idx}
                            className={`${styles.conditionItem} ${condition.met ? styles.conditionMet : styles.conditionNotMet}`}
                        >
                            <span className={styles.conditionIcon}>
                                {condition.met ? '✓' : '○'}
                            </span>
                            <span className={styles.conditionDesc}>{condition.description}</span>
                        </div>
                    ))}
                </div>
            )}

            {/* 🔥 风险管理信息 */}
            {risk && (
                <div className={styles.riskManagement}>
                    {/* 止损 */}
                    <div className={styles.riskRow}>
                        <span className={styles.riskLabel}>止损:</span>
                        <span className={`${styles.riskValue} ${styles.stopLoss}`}>
                            ${formatPrice(risk.stopLoss.price, signal.price ?? risk.metrics.entryPrice, 1)} ({signal.direction === 'long' ? '-' : '+'}{risk.stopLoss.percentage.toFixed(1)}%)
                        </span>
                    </div>

                    {/* 止盈 */}
                    <div className={styles.riskRow}>
                        <span className={styles.riskLabel}>止盈:</span>
                        <span className={`${styles.riskValue} ${styles.takeProfit}`}>
                            {risk.takeProfit.targets.map((t) =>
                                `$${formatPrice(t.price, signal.price ?? risk.metrics.entryPrice, 1)} (+${t.percentage.toFixed(1)}%)[${t.closePercentage}%]`
                            ).join(' | ')}
                        </span>
                    </div>

                    {/* 盈亏比 */}
                    <div className={styles.riskRow}>
                        <span className={styles.riskLabel}>盈亏比:</span>
                        <span className={`${styles.riskValue} ${styles.rrRatio}`}>
                            1:{risk.takeProfit.riskRewardRatio.toFixed(1)}
                        </span>
                    </div>

                    {/* 仓位 */}
                    <div className={styles.riskRow}>
                        <span className={styles.riskLabel}>建议仓位:</span>
                        <span className={styles.riskValue}>
                            {risk.positionSizing.percentage}% (杠杆{risk.positionSizing.leverage}x)
                        </span>
                    </div>
                </div>
            )}

            {/* 显示所有叠加的策略 */}
            {signal.stackedStrategies && signal.stackedStrategies.length > 1 && (
                <div className={styles.stackedList}>
                    <div className={styles.stackedTitle}>触发策略:</div>
                    {signal.stackedStrategies.map((strategy, idx) => (
                        <div key={idx} className={styles.stackedItem}>
                            • {strategy}
                        </div>
                    ))}
                </div>
            )}

            <div className={styles.timeGroup}>
                <div className={styles.time}>
                    {primaryTimeLabel}: {formatDateTime(signal.timestamp)}
                </div>
                {isCooling && signal.lastSeenAt && (
                    <div className={styles.secondaryTime}>
                        最后满足: {formatDateTime(signal.lastSeenAt)}
                    </div>
                )}
            </div>
        </div>
    );
}
