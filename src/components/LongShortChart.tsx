"use client";

import { useMemo } from 'react';
import {
    LineChart,
    Line,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip,
    ResponsiveContainer,
    ReferenceLine,
} from 'recharts';
import { LongShortEntry } from '@/lib/types';
import styles from './LongShortPanel.module.css';

function formatRatioTooltipValue(value: unknown): [string, string] {
    return [`${Number(value ?? 0).toFixed(4)}`, '多空比值'];
}

interface LongShortChartProps {
    title: string;
    subtitle: string;
    data: LongShortEntry[];
    period: string;
    accentColor?: string;
}

function formatTime(ts: number, period: string) {
    const d = new Date(ts);
    if (period === '1d') return `${d.getMonth() + 1}/${d.getDate()}`;
    if (period === '4h') return `${d.getMonth() + 1}/${d.getDate()} ${d.getHours()}:00`;
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export default function LongShortChart({ title, subtitle, data, period, accentColor }: LongShortChartProps) {
    const currentRatio = data.length > 0 ? data[data.length - 1].ratio : 0;
    const currentLong = data.length > 0 ? data[data.length - 1].longPct : 0;
    const currentShort = data.length > 0 ? data[data.length - 1].shortPct : 0;
    const isLong = currentRatio >= 1;

    // Calculate ratio change trend
    const trend = useMemo(() => {
        if (data.length < 2) return 0;
        return data[data.length - 1].ratio - data[data.length - 2].ratio;
    }, [data]);

    const chartData = useMemo(() =>
        data.map(d => ({
            time: formatTime(d.ts, period),
            long: +(d.longPct * 100).toFixed(2),
            short: +(d.shortPct * 100).toFixed(2),
            ratio: d.ratio,
        })),
        [data, period]
    );

    return (
        <div className={styles.chartCard}>
            {/* Header */}
            <div className={styles.chartHeader}>
                <div>
                    <h3 className={styles.chartTitle}>{title}</h3>
                    <p className={styles.chartSubtitle}>{subtitle}</p>
                </div>
                {accentColor && <div className={styles.accentDot} style={{ background: accentColor }} />}
            </div>

            {/* Ratio Display */}
            <div className={styles.ratioSection}>
                <div className={styles.ratioValue} style={{ color: isLong ? 'var(--green)' : 'var(--red)' }}>
                    {currentRatio.toFixed(4)}
                    <span className={styles.trendArrow}>
                        {trend > 0 ? '▲' : trend < 0 ? '▼' : '—'}
                    </span>
                </div>
                <div className={styles.ratioPcts}>
                    <span className={styles.longPct}>
                        多 {(currentLong * 100).toFixed(2)}%
                    </span>
                    <span className={styles.vsText}>vs</span>
                    <span className={styles.shortPct}>
                        空 {(currentShort * 100).toFixed(2)}%
                    </span>
                </div>
            </div>

            {/* Stacked Bar for current position */}
            <div className={styles.stackedBar}>
                <div
                    className={styles.longBar}
                    style={{ width: `${currentLong * 100}%` }}
                >
                    {(currentLong * 100).toFixed(1)}%
                </div>
                <div
                    className={styles.shortBar}
                    style={{ width: `${currentShort * 100}%` }}
                >
                    {(currentShort * 100).toFixed(1)}%
                </div>
            </div>

            {/* Area Chart */}
            <div className={styles.chartContainer}>
                <ResponsiveContainer width="100%" height={200}>
                    <LineChart data={chartData} margin={{ top: 8, right: 8, left: -10, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="rgba(43,49,57,0.6)" />
                        <XAxis
                            dataKey="time"
                            tick={{ fontSize: 10, fill: '#848E9C' }}
                            tickLine={false}
                            axisLine={{ stroke: '#2B3139' }}
                            interval="preserveStartEnd"
                        />
                        <YAxis
                            tick={{ fontSize: 10, fill: '#848E9C' }}
                            tickLine={false}
                            axisLine={false}
                            domain={['auto', 'auto']}
                            tickFormatter={(v: number) => v.toFixed(2)}
                        />
                        <Tooltip
                            contentStyle={{
                                background: '#1E2329',
                                border: '1px solid #2B3139',
                                borderRadius: 8,
                                fontSize: 12,
                                color: '#EAECEF',
                            }}
                            formatter={formatRatioTooltipValue}
                            labelStyle={{ color: '#848E9C' }}
                        />
                        <ReferenceLine y={1} stroke="#F6465D" strokeDasharray="4 4" strokeWidth={1.5} label={{ value: '1.0', position: 'right', fill: '#848E9C', fontSize: 10 }} />
                        <Line
                            type="monotone"
                            dataKey="ratio"
                            stroke="#0ECB81"
                            strokeWidth={2}
                            dot={false}
                            activeDot={{ r: 4, fill: '#0ECB81', stroke: '#1E2329', strokeWidth: 2 }}
                            animationDuration={600}
                        />
                    </LineChart>
                </ResponsiveContainer>
            </div>
        </div>
    );
}
