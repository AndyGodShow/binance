"use client";

import React from 'react';
import { ScheduledAlertRecord } from '@/lib/types';
import { X, TrendingUp, TrendingDown } from 'lucide-react';
import styles from './ScheduledAlertCard.module.css';

interface ScheduledAlertCardProps {
    alert: ScheduledAlertRecord;
    onDismiss: (id: string) => void;
}

export default function ScheduledAlertCard({ alert, onDismiss }: ScheduledAlertCardProps) {
    // Auto dismiss after 15 seconds
    React.useEffect(() => {
        const timer = setTimeout(() => {
            onDismiss(alert.id);
        }, 15000);
        return () => clearTimeout(timer);
    }, [alert.id, onDismiss]);

    const formatTime = (): string => {
        const date = new Date(alert.timestamp);
        return date.toLocaleTimeString('zh-CN', {
            hour: '2-digit',
            minute: '2-digit'
        });
    };

    return (
        <div className={styles.card}>
            <div className={styles.header}>
                <div className={styles.titleArea}>
                    <span className={styles.icon}>📊</span>
                    <h3 className={styles.title}>资金费率排名</h3>
                </div>
                <div className={styles.headerRight}>
                    <span className={styles.time}>{formatTime()}</span>
                    <button
                        className={styles.closeBtn}
                        onClick={() => onDismiss(alert.id)}
                    >
                        <X size={16} />
                    </button>
                </div>
            </div>

            <div className={styles.content}>
                {/* 正费率 TOP3 */}
                <div className={styles.section}>
                    <div className={styles.sectionHeader}>
                        <TrendingUp size={16} className={styles.trendingUp} />
                        <h4>正费率 TOP3</h4>
                    </div>
                    <div className={styles.list}>
                        {alert.topPositive.map((item, index) => (
                            <div key={item.symbol} className={styles.item}>
                                <div className={styles.rank}>{index + 1}</div>
                                <div className={styles.symbol}>
                                    {item.symbol.replace('USDT', '')}
                                </div>
                                <div className={`${styles.rate} ${styles.positive}`}>
                                    +{(item.fundingRate * 100).toFixed(4)}%
                                </div>
                            </div>
                        ))}
                    </div>
                </div>

                {/* 负费率 TOP3 */}
                <div className={styles.section}>
                    <div className={styles.sectionHeader}>
                        <TrendingDown size={16} className={styles.trendingDown} />
                        <h4>负费率 TOP3</h4>
                    </div>
                    <div className={styles.list}>
                        {alert.topNegative.map((item, index) => (
                            <div key={item.symbol} className={styles.item}>
                                <div className={styles.rank}>{index + 1}</div>
                                <div className={styles.symbol}>
                                    {item.symbol.replace('USDT', '')}
                                </div>
                                <div className={`${styles.rate} ${styles.negative}`}>
                                    {(item.fundingRate * 100).toFixed(4)}%
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            </div>

            <div className={styles.progress} style={{ animationDuration: '15000ms' }} />
        </div>
    );
}
