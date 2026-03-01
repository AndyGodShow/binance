"use client";

import { useState, useMemo, useCallback } from 'react';
import useSWR from 'swr';
import { LongShortData } from '@/lib/types';
import { usePageVisibility } from '@/hooks/usePageVisibility';
import LongShortChart from './LongShortChart';
import TakerVolumeChart from './TakerVolumeChart';
import styles from './LongShortPanel.module.css';

const fetcher = (url: string) => fetch(url).then(r => r.json());

const SYMBOLS = [
    { label: 'BTC', value: 'BTCUSDT' },
    { label: 'ETH', value: 'ETHUSDT' },
    { label: 'SOL', value: 'SOLUSDT' },
    { label: 'XRP', value: 'XRPUSDT' },
    { label: 'DOGE', value: 'DOGEUSDT' },
    { label: 'BNB', value: 'BNBUSDT' },
    { label: 'HYPE', value: 'HYPEUSDT' },
    { label: 'ZEC', value: 'ZECUSDT' },
];

const PERIODS = [
    { label: '5m', value: '5m' },
    { label: '15m', value: '15m' },
    { label: '1h', value: '1h' },
    { label: '4h', value: '4h' },
    { label: '1d', value: '1d' },
];

export default function LongShortPanel() {
    const [symbol, setSymbol] = useState('BTCUSDT');
    const [period, setPeriod] = useState('1h');
    const isVisible = usePageVisibility();

    // Smart refresh: 30s when visible, slower when hidden
    const refreshInterval = isVisible ? 30000 : 120000;

    const apiUrl = useMemo(
        () => `/api/longshort?symbol=${symbol}&period=${period}&limit=30`,
        [symbol, period]
    );

    const { data, isLoading, error } = useSWR<LongShortData>(apiUrl, fetcher, {
        refreshInterval,
        revalidateOnFocus: true,
        dedupingInterval: 10000,
    });

    const handleSymbol = useCallback((val: string) => setSymbol(val), []);
    const handlePeriod = useCallback((val: string) => setPeriod(val), []);

    const symbolLabel = SYMBOLS.find(s => s.value === symbol)?.label || '';

    return (
        <div className={styles.panel}>
            {/* Control Bar */}
            <div className={styles.controlBar}>
                <div className={styles.controlSection}>
                    <span className={styles.controlLabel}>币种</span>
                    <div className={styles.chipGroup}>
                        {SYMBOLS.map(s => (
                            <button
                                key={s.value}
                                className={`${styles.chip} ${symbol === s.value ? styles.chipActive : ''}`}
                                onClick={() => handleSymbol(s.value)}
                            >
                                {s.label}
                            </button>
                        ))}
                    </div>
                </div>
                <div className={styles.controlSection}>
                    <span className={styles.controlLabel}>周期</span>
                    <div className={styles.chipGroup}>
                        {PERIODS.map(p => (
                            <button
                                key={p.value}
                                className={`${styles.chip} ${period === p.value ? styles.chipActive : ''}`}
                                onClick={() => handlePeriod(p.value)}
                            >
                                {p.label}
                            </button>
                        ))}
                    </div>
                </div>
                {/* Live indicator */}
                <div className={styles.liveIndicator}>
                    <span className={styles.liveDot} />
                    <span className={styles.liveText}>
                        {isLoading ? '加载中...' : '实时'}
                    </span>
                </div>
            </div>

            {/* Error State */}
            {error && (
                <div className={styles.errorBanner}>
                    ⚠️ 数据加载失败，请稍后重试
                </div>
            )}

            {/* Loading Skeleton */}
            {isLoading && !data && (
                <div className={styles.chartGrid}>
                    {[1, 2, 3].map(i => (
                        <div key={i} className={styles.skeleton}>
                            <div className={styles.skeletonHeader} />
                            <div className={styles.skeletonChart} />
                        </div>
                    ))}
                </div>
            )}

            {/* Chart Grid */}
            {data && (
                <div className={styles.chartGrid}>
                    <LongShortChart
                        title="全市场多空比"
                        subtitle={`${symbolLabel} · 散户情绪风向标`}
                        data={data.global}
                        period={period}
                        accentColor="#FCD535"
                    />
                    <LongShortChart
                        title="大户多空账户比"
                        subtitle={`${symbolLabel} · 聪明钱方向`}
                        data={data.topAccount}
                        period={period}
                        accentColor="#0ECB81"
                    />
                    <LongShortChart
                        title="大户多空持仓比"
                        subtitle={`${symbolLabel} · 仓位集中度`}
                        data={data.topPosition}
                        period={period}
                        accentColor="#F6465D"
                    />
                    <TakerVolumeChart
                        title="主动买卖量"
                        subtitle={`${symbolLabel} · 资金流动方向`}
                        data={data.takerVolume}
                        period={period}
                    />
                </div>
            )}

            {/* Summary Bar */}
            {data && (
                <div className={styles.summaryBar}>
                    <h4 className={styles.summaryTitle}>📊 多空比一览 · {symbolLabel}</h4>
                    <div className={styles.summaryGrid}>
                        <SummaryItem
                            label="全市场"
                            ratio={data.global[data.global.length - 1]?.ratio}
                        />
                        <SummaryItem
                            label="大户账户"
                            ratio={data.topAccount[data.topAccount.length - 1]?.ratio}
                        />
                        <SummaryItem
                            label="大户持仓"
                            ratio={data.topPosition[data.topPosition.length - 1]?.ratio}
                        />
                        <SummaryItem
                            label="主动买卖"
                            ratio={data.takerVolume[data.takerVolume.length - 1]?.ratio}
                        />
                    </div>
                    <p className={styles.summaryHint}>
                        {getSentimentHint(data)}
                    </p>
                </div>
            )}
        </div>
    );
}

function SummaryItem({ label, ratio }: { label: string; ratio?: number }) {
    if (!ratio) return null;
    const isLong = ratio >= 1;
    const longPct = (ratio / (1 + ratio)) * 100;

    return (
        <div className={styles.summaryItem}>
            <span className={styles.summaryLabel}>{label}</span>
            <div className={styles.summaryBarContainer}>
                <div
                    className={styles.summaryLongFill}
                    style={{ width: `${longPct}%` }}
                />
            </div>
            <span
                className={styles.summaryRatio}
                style={{ color: isLong ? 'var(--green)' : 'var(--red)' }}
            >
                {ratio.toFixed(4)}
            </span>
        </div>
    );
}

function getSentimentHint(data: LongShortData): string {
    const g = data.global[data.global.length - 1]?.ratio ?? 1;
    const ta = data.topAccount[data.topAccount.length - 1]?.ratio ?? 1;
    const tp = data.topPosition[data.topPosition.length - 1]?.ratio ?? 1;
    const tv = data.takerVolume[data.takerVolume.length - 1]?.ratio ?? 1;

    const allLong = g > 1 && ta > 1 && tp > 1 && tv > 1;
    const allShort = g < 1 && ta < 1 && tp < 1 && tv < 1;
    const divergence = (g > 1 && tp < 1) || (g < 1 && tp > 1);
    const takerConfirm = (tp > 1 && tv > 1) || (tp < 1 && tv < 1);

    if (allLong) return '🚀 四项指标全部偏多，多头情绪强烈';
    if (allShort) return '🔻 四项指标全部偏空，空头情绪浓厚';
    if (divergence && !takerConfirm) return '⚡ 大户与散户方向分歧，且资金流不确认，注意可能出现剧烈波动';
    if (divergence) return '⚡ 大户与散户方向分歧，注意可能出现方向性行情';
    return '💡 多空力量相对均衡，关注后续变化';
}
