"use client";

import {
    LineChart,
    Line,
    AreaChart,
    Area,
    BarChart,
    Bar,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip,
    Legend,
    ResponsiveContainer,
    ReferenceLine,
} from 'recharts';
import { EquityPoint, Trade } from '@/lib/backtestEngine';
import styles from './BacktestCharts.module.css';

interface EquityCurveChartProps {
    data: EquityPoint[];
    trades: Trade[];
}

export function EquityCurveChart({ data, trades }: EquityCurveChartProps) {
    if (data.length === 0) return null;

    // 格式化数据
    const chartData = data.map(point => ({
        time: new Date(point.time).toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' }),
        timestamp: point.time,
        equity: point.equity,
        drawdown: -point.drawdown, // 负值用于显示
    }));

    // 找出最大盈利和最大亏损的交易
    const maxWinTrade = trades.reduce((max, t) => t.profit > max.profit ? t : max, trades[0]);
    const maxLossTrade = trades.reduce((min, t) => t.profit < min.profit ? t : min, trades[0]);

    return (
        <div className={styles.chartContainer}>
            <h4>📈 资金曲线</h4>
            <ResponsiveContainer width="100%" height={300}>
                <LineChart data={chartData} margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.1)" />
                    <XAxis
                        dataKey="time"
                        stroke="rgba(255,255,255,0.5)"
                        style={{ fontSize: 12 }}
                    />
                    <YAxis
                        stroke="rgba(255,255,255,0.5)"
                        style={{ fontSize: 12 }}
                        label={{ value: '权益 (%)', angle: -90, position: 'insideLeft', fill: 'rgba(255,255,255,0.7)' }}
                    />
                    <Tooltip
                        contentStyle={{
                            background: 'rgba(30, 30, 46, 0.95)',
                            border: '1px solid rgba(255,255,255,0.2)',
                            borderRadius: '8px',
                            color: '#fff'
                        }}
                        formatter={(value: number | undefined) => value !== undefined ? [`${value.toFixed(2)}%`, '权益'] : ['', '']}
                    />
                    <Legend wrapperStyle={{ color: '#fff' }} />
                    <ReferenceLine y={100} stroke="rgba(255,255,255,0.3)" strokeDasharray="3 3" />
                    <Line
                        type="monotone"
                        dataKey="equity"
                        stroke="#22c55e"
                        strokeWidth={2}
                        dot={false}
                        name="权益曲线"
                        animationDuration={1000}
                    />
                </LineChart>
            </ResponsiveContainer>
        </div>
    );
}

interface DrawdownChartProps {
    data: EquityPoint[];
}

export function DrawdownChart({ data }: DrawdownChartProps) {
    if (data.length === 0) return null;

    const chartData = data.map(point => ({
        time: new Date(point.time).toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' }),
        drawdown: -point.drawdown,
    }));

    return (
        <div className={styles.chartContainer}>
            <h4>📉 回撤曲线</h4>
            <ResponsiveContainer width="100%" height={200}>
                <AreaChart data={chartData} margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.1)" />
                    <XAxis
                        dataKey="time"
                        stroke="rgba(255,255,255,0.5)"
                        style={{ fontSize: 12 }}
                    />
                    <YAxis
                        stroke="rgba(255,255,255,0.5)"
                        style={{ fontSize: 12 }}
                        label={{ value: '回撤 (%)', angle: -90, position: 'insideLeft', fill: 'rgba(255,255,255,0.7)' }}
                    />
                    <Tooltip
                        contentStyle={{
                            background: 'rgba(30, 30, 46, 0.95)',
                            border: '1px solid rgba(255,255,255,0.2)',
                            borderRadius: '8px',
                            color: '#fff'
                        }}
                        formatter={(value: number | undefined) => value !== undefined ? [`${value.toFixed(2)}%`, '回撤'] : ['', '']}
                    />
                    <Area
                        type="monotone"
                        dataKey="drawdown"
                        stroke="#ef4444"
                        fill="#ef4444"
                        fillOpacity={0.3}
                        name="回撤"
                        animationDuration={1000}
                    />
                </AreaChart>
            </ResponsiveContainer>
        </div>
    );
}

interface ProfitDistributionChartProps {
    trades: Trade[];
}

export function ProfitDistributionChart({ trades }: ProfitDistributionChartProps) {
    if (trades.length === 0) return null;

    // 创建盈亏区间
    const bins = [
        { range: '< -10%', min: -Infinity, max: -10, count: 0 },
        { range: '-10% ~ -5%', min: -10, max: -5, count: 0 },
        { range: '-5% ~ 0%', min: -5, max: 0, count: 0 },
        { range: '0% ~ 5%', min: 0, max: 5, count: 0 },
        { range: '5% ~ 10%', min: 5, max: 10, count: 0 },
        { range: '> 10%', min: 10, max: Infinity, count: 0 },
    ];

    trades.forEach(trade => {
        const profit = trade.profit;
        const bin = bins.find(b => profit >= b.min && profit < b.max);
        if (bin) bin.count++;
    });

    const chartData = bins.map(bin => ({
        range: bin.range,
        count: bin.count,
        fill: bin.min >= 0 ? '#22c55e' : '#ef4444',
    }));

    return (
        <div className={styles.chartContainer}>
            <h4>📊 盈亏分布</h4>
            <ResponsiveContainer width="100%" height={250}>
                <BarChart data={chartData} margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.1)" />
                    <XAxis
                        dataKey="range"
                        stroke="rgba(255,255,255,0.5)"
                        style={{ fontSize: 11 }}
                    />
                    <YAxis
                        stroke="rgba(255,255,255,0.5)"
                        style={{ fontSize: 12 }}
                        label={{ value: '交易次数', angle: -90, position: 'insideLeft', fill: 'rgba(255,255,255,0.7)' }}
                    />
                    <Tooltip
                        contentStyle={{
                            background: 'rgba(30, 30, 46, 0.95)',
                            border: '1px solid rgba(255,255,255,0.2)',
                            borderRadius: '8px',
                            color: '#fff'
                        }}
                        formatter={(value: number | undefined) => value !== undefined ? [`${value} 笔`, '交易'] : ['', '']}
                    />
                    <Bar dataKey="count" name="交易次数" animationDuration={1000}>
                        {chartData.map((entry, index) => (
                            <rect key={`cell-${index}`} fill={entry.fill} />
                        ))}
                    </Bar>
                </BarChart>
            </ResponsiveContainer>
        </div>
    );
}

interface HoldingTimeChartProps {
    trades: Trade[];
}

export function HoldingTimeChart({ trades }: HoldingTimeChartProps) {
    if (trades.length === 0) return null;

    // 按持仓时间分类
    const categories = [
        { label: '< 1h', min: 0, max: 3600000, count: 0 },
        { label: '1-4h', min: 3600000, max: 14400000, count: 0 },
        { label: '4-12h', min: 14400000, max: 43200000, count: 0 },
        { label: '12-24h', min: 43200000, max: 86400000, count: 0 },
        { label: '> 24h', min: 86400000, max: Infinity, count: 0 },
    ];

    trades.forEach(trade => {
        const category = categories.find(c => trade.holdingTime >= c.min && trade.holdingTime < c.max);
        if (category) category.count++;
    });

    const chartData = categories.map(cat => ({
        label: cat.label,
        count: cat.count,
        percentage: ((cat.count / trades.length) * 100).toFixed(1),
    }));

    return (
        <div className={styles.chartContainer}>
            <h4>⏱️ 持仓时间分布</h4>
            <ResponsiveContainer width="100%" height={250}>
                <BarChart data={chartData} margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.1)" />
                    <XAxis
                        dataKey="label"
                        stroke="rgba(255,255,255,0.5)"
                        style={{ fontSize: 12 }}
                    />
                    <YAxis
                        stroke="rgba(255,255,255,0.5)"
                        style={{ fontSize: 12 }}
                        label={{ value: '交易次数', angle: -90, position: 'insideLeft', fill: 'rgba(255,255,255,0.7)' }}
                    />
                    <Tooltip
                        contentStyle={{
                            background: 'rgba(30, 30, 46, 0.95)',
                            border: '1px solid rgba(255,255,255,0.2)',
                            borderRadius: '8px',
                            color: '#fff'
                        }}
                        formatter={((value: any, name: any, props: any) => {
                            if (!value) return ['', ''];
                            return [`${value} 笔 (${props.payload?.percentage || 0}%)`, '交易'];
                        }) as any}
                    />
                    <Bar dataKey="count" fill="#3b82f6" name="交易次数" animationDuration={1000} />
                </BarChart>
            </ResponsiveContainer>
        </div>
    );
}
