"use client";

import React from 'react';
import { AlertRecord, AlertLevel } from '@/lib/types';
import { X } from 'lucide-react';
import styles from './AlertNotification.module.css';

interface AlertNotificationProps {
    alerts: AlertRecord[];
    onDismiss: (id: string) => void;
    onClearAll?: () => void;
    onSymbolClick?: (symbol: string) => void;
}

export default function AlertNotification({ alerts, onDismiss, onClearAll, onSymbolClick }: AlertNotificationProps) {
    if (alerts.length === 0) return null;

    // Sort alerts by level (critical first) and timestamp
    const sortedAlerts = [...alerts].sort((a, b) => {
        const levelPriority = { critical: 0, warning: 1, info: 2 };
        if (levelPriority[a.level] !== levelPriority[b.level]) {
            return levelPriority[a.level] - levelPriority[b.level];
        }
        return b.timestamp - a.timestamp;
    });

    // Auto-dismiss based on level
    const getAutoDismissTime = (level: AlertLevel): number => {
        switch (level) {
            case 'info': return 3000;
            case 'warning': return 5000;
            case 'critical': return 8000;
        }
    };

    return (
        <div className={styles.container}>
            {alerts.length > 1 && onClearAll && (
                <button
                    className={styles.clearAllBtn}
                    onClick={onClearAll}
                >
                    全部清除 ({alerts.length})
                </button>
            )}
            {sortedAlerts.slice(0, 5).map((alert) => (
                <AlertCard
                    key={alert.id}
                    alert={alert}
                    onDismiss={onDismiss}
                    onSymbolClick={onSymbolClick}
                    autoDismissTime={getAutoDismissTime(alert.level)}
                />
            ))}
        </div>
    );
}

interface AlertCardProps {
    alert: AlertRecord;
    onDismiss: (id: string) => void;
    onSymbolClick?: (symbol: string) => void;
    autoDismissTime: number;
}

function AlertCard({ alert, onDismiss, onSymbolClick, autoDismissTime }: AlertCardProps) {
    // Auto dismiss
    React.useEffect(() => {
        const timer = setTimeout(() => {
            onDismiss(alert.id);
        }, autoDismissTime);
        return () => clearTimeout(timer);
    }, [alert.id, autoDismissTime, onDismiss]);

    const handleClick = () => {
        if (onSymbolClick) {
            onSymbolClick(alert.symbol);
        }
    };

    const getLevelEmoji = (level: AlertLevel): string => {
        switch (level) {
            case 'info': return '🔵';
            case 'warning': return '🟡';
            case 'critical': return '🔴';
        }
    };

    const getLevelText = (level: AlertLevel): string => {
        switch (level) {
            case 'info': return '信息';
            case 'warning': return '警示';
            case 'critical': return '紧急';
        }
    };

    const typeText = alert.type === 'price' ? '价格' : '持仓金额';
    const cleanSymbol = alert.symbol.replace('USDT', '');

    // 计算时间窗口
    const getTimeWindow = (): string => {
        if (!alert.baseTimestamp) return '';
        const diffMs = alert.timestamp - alert.baseTimestamp;
        const diffMin = Math.floor(diffMs / 60000);
        if (diffMin < 60) return `${diffMin}分钟`;
        const hours = Math.floor(diffMin / 60);
        const mins = diffMin % 60;
        return mins > 0 ? `${hours}小时${mins}分` : `${hours}小时`;
    };

    // 获取触发时间
    const getTriggerTime = (): string => {
        const date = new Date(alert.timestamp);
        return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    };

    return (
        <div
            className={`${styles.card} ${styles[alert.level]}`}
            onClick={handleClick}
        >
            <div className={styles.header}>
                <div className={styles.levelBadge}>
                    <span className={styles.emoji}>{getLevelEmoji(alert.level)}</span>
                    <span className={styles.levelText}>{getLevelText(alert.level)}</span>
                </div>
                <button
                    className={styles.closeBtn}
                    onClick={(e) => {
                        e.stopPropagation();
                        onDismiss(alert.id);
                    }}
                >
                    <X size={16} />
                </button>
            </div>

            <div className={styles.content}>
                <div className={styles.symbol}>
                    {cleanSymbol} <span className={styles.price}>{alert.type === 'price' ? alert.currentValue.toFixed(alert.currentValue < 1 ? 4 : 2) : ''}</span> <span className={styles.perp}>PERP</span>
                </div>
                <div className={styles.typeLabel}>{typeText}{alert.direction === 'up' ? '异动' : '暴跌'}</div>
                <div className={styles.change}>
                    {alert.direction === 'up' ? '+' : ''}{alert.changePercent.toFixed(2)}%
                </div>
                {alert.baseTimestamp && (
                    <div className={styles.timeInfo}>
                        <span className={styles.timeWindow}>{getTimeWindow()}内</span>
                        <span className={styles.triggerTime}>{getTriggerTime()}</span>
                    </div>
                )}
            </div>

            <div className={styles.progress} style={{ animationDuration: `${autoDismissTime}ms` }} />
        </div>
    );
}
