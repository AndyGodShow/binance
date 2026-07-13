"use client";

import type { Dispatch, SetStateAction } from 'react';
import type { Trade } from '@/lib/backtestEngine';
import type { PortfolioBacktestResult } from '@/lib/portfolioBacktestEngine';
import type { SymbolIssueDetail } from '@/lib/backtestSymbolValidation';
import {
    formatDuration,
    formatProfitFactor,
    formatSignedPercent,
    formatSignedUsdt,
} from '@/lib/backtestPanelSupport';
import { EquityCurveChart, DrawdownChart, ProfitDistributionChart, HoldingTimeChart } from '../BacktestCharts';
import styles from '../BacktestPanel.module.css';
import type { BacktestRunDetail, BatchBacktestItem } from './types';

interface Pagination<T> {
    visibleTrades: T[];
    currentPage: number;
    totalPages: number;
}

interface BacktestResultsProps {
    batchResults: BatchBacktestItem[];
    failedSymbols: string[];
    failedDetails: SymbolIssueDetail[];
    detailRun: BacktestRunDetail | null;
    allRuns: BacktestRunDetail[];
    setDetailRun: Dispatch<SetStateAction<BacktestRunDetail | null>>;
    setDetailTradePage: Dispatch<SetStateAction<number>>;
    portfolioResult: PortfolioBacktestResult | null;
    maxConcurrentPositions: number;
    positionSizePercent: number;
    portfolioPagination: Pagination<Trade> | null;
    setPortfolioTradePage: Dispatch<SetStateAction<number>>;
    detailPagination: Pagination<Trade> | null;
}

export default function BacktestResults({
    batchResults,
    failedSymbols,
    failedDetails,
    detailRun,
    allRuns,
    setDetailRun,
    setDetailTradePage,
    portfolioResult,
    maxConcurrentPositions,
    positionSizePercent,
    portfolioPagination,
    setPortfolioTradePage,
    detailPagination,
}: BacktestResultsProps) {
    return (
        <>
    {batchResults.length > 0 && (
    <div className={styles.resultPanel}>
    <h3>📊 批量回测排名</h3>

    <div className={styles.overview}>
    <div className={styles.overviewCard}>
    <span className={styles.label}>成功币种</span>
    <span className={styles.value}>{batchResults.length}</span>
    <span className={styles.subValue}>
    {failedSymbols.length > 0 ? `失败 ${failedSymbols.length} 个` : '全部成功'}
    </span>
    </div>
    <div className={styles.overviewCard}>
    <span className={styles.label}>最佳币种</span>
    <span className={styles.value}>{batchResults[0]?.symbol}</span>
    <span className={`${styles.subValue} ${(batchResults[0]?.totalProfit ?? 0) >= 0 ? styles.positive : styles.negative}`}>
    {batchResults[0] ? formatSignedPercent(batchResults[0].totalProfit) : '-'}
    </span>
    </div>
    <div className={styles.overviewCard}>
    <span className={styles.label}>有交易币种</span>
    <span className={styles.value}>
    {batchResults.filter((item) => item.totalTrades > 0).length}
    </span>
    <span className={styles.subValue}>按总交易次数大于 0 统计</span>
    </div>
    </div>

    <div className={styles.tradesSection}>
    <h4>🏆 收益排名</h4>
    <div className={styles.tableWrapper}>
    <table className={styles.tradesTable}>
    <thead>
    <tr>
    <th>排名</th>
    <th>币种</th>
    <th>总收益</th>
    <th>收益额</th>
    <th>胜率</th>
    <th>最大回撤</th>
    <th>盈亏比</th>
    <th>交易次数</th>
    </tr>
    </thead>
    <tbody>
    {batchResults.map((item, index) => (
    <tr
    key={item.symbol}
    className={detailRun?.symbol === item.symbol ? styles.selectedRow : ''}
    >
    <td>{index + 1}</td>
    <td>
    <button
    type="button"
    className={styles.linkButton}
    onClick={() => {
    const matchedRun = allRuns[index];
    if (!matchedRun) return;
    setDetailRun(matchedRun);
    setDetailTradePage(1);
    }}
    >
    {item.symbol}
    </button>
    </td>
    <td className={item.totalProfit >= 0 ? styles.positive : styles.negative}>
    {formatSignedPercent(item.totalProfit)}
    </td>
    <td className={item.totalProfitUSDT >= 0 ? styles.positive : styles.negative}>
    {formatSignedUsdt(item.totalProfitUSDT)}
    </td>
    <td>{item.winRate.toFixed(2)}%</td>
    <td className={styles.negative}>{item.maxDrawdown.toFixed(2)}%</td>
    <td>{formatProfitFactor(item.profitFactor, item.totalTrades)}</td>
    <td>{item.totalTrades}</td>
    </tr>
    ))}
    </tbody>
    </table>
    </div>
    </div>

    {failedSymbols.length > 0 && (
    <div className={styles.errorList}>
    失败币种：{failedSymbols.join(', ')}
    {failedDetails.length > 0 && (
    <ul className={styles.issueList}>
    {failedDetails.slice(0, 8).map((item) => (
    <li key={`failed-${item.symbol}`}>
    <strong>{item.symbol}</strong>：{item.reason}
    </li>
    ))}
    {failedDetails.length > 8 && (
    <li>还有 {failedDetails.length - 8} 个失败原因未展示。</li>
    )}
    </ul>
    )}
    </div>
    )}
    </div>
    )}

    {portfolioResult && (
    <div className={styles.resultPanel}>
    <h3>🧪 组合回测（试验版）</h3>

    <div className={styles.detailHint}>
    这版按所有单币交易记录的真实时间顺序合并，用共享资金池统一撮合。
    当前规则：最多同时持仓 {maxConcurrentPositions} 个，单笔仓位 {positionSizePercent}%。
    </div>

    <div className={styles.overview}>
    <div className={styles.overviewCard}>
    <span className={styles.label}>组合总收益</span>
    <span className={`${styles.value} ${portfolioResult.totalProfit >= 0 ? styles.positive : styles.negative}`}>
    {portfolioResult.totalProfit.toFixed(2)}%
    </span>
    <span className={styles.subValue}>{formatSignedUsdt(portfolioResult.totalProfitUSDT)}</span>
    </div>
    <div className={styles.overviewCard}>
    <span className={styles.label}>最终资金</span>
    <span className={styles.value}>{portfolioResult.finalCapital.toFixed(2)} U</span>
    <span className={styles.subValue}>初始 {portfolioResult.initialCapital.toFixed(2)} U</span>
    </div>
    <div className={styles.overviewCard}>
    <span className={styles.label}>最大回撤</span>
    <span className={`${styles.value} ${styles.negative}`}>
    {portfolioResult.maxDrawdown.toFixed(2)}%
    </span>
    <span className={styles.subValue}>共享资金口径</span>
    </div>
    <div className={styles.overviewCard}>
    <span className={styles.label}>执行交易</span>
    <span className={styles.value}>{portfolioResult.executedTrades}</span>
    <span className={styles.subValue}>
    跳过 {portfolioResult.skippedTrades} / 候选 {portfolioResult.totalTrades}
    </span>
    </div>
    <div className={styles.overviewCard}>
    <span className={styles.label}>胜率</span>
    <span className={styles.value}>{portfolioResult.winRate.toFixed(2)}%</span>
    <span className={styles.subValue}>
    {portfolioResult.winningTrades}胜 / {portfolioResult.losingTrades}负
    </span>
    </div>
    <div className={styles.overviewCard}>
    <span className={styles.label}>盈亏比</span>
    <span className={styles.value}>{formatProfitFactor(portfolioResult.profitFactor, portfolioResult.totalTrades)}</span>
    <span className={styles.subValue}>
    覆盖币种 {portfolioResult.activeSymbols} 个
    </span>
    </div>
    </div>

    <div className={styles.chartsSection}>
    <EquityCurveChart data={portfolioResult.equityCurve} trades={portfolioResult.trades} />
    <div className={styles.chartsGrid}>
    <DrawdownChart data={portfolioResult.equityCurve} />
    <ProfitDistributionChart trades={portfolioResult.trades} />
    <HoldingTimeChart trades={portfolioResult.trades} />
    </div>
    </div>

    <div className={styles.metricsGrid}>
    <div className={styles.metric}>
    <span>平均盈亏</span>
    <strong className={portfolioResult.averageProfit >= 0 ? styles.positive : styles.negative}>
    {portfolioResult.averageProfit.toFixed(2)}%
    </strong>
    </div>
    <div className={styles.metric}>
    <span>平均盈利</span>
    <strong className={styles.positive}>{portfolioResult.averageWin.toFixed(2)}%</strong>
    </div>
    <div className={styles.metric}>
    <span>平均亏损</span>
    <strong className={styles.negative}>{portfolioResult.averageLoss.toFixed(2)}%</strong>
    </div>
    <div className={styles.metric}>
    <span>最大盈利</span>
    <strong className={styles.positive}>{portfolioResult.largestWin.toFixed(2)}%</strong>
    </div>
    <div className={styles.metric}>
    <span>最大亏损</span>
    <strong className={styles.negative}>{portfolioResult.largestLoss.toFixed(2)}%</strong>
    </div>
    <div className={styles.metric}>
    <span>夏普比率</span>
    <strong>{portfolioResult.sharpeRatio.toFixed(2)}</strong>
    </div>
    <div className={styles.metric}>
    <span>Sortino比率</span>
    <strong>{portfolioResult.sortinoRatio.toFixed(2)}</strong>
    </div>
    <div className={styles.metric}>
    <span>Calmar比率</span>
    <strong>{portfolioResult.calmarRatio.toFixed(2)}</strong>
    </div>
    <div className={styles.metric}>
    <span>恢复因子</span>
    <strong>{portfolioResult.recoveryFactor.toFixed(2)}</strong>
    </div>
    <div className={styles.metric}>
    <span>平均持仓</span>
    <strong>{formatDuration(portfolioResult.averageHoldingTime)}</strong>
    </div>
    <div className={styles.metric}>
    <span>最大同时持仓</span>
    <strong>{portfolioResult.maxConcurrentPositionsUsed}</strong>
    </div>
    <div className={styles.metric}>
    <span>期望值</span>
    <strong className={portfolioResult.expectancy >= 0 ? styles.positive : styles.negative}>
    {portfolioResult.expectancy.toFixed(2)}%
    </strong>
    </div>
    </div>

    <div className={styles.tradesSection}>
    <div className={styles.paginationBar}>
    <h4>🧾 组合成交记录</h4>
    {portfolioPagination && (
    <div className={styles.paginationInfo}>
    第 {portfolioPagination.currentPage} / {portfolioPagination.totalPages} 页，共 {portfolioResult.totalTrades} 笔
    </div>
    )}
    </div>
    <div className={styles.tableWrapper}>
    <table className={styles.tradesTable}>
    <thead>
    <tr>
    <th>币种</th>
    <th>方向</th>
    <th>开仓时间</th>
    <th>平仓时间</th>
    <th>盈亏</th>
    <th>收益额</th>
    </tr>
    </thead>
    <tbody>
    {portfolioPagination?.visibleTrades.map((trade, idx) => (
    <tr key={`${trade.symbol}-${trade.entryTime}-${idx}`}>
    <td>{trade.symbol || '-'}</td>
    <td>
    <span className={trade.direction === 'long' ? styles.long : styles.short}>
    {trade.direction === 'long' ? '做多' : '做空'}
    </span>
    </td>
    <td>{new Date(trade.entryTime).toLocaleString()}</td>
    <td>{new Date(trade.exitTime).toLocaleString()}</td>
    <td className={trade.profit >= 0 ? styles.positive : styles.negative}>
    {formatSignedPercent(trade.profit)}
    </td>
    <td className={trade.profitUSDT >= 0 ? styles.positive : styles.negative}>
    {formatSignedUsdt(trade.profitUSDT)}
    </td>
    </tr>
    ))}
    </tbody>
    </table>
    </div>
    {portfolioPagination && portfolioPagination.totalPages > 1 && (
    <div className={styles.paginationControls}>
    <button
    type="button"
    className={styles.pageButton}
    onClick={() => setPortfolioTradePage((page) => Math.max(1, page - 1))}
    disabled={portfolioPagination.currentPage <= 1}
    >
    上一页
    </button>
    <button
    type="button"
    className={styles.pageButton}
    onClick={() => setPortfolioTradePage((page) => Math.min(portfolioPagination.totalPages, page + 1))}
    disabled={portfolioPagination.currentPage >= portfolioPagination.totalPages}
    >
    下一页
    </button>
    </div>
    )}
    </div>
    </div>
    )}

    {detailRun && (
    <div className={styles.resultPanel}>
    <h3>📈 详细结果 · {detailRun.symbol}</h3>

    <div className={styles.detailHint}>
    当前展示批量结果中的详细回测。信号周期 {detailRun.result.interval}，执行周期 {detailRun.result.executionInterval}。
    {detailRun.rangeAdjusted && (
    <> 实际区间已收缩为 {new Date(detailRun.result.startTime).toLocaleDateString()} - {new Date(detailRun.result.endTime).toLocaleDateString()}：{detailRun.rangeAdjustmentReason}</>
    )}
    </div>

    <div className={styles.diagnosticsPanel}>
    <div className={styles.diagnosticsHeader}>
    <div>
    <div className={styles.diagnosticsTitle}>结果可信度</div>
    <div className={styles.diagnosticsSummary}>{detailRun.diagnostics.summary}</div>
    </div>
    <span className={`${styles.diagnosticBadge} ${styles[`confidence${detailRun.diagnostics.confidence}`]}`}>
    {detailRun.diagnostics.confidence === 'high' ? '较高' : detailRun.diagnostics.confidence === 'medium' ? '中等' : '偏低'}
    </span>
    </div>

    <div className={styles.diagnosticsGrid}>
    {detailRun.diagnostics.checks.map((check) => (
    <div key={check.key} className={styles.diagnosticItem}>
    <div className={styles.diagnosticItemHeader}>
    <span className={`${styles.diagnosticStatus} ${styles[`status${check.status}`]}`}>
    {check.status === 'pass' ? '通过' : check.status === 'warn' ? '注意' : '风险'}
    </span>
    <span className={styles.diagnosticLabel}>{check.label}</span>
    </div>
    <div className={styles.diagnosticDetail}>{check.detail}</div>
    </div>
    ))}
    </div>
    </div>

    <div className={styles.chartsSection}>
    <EquityCurveChart data={detailRun.result.equityCurve} trades={detailRun.result.trades} />
    <div className={styles.chartsGrid}>
    <DrawdownChart data={detailRun.result.equityCurve} />
    <ProfitDistributionChart trades={detailRun.result.trades} />
    <HoldingTimeChart trades={detailRun.result.trades} />
    </div>
    </div>

    <div className={styles.overview}>
    <div className={styles.overviewCard}>
    <span className={styles.label}>总收益</span>
    <span className={`${styles.value} ${detailRun.result.totalProfit >= 0 ? styles.positive : styles.negative}`}>
    {detailRun.result.totalProfit.toFixed(2)}%
    </span>
    <span className={styles.subValue}>
    {formatSignedUsdt(detailRun.result.totalProfitUSDT)}
    </span>
    </div>
    <div className={styles.overviewCard}>
    <span className={styles.label}>胜率</span>
    <span className={styles.value}>{detailRun.result.winRate.toFixed(2)}%</span>
    <span className={styles.subValue}>
    {detailRun.result.winningTrades}胜 / {detailRun.result.losingTrades}负
    </span>
    </div>
    <div className={styles.overviewCard}>
    <span className={styles.label}>最大回撤</span>
    <span className={`${styles.value} ${styles.negative}`}>
    {detailRun.result.maxDrawdown.toFixed(2)}%
    </span>
    </div>
    <div className={styles.overviewCard}>
    <span className={styles.label}>盈亏比</span>
    <span className={styles.value}>{formatProfitFactor(detailRun.result.profitFactor, detailRun.result.totalTrades)}</span>
    </div>
    <div className={styles.overviewCard}>
    <span className={styles.label}>Sortino比率</span>
    <span className={styles.value}>{detailRun.result.sortinoRatio.toFixed(2)}</span>
    </div>
    <div className={styles.overviewCard}>
    <span className={styles.label}>执行K线</span>
    <span className={styles.value}>{detailRun.result.executionInterval}</span>
    <span className={styles.subValue}>
    细粒度处理 {detailRun.result.executionBarsProcessed.toLocaleString()} 根
    </span>
    </div>
    <div className={styles.overviewCard}>
    <span className={styles.label}>Calmar比率</span>
    <span className={styles.value}>{detailRun.result.calmarRatio.toFixed(2)}</span>
    </div>
    </div>

    <div className={styles.metricsGrid}>
    <div className={styles.metric}>
    <span>总交易次数</span>
    <strong>{detailRun.result.totalTrades}</strong>
    </div>
    <div className={styles.metric}>
    <span>平均盈亏</span>
    <strong className={detailRun.result.averageProfit >= 0 ? styles.positive : styles.negative}>
    {detailRun.result.averageProfit.toFixed(2)}%
    </strong>
    </div>
    <div className={styles.metric}>
    <span>平均盈利</span>
    <strong className={styles.positive}>{detailRun.result.averageWin.toFixed(2)}%</strong>
    </div>
    <div className={styles.metric}>
    <span>平均亏损</span>
    <strong className={styles.negative}>{detailRun.result.averageLoss.toFixed(2)}%</strong>
    </div>
    <div className={styles.metric}>
    <span>最大盈利</span>
    <strong className={styles.positive}>{detailRun.result.largestWin.toFixed(2)}%</strong>
    </div>
    <div className={styles.metric}>
    <span>最大亏损</span>
    <strong className={styles.negative}>{detailRun.result.largestLoss.toFixed(2)}%</strong>
    </div>
    <div className={styles.metric}>
    <span>夏普比率</span>
    <strong>{detailRun.result.sharpeRatio.toFixed(2)}</strong>
    </div>
    <div className={styles.metric}>
    <span>平均持仓</span>
    <strong>{formatDuration(detailRun.result.averageHoldingTime)}</strong>
    </div>
    <div className={styles.metric}>
    <span>期望值</span>
    <strong className={detailRun.result.expectancy >= 0 ? styles.positive : styles.negative}>
    {detailRun.result.expectancy.toFixed(2)}%
    </strong>
    </div>
    <div className={styles.metric}>
    <span>恢复因子</span>
    <strong>{detailRun.result.recoveryFactor.toFixed(2)}</strong>
    </div>
    <div className={styles.metric}>
    <span>最大连续盈利</span>
    <strong className={styles.positive}>{detailRun.result.maxConsecutiveWins} 笔</strong>
    </div>
    <div className={styles.metric}>
    <span>最大连续亏损</span>
    <strong className={styles.negative}>{detailRun.result.maxConsecutiveLosses} 笔</strong>
    </div>
    </div>

    <div className={styles.tradesSection}>
    <div className={styles.paginationBar}>
    <h4>📝 交易记录</h4>
    {detailPagination && (
    <div className={styles.paginationInfo}>
    第 {detailPagination.currentPage} / {detailPagination.totalPages} 页，共 {detailRun.result.totalTrades} 笔
    </div>
    )}
    </div>
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
    {detailPagination?.visibleTrades.map((trade, idx) => (
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
    {formatSignedPercent(trade.profit)}
    </td>
    <td>{formatDuration(trade.holdingTime)}</td>
    <td>
    {trade.exitReason === 'stop_loss' ? '止损' :
    trade.exitReason === 'take_profit' ? '止盈' :
    trade.exitReason === 'signal' ? '反向信号' :
    trade.exitReason === 'time_stop' ? '时间止损' : '结束'}
    </td>
    </tr>
    ))}
    </tbody>
    </table>
    </div>
    {detailPagination && detailPagination.totalPages > 1 && (
    <div className={styles.paginationControls}>
    <button
    type="button"
    className={styles.pageButton}
    onClick={() => setDetailTradePage((page) => Math.max(1, page - 1))}
    disabled={detailPagination.currentPage <= 1}
    >
    上一页
    </button>
    <button
    type="button"
    className={styles.pageButton}
    onClick={() => setDetailTradePage((page) => Math.min(detailPagination.totalPages, page + 1))}
    disabled={detailPagination.currentPage >= detailPagination.totalPages}
    >
    下一页
    </button>
    </div>
    )}
    </div>
    </div>
    )}
        </>
    );
}
