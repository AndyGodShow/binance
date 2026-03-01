"use client";

import { useMemo } from 'react';
import {
    BarChart,
    Bar,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip,
    ResponsiveContainer,
    ReferenceLine,
    Cell,
} from 'recharts';
import { TakerVolumeEntry } from '@/lib/types';
import styles from './LongShortPanel.module.css';

interface TakerVolumeChartProps {
    title: string;
    subtitle: string;
    data: TakerVolumeEntry[];
    period: string;
}

function formatTime(ts: number, period: string) {
    const d = new Date(ts);
    if (period === '1d') return `${d.getMonth() + 1}/${d.getDate()}`;
    if (period === '4h') return `${d.getMonth() + 1}/${d.getDate()} ${d.getHours()}:00`;
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function formatVolume(vol: number): string {
    if (vol >= 1e9) return `${(vol / 1e9).toFixed(2)}B`;
    if (vol >= 1e6) return `${(vol / 1e6).toFixed(2)}M`;
    if (vol >= 1e3) return `${(vol / 1e3).toFixed(1)}K`;
    return vol.toFixed(0);
}

export default function TakerVolumeChart({ title, subtitle, data, period }: TakerVolumeChartProps) {
    const currentRatio = data.length > 0 ? data[data.length - 1].ratio : 0;
    const currentBuy = data.length > 0 ? data[data.length - 1].buyVol : 0;
    const currentSell = data.length > 0 ? data[data.length - 1].sellVol : 0;
    const isBuyDominant = currentRatio >= 1;

    const trend = useMemo(() => {
        if (data.length < 2) return 0;
        return data[data.length - 1].ratio - data[data.length - 2].ratio;
    }, [data]);

    const chartData = useMemo(() =>
        data.map(d => ({
            time: formatTime(d.ts, period),
            // Net = buy - sell (positive = buy dominant, negative = sell dominant)
            net: d.buyVol - d.sellVol,
            ratio: d.ratio,
            buyVol: d.buyVol,
            sellVol: d.sellVol,
        })),
        [data, period]
    );

    // Calculate buy percentage for stacked bar
    const totalVol = currentBuy + currentSell;
    const buyPct = totalVol > 0 ? (currentBuy / totalVol) * 100 : 50;
    const sellPct = totalVol > 0 ? (currentSell / totalVol) * 100 : 50;

    return (
        <div className={styles.chartCard}>
            {/* Header */}
            <div className={styles.chartHeader}>
                <div>
                    <h3 className={styles.chartTitle}>{title}</h3>
                    <p className={styles.chartSubtitle}>{subtitle}</p>
                </div>
                <div className={styles.accentDot} style={{ background: '#3B82F6' }} />
            </div>

            {/* Ratio Display */}
            <div className={styles.ratioSection}>
                <div className={styles.ratioValue} style={{ color: isBuyDominant ? 'var(--green)' : 'var(--red)' }}>
                    {currentRatio.toFixed(4)}
                    <span className={styles.trendArrow}>
                        {trend > 0 ? '▲' : trend < 0 ? '▼' : '—'}
                    </span>
                </div>
                <div className={styles.ratioPcts}>
                    <span className={styles.longPct}>
                        买 {formatVolume(currentBuy)}
                    </span>
                    <span className={styles.vsText}>vs</span>
                    <span className={styles.shortPct}>
                        卖 {formatVolume(currentSell)}
                    </span>
                </div>
            </div>

            {/* Stacked Bar */}
            <div className={styles.stackedBar}>
                <div className={styles.longBar} style={{ width: `${buyPct}%` }}>
                    {buyPct.toFixed(1)}%
                </div>
                <div className={styles.shortBar} style={{ width: `${sellPct}%` }}>
                    {sellPct.toFixed(1)}%
                </div>
            </div>

            {/* Net Volume Bar Chart */}
            <div className={styles.chartContainer}>
                <ResponsiveContainer width="100%" height={200}>
                    <BarChart data={chartData} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
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
                            tickFormatter={(v: number) => formatVolume(Math.abs(v))}
                        />
                        <Tooltip
                            contentStyle={{
                                background: '#1E2329',
                                border: '1px solid #2B3139',
                                borderRadius: 8,
                                fontSize: 12,
                                color: '#EAECEF',
                            }}
                            // eslint-disable-next-line @typescript-eslint/no-explicit-any
                            formatter={((value: any, _name: any, payload: any) => {
                                const d = payload.payload;
                                return [
                                    `买: ${formatVolume(d.buyVol)} / 卖: ${formatVolume(d.sellVol)}`,
                                    '净量'
                                ];
                            }) as any}
                            labelStyle={{ color: '#848E9C' }}
                        />
                        <ReferenceLine y={0} stroke="#474D57" />
                        <Bar
                            dataKey="net"
                            radius={[2, 2, 0, 0]}
                            animationDuration={600}
                        >
                            {chartData.map((entry, index) => (
                                <Cell
                                    key={`cell-${index}`}
                                    fill={entry.net >= 0 ? 'rgba(14,203,129,0.7)' : 'rgba(246,70,93,0.7)'}
                                />
                            ))}
                        </Bar>
                    </BarChart>
                </ResponsiveContainer>
            </div>
        </div>
    );
}
