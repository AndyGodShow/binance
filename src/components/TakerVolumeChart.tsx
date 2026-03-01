"use client";

import { useMemo } from 'react';
import {
    ComposedChart,
    Bar,
    Line,
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
    const abs = Math.abs(vol);
    if (abs >= 1e9) return `${(vol / 1e9).toFixed(2)}B`;
    if (abs >= 1e6) return `${(vol / 1e6).toFixed(2)}M`;
    if (abs >= 1e3) return `${(vol / 1e3).toFixed(1)}K`;
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

    // Build chart data with net volume + CVD
    const chartData = useMemo(() => {
        let cvd = 0;
        return data.map(d => {
            const net = d.buyVol - d.sellVol;
            cvd += net;
            return {
                time: formatTime(d.ts, period),
                net,
                cvd,
                ratio: d.ratio,
                buyVol: d.buyVol,
                sellVol: d.sellVol,
            };
        });
    }, [data, period]);

    const lastCvd = chartData.length > 0 ? chartData[chartData.length - 1].cvd : 0;

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

            {/* Ratio + CVD Display */}
            <div className={styles.ratioSection}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: '16px' }}>
                    <div className={styles.ratioValue} style={{ color: isBuyDominant ? 'var(--green)' : 'var(--red)' }}>
                        {currentRatio.toFixed(4)}
                        <span className={styles.trendArrow}>
                            {trend > 0 ? '▲' : trend < 0 ? '▼' : '—'}
                        </span>
                    </div>
                    <div style={{ fontSize: 13, fontWeight: 600, color: lastCvd >= 0 ? 'var(--green)' : 'var(--red)', fontFamily: "'Roboto Mono', monospace" }}>
                        CVD {formatVolume(lastCvd)}
                    </div>
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

            {/* Combo Chart: Net Volume Bars + CVD Line */}
            <div className={styles.chartContainer}>
                <ResponsiveContainer width="100%" height={200}>
                    <ComposedChart data={chartData} margin={{ top: 8, right: 40, left: -10, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="rgba(43,49,57,0.6)" />
                        <XAxis
                            dataKey="time"
                            tick={{ fontSize: 10, fill: '#848E9C' }}
                            tickLine={false}
                            axisLine={{ stroke: '#2B3139' }}
                            interval="preserveStartEnd"
                        />
                        {/* Left Y: Net Volume (Bars) */}
                        <YAxis
                            yAxisId="net"
                            tick={{ fontSize: 10, fill: '#848E9C' }}
                            tickLine={false}
                            axisLine={false}
                            tickFormatter={(v: number) => formatVolume(v)}
                        />
                        {/* Right Y: CVD (Line) */}
                        <YAxis
                            yAxisId="cvd"
                            orientation="right"
                            tick={{ fontSize: 10, fill: '#F0B90B' }}
                            tickLine={false}
                            axisLine={false}
                            tickFormatter={(v: number) => formatVolume(v)}
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
                            formatter={((value: any, name: any) => {
                                if (name === 'net') return [`${formatVolume(Number(value))}`, '净买入量'];
                                if (name === 'cvd') return [`${formatVolume(Number(value))}`, 'CVD 累计'];
                                return [value, name];
                            }) as any}
                            labelStyle={{ color: '#848E9C' }}
                        />
                        <ReferenceLine yAxisId="net" y={0} stroke="#474D57" />
                        {/* Net Volume Bars */}
                        <Bar
                            yAxisId="net"
                            dataKey="net"
                            radius={[2, 2, 2, 2]}
                            animationDuration={600}
                            barSize={12}
                        >
                            {chartData.map((entry, index) => (
                                <Cell
                                    key={`cell-${index}`}
                                    fill={entry.net >= 0 ? 'rgba(14,203,129,0.6)' : 'rgba(246,70,93,0.6)'}
                                />
                            ))}
                        </Bar>
                        {/* CVD Cumulative Line */}
                        <Line
                            yAxisId="cvd"
                            type="monotone"
                            dataKey="cvd"
                            stroke="#F0B90B"
                            strokeWidth={2}
                            dot={false}
                            activeDot={{ r: 4, fill: '#F0B90B', stroke: '#1E2329', strokeWidth: 2 }}
                            animationDuration={600}
                        />
                    </ComposedChart>
                </ResponsiveContainer>
            </div>
        </div>
    );
}
