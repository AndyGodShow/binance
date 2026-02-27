"use client";

import { useState } from 'react';
import { historicalDataFetcher, HistoricalDataFetcher } from '@/lib/historicalDataFetcher';
import { KlineData } from '@/app/api/backtest/klines/route';
import styles from './DataFetchTest.module.css';

export default function DataFetchTest() {
    const [symbol, setSymbol] = useState('BTCUSDT');
    const [interval, setInterval] = useState('1h');
    const [preset, setPreset] = useState<'1d' | '7d' | '30d' | '90d' | '180d' | '1y'>('7d');
    const [loading, setLoading] = useState(false);
    const [data, setData] = useState<KlineData[] | null>(null);
    const [error, setError] = useState<string | null>(null);

    const handleFetch = async () => {
        setLoading(true);
        setError(null);
        setData(null);

        try {
            const { startTime, endTime } = HistoricalDataFetcher.getPresetRange(preset);

            const klines = await historicalDataFetcher.fetchRangeData(
                symbol,
                interval,
                startTime,
                endTime
            );

            setData(klines);
        } catch (err) {
            setError(err instanceof Error ? err.message : '获取数据失败');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className={styles.container}>
            <h2>📊 历史数据获取测试</h2>

            <div className={styles.controls}>
                <div className={styles.field}>
                    <label>交易对</label>
                    <input
                        type="text"
                        value={symbol}
                        onChange={(e) => setSymbol(e.target.value.toUpperCase())}
                        placeholder="BTCUSDT"
                    />
                </div>

                <div className={styles.field}>
                    <label>时间周期</label>
                    <select value={interval} onChange={(e) => setInterval(e.target.value)}>
                        <option value="1m">1分钟</option>
                        <option value="5m">5分钟</option>
                        <option value="15m">15分钟</option>
                        <option value="30m">30分钟</option>
                        <option value="1h">1小时</option>
                        <option value="4h">4小时</option>
                        <option value="1d">1天</option>
                    </select>
                </div>

                <div className={styles.field}>
                    <label>时间范围</label>
                    <select value={preset} onChange={(e) => setPreset(e.target.value as any)}>
                        <option value="1d">最近1天</option>
                        <option value="7d">最近7天</option>
                        <option value="30d">最近30天</option>
                        <option value="90d">最近90天</option>
                        <option value="180d">最近180天</option>
                        <option value="1y">最近1年</option>
                    </select>
                </div>

                <button
                    className={styles.fetchBtn}
                    onClick={handleFetch}
                    disabled={loading}
                >
                    {loading ? '获取中...' : '获取数据'}
                </button>
            </div>

            {error && (
                <div className={styles.error}>
                    ❌ {error}
                </div>
            )}

            {data && (
                <div className={styles.result}>
                    <h3>✅ 成功获取 {data.length} 条K线数据</h3>

                    <div className={styles.stats}>
                        <div className={styles.stat}>
                            <span>数据条数</span>
                            <strong>{data.length}</strong>
                        </div>
                        <div className={styles.stat}>
                            <span>时间跨度</span>
                            <strong>
                                {new Date(data[0].openTime).toLocaleDateString()} - {' '}
                                {new Date(data[data.length - 1].closeTime).toLocaleDateString()}
                            </strong>
                        </div>
                        <div className={styles.stat}>
                            <span>价格区间</span>
                            <strong>
                                ${Math.min(...data.map(d => parseFloat(d.low))).toFixed(2)} -
                                ${Math.max(...data.map(d => parseFloat(d.high))).toFixed(2)}
                            </strong>
                        </div>
                    </div>

                    <div className={styles.preview}>
                        <h4>数据预览（前10条）</h4>
                        <div className={styles.table}>
                            <table className={styles.dataTable}>
                                <thead>
                                    <tr>
                                        <th>时间</th>
                                        <th>开盘</th>
                                        <th>最高</th>
                                        <th>最低</th>
                                        <th>收盘</th>
                                        <th>成交量</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {data.slice(0, 10).map((kline, idx) => (
                                        <tr key={idx}>
                                            <td>{new Date(kline.openTime).toLocaleString()}</td>
                                            <td>${parseFloat(kline.open).toFixed(2)}</td>
                                            <td className={styles.high}>${parseFloat(kline.high).toFixed(2)}</td>
                                            <td className={styles.low}>${parseFloat(kline.low).toFixed(2)}</td>
                                            <td>${parseFloat(kline.close).toFixed(2)}</td>
                                            <td>{parseFloat(kline.volume).toFixed(2)}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
