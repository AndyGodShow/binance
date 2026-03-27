"use client";

import { DataQualityMetrics, getDataQualityLevel } from '@/lib/dataQuality';
import styles from './DataQualityCard.module.css';

interface DataQualityCardProps {
    metrics: DataQualityMetrics;
}

export default function DataQualityCard({ metrics }: DataQualityCardProps) {
    const quality = getDataQualityLevel(metrics.dataQualityScore);

    return (
        <div className={styles.container}>
            <div className={styles.header}>
                <h3>📊 数据质量</h3>
            </div>

            {/* 综合评分 */}
            <div className={styles.scoreSection}>
                <div className={styles.scoreCircle} style={{ borderColor: quality.color }}>
                    <span className={styles.scoreValue} style={{ color: quality.color }}>
                        {metrics.dataQualityScore.toFixed(0)}
                    </span>
                    <span className={styles.scoreLabel}>分</span>
                </div>
                <div className={styles.scoreInfo}>
                    <span className={styles.emoji}>{quality.emoji}</span>
                    <span className={styles.level} style={{ color: quality.color }}>
                        {quality.label}
                    </span>
                </div>
            </div>

            {/* 详细指标 */}
            <div className={styles.metrics}>
                <div className={styles.metricRow}>
                    <span className={styles.metricLabel}>OI覆盖率</span>
                    <div className={styles.metricValue}>
                        <div className={styles.progressBar}>
                            <div
                                className={styles.progressFill}
                                style={{
                                    width: `${metrics.oiCoverage}%`,
                                    backgroundColor: metrics.oiCoverage >= 80 ? '#22c55e' : metrics.oiCoverage >= 50 ? '#f59e0b' : '#ef4444'
                                }}
                            />
                        </div>
                        <span>{metrics.oiCoverage.toFixed(1)}%</span>
                    </div>
                </div>

                <div className={styles.metricRow}>
                    <span className={styles.metricLabel}>资金费率覆盖</span>
                    <div className={styles.metricValue}>
                        <div className={styles.progressBar}>
                            <div
                                className={styles.progressFill}
                                style={{
                                    width: `${metrics.fundingCoverage}%`,
                                    backgroundColor: metrics.fundingCoverage >= 80 ? '#22c55e' : metrics.fundingCoverage >= 50 ? '#f59e0b' : '#ef4444'
                                }}
                            />
                        </div>
                        <span>{metrics.fundingCoverage.toFixed(1)}%</span>
                    </div>
                </div>

                <div className={styles.metricRow}>
                    <span className={styles.metricLabel}>真实数据</span>
                    <div className={styles.metricValue}>
                        <span>{metrics.realDataPoints} / {metrics.totalDataPoints} 条</span>
                    </div>
                </div>

                <div className={styles.metricRow}>
                    <span className={styles.metricLabel}>模拟数据占比</span>
                    <div className={styles.metricValue}>
                        <span className={metrics.simulatedDataRatio > 50 ? styles.warning : ''}>
                            {metrics.simulatedDataRatio.toFixed(1)}%
                        </span>
                    </div>
                </div>
            </div>

            {/* 建议操作 */}
            {metrics.dataQualityScore < 60 && (
                <div className={styles.suggestion}>
                    <span className={styles.suggestionIcon}>⚠️</span>
                    <span className={styles.suggestionText}>
                        数据质量较低。长周期回测会自动检查并补齐本地历史数据，补齐后重新回测结果会更可靠。
                    </span>
                </div>
            )}
        </div>
    );
}
