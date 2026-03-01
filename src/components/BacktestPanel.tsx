"use client";

import { useState } from 'react';
import { historicalDataFetcher, HistoricalDataFetcher } from '@/lib/historicalDataFetcher';
import { BacktestEngine, BacktestResult, BacktestConfig } from '@/lib/backtestEngine';
import { KlineData } from '@/app/api/backtest/klines/route';
import { strategyRegistry } from '@/strategies/registry';
import { TickerData } from '@/lib/types';
import { logger } from '@/lib/logger';
import { calculateDataQuality, DataQualityMetrics } from '@/lib/dataQuality';
import { StrategyRiskConfig, DEFAULT_RISK_CONFIGS } from '@/lib/risk/riskConfig';
import DataQualityCard from './DataQualityCard';
import RiskConfigPanel from './RiskConfigPanel';
import { EquityCurveChart, DrawdownChart, ProfitDistributionChart, HoldingTimeChart } from './BacktestCharts';
import styles from './BacktestPanel.module.css';

export default function BacktestPanel() {
    const [symbol, setSymbol] = useState('BTCUSDT');
    const [interval, setInterval] = useState('1h');
    const [preset, setPreset] = useState<'1d' | '7d' | '30d' | '90d' | '180d' | '1y'>('30d');
    const [selectedStrategy, setSelectedStrategy] = useState<string>('');
    const [initialCapital, setInitialCapital] = useState(10000);
    const [commission, setCommission] = useState(0.04);
    const [riskConfig, setRiskConfig] = useState<StrategyRiskConfig | null>(null);

    const [loading, setLoading] = useState(false);
    const [result, setResult] = useState<BacktestResult | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [downloadStatus, setDownloadStatus] = useState<string>('');
    const [dataQuality, setDataQuality] = useState<DataQualityMetrics | null>(null);
    const [progress, setProgress] = useState({ current: 0, total: 0 });

    // 获取所有可用策略
    const strategies = strategyRegistry.getAll();

    const handleBacktest = async () => {
        if (!selectedStrategy) {
            setError('请选择一个策略');
            return;
        }

        setLoading(true);
        setError(null);
        setResult(null);
        setDownloadStatus('');

        try {
            // 1. 计算时间范围
            const { startTime, endTime } = HistoricalDataFetcher.getPresetRange(preset);
            const daysDiff = (endTime - startTime) / (24 * 60 * 60 * 1000);
            const startDateStr = new Date(startTime).toISOString().split('T')[0];
            const endDateStr = new Date(endTime).toISOString().split('T')[0];

            // 2. 智能数据完整性检查（对于超过30天的回测）
            if (daysDiff > 30) {
                setDownloadStatus('🔍 检查数据完整性...');

                // 检查 Metrics 和 FundingRate 覆盖率
                const [metricsCoverage, fundingCoverage] = await Promise.all([
                    fetch(`/api/data/download?symbol=${symbol}&type=metrics&startDate=${startDateStr}&endDate=${endDateStr}`)
                        .then(r => r.json()),
                    fetch(`/api/data/download?symbol=${symbol}&type=fundingRate&startDate=${startDateStr}&endDate=${endDateStr}`)
                        .then(r => r.json())
                ]);

                const avgCoverage = (metricsCoverage.coveragePercent + fundingCoverage.coveragePercent) / 2;

                if (avgCoverage < 50) {
                    setDownloadStatus(`📥 数据覆盖率仅 ${avgCoverage.toFixed(0)}%，正在下载历史数据...`);

                    // 触发下载
                    const downloadTypes = ['metrics', 'fundingRate'] as const;
                    await Promise.all(downloadTypes.map(type =>
                        fetch('/api/data/download', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                symbol,
                                type,
                                startDate: startDateStr,
                                endDate: endDateStr
                            })
                        })
                    ));

                    // 给下载一些时间（简化版，实际应该轮询检查）
                    setDownloadStatus('⏳ 数据下载中，请稍候...');
                    await new Promise(r => setTimeout(r, 3000));
                    setDownloadStatus('✅ 数据准备完成');
                } else {
                    setDownloadStatus(`✅ 数据覆盖率 ${avgCoverage.toFixed(0)}%，质量良好`);
                }

                // 清空状态提示
                await new Promise(r => setTimeout(r, 1000));
                setDownloadStatus('');
            }

            // 3. 获取回测数据 (API 会优先读取已下载的本地数据)
            const klines = await historicalDataFetcher.fetchRangeData(
                symbol,
                interval,
                startTime,
                endTime
            );

            if (klines.length === 0) {
                throw new Error('未获取到历史数据');
            }

            // 计算数据质量
            const quality = calculateDataQuality(klines);
            setDataQuality(quality);

            // 4. 获取策略
            const strategy = strategies.find(s => s.id === selectedStrategy);
            if (!strategy) {
                throw new Error('策略不存在');
            }

            // 5. 配置回测引擎（使用策略风控，不用简单%）
            const config: Partial<BacktestConfig> = {
                initialCapital,
                commission,
                slippage: 0.05,
                useStrategyRiskManagement: true, // 始终使用策略级风控
            };

            const engine = new BacktestEngine(config);

            // 6. 运行回测
            const backtestResult = engine.run(
                klines,
                (ticker: TickerData) => {
                    const signal = strategy.detect(ticker);
                    if (!signal) return null;
                    return {
                        signal: signal.direction,
                        confidence: signal.confidence,
                        risk: signal.risk, // 🔥 传递策略风控（多级止盈/跟踪止损/保本）
                    };
                },
                strategy.name,
                symbol,
                interval
            );

            setResult(backtestResult);

            // 如果没有交易，显示提示
            if (backtestResult.totalTrades === 0) {
                setError(`回测完成，但未产生任何交易。这可能是因为：\n1. 策略条件过于严格\n2. 历史数据中没有触发策略的市场条件\n3. 建议尝试更长的回测周期或调整止损止盈参数`);
            }
        } catch (err) {
            logger.error('Backtest failed', err as Error);
            setError(err instanceof Error ? err.message : '回测失败');
        } finally {
            setLoading(false);
        }
    };

    const formatDuration = (ms: number) => {
        const hours = Math.floor(ms / (1000 * 60 * 60));
        const minutes = Math.floor((ms % (1000 * 60 * 60)) / (1000 * 60));
        if (hours > 0) return `${hours}小时${minutes}分钟`;
        return `${minutes}分钟`;
    };

    return (
        <div className={styles.container}>
            <div className={styles.header}>
                <h2>🔬 策略回测</h2>
                <p>使用历史数据测试策略表现</p>
            </div>

            {/* 数据质量卡片 */}
            {dataQuality && (
                <DataQualityCard
                    metrics={dataQuality}
                    onDownloadData={async () => {
                        const { startTime, endTime } = HistoricalDataFetcher.getPresetRange(preset);
                        const startDateStr = new Date(startTime).toISOString().split('T')[0];
                        const endDateStr = new Date(endTime).toISOString().split('T')[0];

                        setDownloadStatus('📥 正在下载历史数据...');
                        try {
                            await Promise.all(['metrics', 'fundingRate'].map(type =>
                                fetch('/api/data/download', {
                                    method: 'POST',
                                    headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify({
                                        symbol,
                                        type,
                                        startDate: startDateStr,
                                        endDate: endDateStr
                                    })
                                })
                            ));
                            setDownloadStatus('✅ 数据下载完成');
                            setTimeout(() => setDownloadStatus(''), 2000);
                        } catch (err) {
                            setDownloadStatus('❌ 下载失败');
                        }
                    }}
                />
            )}

            {/* 配置面板 */}
            <div className={styles.configPanel}>
                <div className={styles.section}>
                    <h3>📊 市场参数</h3>
                    <div className={styles.fields}>
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
                                <option value="5m">5分钟</option>
                                <option value="15m">15分钟</option>
                                <option value="30m">30分钟</option>
                                <option value="1h">1小时</option>
                                <option value="4h">4小时</option>
                                <option value="1d">1天</option>
                            </select>
                        </div>
                        <div className={styles.field}>
                            <label>回测周期</label>
                            <select value={preset} onChange={(e) => setPreset(e.target.value as any)}>
                                <option value="7d">最近7天</option>
                                <option value="30d">最近30天</option>
                                <option value="90d">最近90天</option>
                                <option value="180d">最近180天</option>
                                <option value="1y">最近1年</option>
                            </select>
                        </div>
                    </div>
                </div>

                <div className={styles.section}>
                    <h3>🎯 策略选择</h3>
                    <div className={styles.strategyGrid}>
                        {strategies.map(strategy => (
                            <button
                                key={strategy.id}
                                className={`${styles.strategyBtn} ${selectedStrategy === strategy.id ? styles.active : ''}`}
                                onClick={() => setSelectedStrategy(strategy.id)}
                            >
                                <span className={styles.strategyName}>{strategy.name}</span>
                                <span className={styles.strategyDesc}>{strategy.description}</span>
                            </button>
                        ))}
                    </div>
                </div>

                <div className={styles.section}>
                    <h3>⚙️ 基础参数</h3>
                    <div className={styles.fields}>
                        <div className={styles.field}>
                            <label>初始资金 (USDT)</label>
                            <input
                                type="number"
                                value={initialCapital}
                                onChange={(e) => setInitialCapital(Number(e.target.value))}
                                min="100"
                                step="1000"
                            />
                        </div>
                        <div className={styles.field}>
                            <label>手续费 (%)</label>
                            <input
                                type="number"
                                value={commission}
                                onChange={(e) => setCommission(Number(e.target.value))}
                                min="0"
                                step="0.01"
                            />
                        </div>
                    </div>
                </div>

                {/* 策略风控参数（选择策略后显示） */}
                {selectedStrategy && (
                    <RiskConfigPanel
                        strategyId={selectedStrategy}
                        onChange={setRiskConfig}
                    />
                )}

                <button
                    className={styles.runBtn}
                    onClick={handleBacktest}
                    disabled={loading || !selectedStrategy}
                >
                    {loading && progress.total > 0
                        ? `⏳ 回测中... ${Math.round((progress.current / progress.total) * 100)}%`
                        : loading
                            ? '⏳ 回测中...'
                            : '🚀 开始回测'}
                </button>
            </div>

            {/* 下载状态提示 */}
            {downloadStatus && (
                <div className={styles.info} style={{
                    padding: '16px',
                    marginTop: '16px',
                    background: 'rgba(59, 130, 246, 0.1)',
                    border: '1px solid rgba(59, 130, 246, 0.3)',
                    borderRadius: '8px',
                    color: '#60a5fa'
                }}>
                    {downloadStatus}
                </div>
            )}

            {/* 错误提示 */}
            {error && (
                <div className={styles.error}>
                    ❌ {error}
                </div>
            )}

            {/* 回测结果 */}
            {result && (
                <div className={styles.resultPanel}>
                    <h3>📈 回测结果</h3>

                    {/* 可视化图表 */}
                    <div className={styles.chartsSection}>
                        <EquityCurveChart data={result.equityCurve} trades={result.trades} />
                        <div className={styles.chartsGrid}>
                            <DrawdownChart data={result.equityCurve} />
                            <ProfitDistributionChart trades={result.trades} />
                            <HoldingTimeChart trades={result.trades} />
                        </div>
                    </div>

                    {/* 总览 */}
                    <div className={styles.overview}>
                        <div className={styles.overviewCard}>
                            <span className={styles.label}>总收益</span>
                            <span className={`${styles.value} ${result.totalProfit >= 0 ? styles.positive : styles.negative}`}>
                                {result.totalProfit.toFixed(2)}%
                            </span>
                            <span className={styles.subValue}>
                                {result.totalProfitUSDT >= 0 ? '+' : ''}{result.totalProfitUSDT.toFixed(2)} USDT
                            </span>
                        </div>
                        <div className={styles.overviewCard}>
                            <span className={styles.label}>胜率</span>
                            <span className={styles.value}>{result.winRate.toFixed(2)}%</span>
                            <span className={styles.subValue}>
                                {result.winningTrades}胜 / {result.losingTrades}负
                            </span>
                        </div>
                        <div className={styles.overviewCard}>
                            <span className={styles.label}>最大回撤</span>
                            <span className={`${styles.value} ${styles.negative}`}>
                                {result.maxDrawdown.toFixed(2)}%
                            </span>
                        </div>
                        <div className={styles.overviewCard}>
                            <span className={styles.label}>盈亏比</span>
                            <span className={styles.value}>{result.profitFactor.toFixed(2)}</span>
                        </div>
                        <div className={styles.overviewCard}>
                            <span className={styles.label}>Sortino比率</span>
                            <span className={styles.value}>{result.sortinoRatio.toFixed(2)}</span>
                        </div>
                        <div className={styles.overviewCard}>
                            <span className={styles.label}>Calmar比率</span>
                            <span className={styles.value}>{result.calmarRatio.toFixed(2)}</span>
                        </div>
                    </div>

                    {/* 详细指标 */}
                    <div className={styles.metricsGrid}>
                        <div className={styles.metric}>
                            <span>总交易次数</span>
                            <strong>{result.totalTrades}</strong>
                        </div>
                        <div className={styles.metric}>
                            <span>平均盈亏</span>
                            <strong className={result.averageProfit >= 0 ? styles.positive : styles.negative}>
                                {result.averageProfit.toFixed(2)}%
                            </strong>
                        </div>
                        <div className={styles.metric}>
                            <span>平均盈利</span>
                            <strong className={styles.positive}>{result.averageWin.toFixed(2)}%</strong>
                        </div>
                        <div className={styles.metric}>
                            <span>平均亏损</span>
                            <strong className={styles.negative}>{result.averageLoss.toFixed(2)}%</strong>
                        </div>
                        <div className={styles.metric}>
                            <span>最大盈利</span>
                            <strong className={styles.positive}>{result.largestWin.toFixed(2)}%</strong>
                        </div>
                        <div className={styles.metric}>
                            <span>最大亏损</span>
                            <strong className={styles.negative}>{result.largestLoss.toFixed(2)}%</strong>
                        </div>
                        <div className={styles.metric}>
                            <span>夏普比率</span>
                            <strong>{result.sharpeRatio.toFixed(2)}</strong>
                        </div>
                        <div className={styles.metric}>
                            <span>平均持仓</span>
                            <strong>{formatDuration(result.averageHoldingTime)}</strong>
                        </div>
                        <div className={styles.metric}>
                            <span>期望值</span>
                            <strong className={result.expectancy >= 0 ? styles.positive : styles.negative}>
                                {result.expectancy.toFixed(2)}%
                            </strong>
                        </div>
                        <div className={styles.metric}>
                            <span>恢复因子</span>
                            <strong>{result.recoveryFactor.toFixed(2)}</strong>
                        </div>
                        <div className={styles.metric}>
                            <span>最大连续盈利</span>
                            <strong className={styles.positive}>{result.maxConsecutiveWins} 笔</strong>
                        </div>
                        <div className={styles.metric}>
                            <span>最大连续亏损</span>
                            <strong className={styles.negative}>{result.maxConsecutiveLosses} 笔</strong>
                        </div>
                    </div>

                    {/* 交易记录 */}
                    <div className={styles.tradesSection}>
                        <h4>📝 交易记录（最近20笔）</h4>
                        <div className={styles.tableWrapper}>
                            <table className={styles.tradesTable}>
                                <thead>
                                    <tr>
                                        <th>方向</th>
                                        <th>开仓时间</th>
                                        <th>平仓时间</th>
                                        <th>开仓价</th>
                                        <th>平仓价</th>
                                        <th>盈亏</th>
                                        <th>持仓时间</th>
                                        <th>平仓原因</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {result.trades.slice(-20).reverse().map((trade, idx) => (
                                        <tr key={idx}>
                                            <td>
                                                <span className={trade.direction === 'long' ? styles.long : styles.short}>
                                                    {trade.direction === 'long' ? '做多' : '做空'}
                                                </span>
                                            </td>
                                            <td>{new Date(trade.entryTime).toLocaleString()}</td>
                                            <td>{new Date(trade.exitTime).toLocaleString()}</td>
                                            <td>${trade.entryPrice.toFixed(2)}</td>
                                            <td>${trade.exitPrice.toFixed(2)}</td>
                                            <td className={trade.profit >= 0 ? styles.positive : styles.negative}>
                                                {trade.profit >= 0 ? '+' : ''}{trade.profit.toFixed(2)}%
                                            </td>
                                            <td>{formatDuration(trade.holdingTime)}</td>
                                            <td>
                                                {trade.exitReason === 'stop_loss' ? '止损' :
                                                    trade.exitReason === 'take_profit' ? '止盈' :
                                                        trade.exitReason === 'signal' ? '反向信号' : '结束'}
                                            </td>
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
