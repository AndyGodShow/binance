"use client";

import { CircleDot, ExternalLink, Gauge, Landmark, ShieldAlert, Sparkles, TrendingDown, TrendingUp } from 'lucide-react';
import type { MacroAssetPerformance, MacroBoardGroup, MacroDashboardData, MacroMonitorCard } from '@/lib/macro';
import {
    buildMacroEquityTradingViewSymbol,
    buildMacroEquityTradingViewUrl,
    canEmbedMacroEquityChart,
} from '@/lib/macroTradingView';
import styles from '../MacroView.module.css';

export const INDEX_SYMBOLS = new Set(['^GSPC', '^IXIC', '^NDX', '^HSI', '^HSCE', '000001.SS', '399001.SZ', '399006.SZ', '^KS11', '^N225']);
export const ZERO_DECIMAL_PRICE_SYMBOLS = new Set(['XAUUSD=X', 'GC=F']);
export type MacroSection = 'global' | 'us-equities' | 'hk-equities' | 'a-share-equities';
export type Tone = MacroMonitorCard['tone'];
export type MacroSource = MacroDashboardData['sourceStatus'][number];
export type EquityDashboard = MacroDashboardData['usEquities'];
export type PerformanceKey = keyof MacroAssetPerformance;

export const PERFORMANCE_PERIODS: Array<{ key: PerformanceKey; label: string }> = [
    { key: 'year', label: 'year' },
    { key: 'month', label: 'month' },
    { key: 'week', label: 'week' },
    { key: 'day', label: 'day' },
];

export function formatSignedPercent(value: number): string {
    return `${value > 0 ? '+' : ''}${value.toFixed(2)}%`;
}

export function formatAssetPrice(symbol: string, value: number): string {
    if (INDEX_SYMBOLS.has(symbol)) {
        return value.toLocaleString('en-US', { maximumFractionDigits: 2 });
    }

    if (symbol === '^TNX') {
        return `${value.toFixed(3)}%`;
    }

    const currencyPrefix = symbol.endsWith('.HK') ? 'HK$' : symbol.endsWith('.SS') || symbol.endsWith('.SZ') ? '¥' : '$';

    return `${currencyPrefix}${value.toLocaleString('en-US', {
        minimumFractionDigits: ZERO_DECIMAL_PRICE_SYMBOLS.has(symbol) ? 0 : 2,
        maximumFractionDigits: ZERO_DECIMAL_PRICE_SYMBOLS.has(symbol) ? 0 : 2,
    })}`;
}

export function formatRelativeTime(timestamp: string): string {
    const diffMs = Date.now() - new Date(timestamp).getTime();
    if (!Number.isFinite(diffMs) || diffMs < 0) return '刚刚';

    const minutes = Math.floor(diffMs / 60000);
    if (minutes < 1) return '刚刚';
    if (minutes < 60) return `${minutes}分钟前`;

    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}小时前`;

    return `${Math.floor(hours / 24)}天前`;
}

export function formatSourceTimestamp(timestamp?: string): string | undefined {
    if (!timestamp) return undefined;
    const parsed = new Date(timestamp);
    if (!Number.isFinite(parsed.getTime())) return timestamp;

    if (/^\d{4}-\d{2}-\d{2}$/.test(timestamp)) {
        return timestamp;
    }

    return parsed.toLocaleString('zh-CN', {
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
    });
}

export function getFreshnessText(freshness?: MacroDashboardData['sourceStatus'][number]['freshness']): string | undefined {
    if (freshness === 'realtime') return '实时';
    if (freshness === 'intraday') return '盘中';
    if (freshness === 'daily') return '日频';
    if (freshness === 'stale') return '过旧';
    if (freshness === 'unknown') return '未知';
    return undefined;
}

export function getToneClass(tone: MacroMonitorCard['tone']): string {
    if (tone === 'positive') return styles.tonePositive;
    if (tone === 'negative') return styles.toneNegative;
    return styles.toneNeutral;
}

export function getChangeClass(value: number): string {
    return value >= 0 ? styles.tonePositive : styles.toneNegative;
}

export function getPerformanceEntries(performance?: MacroAssetPerformance) {
    if (!performance) return [];

    return PERFORMANCE_PERIODS
        .map((period) => ({
            ...period,
            value: performance[period.key],
        }))
        .filter((entry): entry is { key: PerformanceKey; label: string; value: number } => Number.isFinite(entry.value));
}

export function isSourceStale(source: MacroDashboardData['sourceStatus'][number]): boolean {
    return source.freshness === 'stale' || source.freshness === 'unknown';
}

export function getSourceBadgeText(source: MacroDashboardData['sourceStatus'][number]): string {
    const freshnessText = getFreshnessText(source.freshness);
    if (isSourceStale(source) && freshnessText) return freshnessText;
    if (source.status === 'live') return '正常';
    if (source.status === 'fallback') return '备用源';
    return '异常';
}

export function getSourceBadgeClass(source: MacroDashboardData['sourceStatus'][number]): string {
    if (source.status === 'unavailable') return styles.toneNegative;
    if (source.status === 'fallback' || isSourceStale(source)) return styles.toneNeutral;
    return styles.tonePositive;
}

export function renderToneIcon(tone: Tone) {
    if (tone === 'positive') return <TrendingUp size={15} aria-hidden="true" />;
    if (tone === 'negative') return <TrendingDown size={15} aria-hidden="true" />;
    return <CircleDot size={15} aria-hidden="true" />;
}

export function renderRegimeIcon(code: MacroDashboardData['regime']['code']) {
    if (code === 'RISK_ON') return <Sparkles size={26} aria-hidden="true" />;
    if (code === 'RISK_OFF') return <ShieldAlert size={26} aria-hidden="true" />;
    return <Gauge size={26} aria-hidden="true" />;
}

export function summarizeGroups(groups: MacroBoardGroup[]) {
    const items = groups.flatMap((group) => group.items);
    const strongest = [...items].sort((left, right) => right.changePercent - left.changePercent)[0];
    const weakest = [...items].sort((left, right) => left.changePercent - right.changePercent)[0];
    const averageChange = items.length > 0
        ? items.reduce((sum, item) => sum + item.changePercent, 0) / items.length
        : 0;

    return {
        total: items.length,
        advancers: items.filter((item) => item.changePercent > 0).length,
        decliners: items.filter((item) => item.changePercent < 0).length,
        averageChange,
        strongest,
        weakest,
    };
}

export function getRegimeDisplayText(code: MacroDashboardData['regime']['code']): string {
    if (code === 'RISK_ON') return '进攻环境';
    if (code === 'RISK_OFF') return '防守环境';
    return '中性环境';
}

export function EquityObserverPanel({
    title,
    heading,
    dashboard,
    source,
    emptyText,
    onSymbolClick,
}: {
    title: string;
    heading: string;
    dashboard: EquityDashboard;
    source?: MacroSource;
    emptyText: string;
    onSymbolClick?: (symbol: string) => void;
}) {
    return (
        <section className={styles.usObserver}>
            <div className={styles.usObserverHeader}>
                <div>
                    <div className={styles.panelEyebrow}><Landmark size={13} /> {title}</div>
                    <h2 className={styles.panelTitle}>{heading}</h2>
                </div>
                <div className={styles.usObserverMeta}>
                    {dashboard.session && (
                        <span className={styles.panelPill}>
                            {dashboard.session.label} {dashboard.session.activeCount} 个标的
                        </span>
                    )}
                    {source && (
                        <span className={`${styles.sourceBadge} ${getSourceBadgeClass(source)}`}>
                            {getSourceBadgeText(source)}
                        </span>
                    )}
                </div>
            </div>

            <div className={styles.usSummaryGrid}>
                <div className={styles.usSummaryMetric}>
                    <span className={styles.metricLabel}>观察标的</span>
                    <strong>{dashboard.summary.totalCount}</strong>
                </div>
                <div className={styles.usSummaryMetric}>
                    <span className={styles.metricLabel}>上涨 / 下跌</span>
                    <strong>{dashboard.summary.advancers} / {dashboard.summary.decliners}</strong>
                </div>
                <div className={styles.usSummaryMetric}>
                    <span className={styles.metricLabel}>平均涨跌</span>
                    <strong className={getChangeClass(dashboard.summary.averageChangePercent)}>
                        {formatSignedPercent(dashboard.summary.averageChangePercent)}
                    </strong>
                </div>
                <div className={styles.usSummaryMetric}>
                    <span className={styles.metricLabel}>最强 / 最弱</span>
                    <strong>
                        {dashboard.summary.strongest?.symbol ?? '--'} / {dashboard.summary.weakest?.symbol ?? '--'}
                    </strong>
                </div>
                <div className={styles.usSummaryMetric}>
                    <span className={styles.metricLabel}>强势组 / 弱势组</span>
                    <strong>
                        {dashboard.summary.strongestGroup?.title ?? '--'} / {dashboard.summary.weakestGroup?.title ?? '--'}
                    </strong>
                </div>
            </div>

            {dashboard.groups.length > 0 ? (
                <div className={styles.usEquityGroups}>
                    {dashboard.groups.map((group) => (
                        <div key={group.title} className={styles.usEquityGroup}>
                            <div className={styles.marketGroupLabel}>{group.title}</div>
                            <div className={styles.usEquityRows}>
                                {group.items.map((item) => {
                                    const performanceEntries = getPerformanceEntries(item.performance);
                                    const tradingViewSymbol = buildMacroEquityTradingViewSymbol(item.symbol);
                                    const canEmbedChart = canEmbedMacroEquityChart(item.symbol);
                                    const rowContent = (
                                        <>
                                            <div className={styles.usEquityNameBlock}>
                                                <span className={styles.marketSymbol}>
                                                    {item.symbol}
                                                    {!canEmbedChart && <ExternalLink size={12} aria-hidden="true" />}
                                                </span>
                                                <span className={styles.usEquityLabel}>{item.displaySymbol}</span>
                                            </div>
                                            <div className={styles.usEquityPriceBlock}>
                                                <span className={styles.marketPrice}>{formatAssetPrice(item.symbol, item.price)}</span>
                                                <span className={`${styles.marketChange} ${getChangeClass(item.changePercent)}`}>
                                                    {formatSignedPercent(item.changePercent)}
                                                </span>
                                            </div>
                                            {performanceEntries.length > 0 && (
                                                <div className={styles.performanceStrip} aria-label={`${item.displaySymbol} 周期涨跌幅`}>
                                                    {performanceEntries.map((entry) => (
                                                        <div key={entry.key} className={styles.performanceCell}>
                                                            <span className={`${styles.performanceValue} ${getChangeClass(entry.value)}`}>
                                                                {formatSignedPercent(entry.value)}
                                                            </span>
                                                            <span className={styles.performanceLabel}>{entry.label}</span>
                                                        </div>
                                                    ))}
                                                </div>
                                            )}
                                            {item.session && (
                                                <div className={styles.sessionLine}>
                                                    <span>{item.session.label}</span>
                                                    <span>{formatAssetPrice(item.symbol, item.session.price)}</span>
                                                    <span className={getChangeClass(item.session.changePercent)}>
                                                        {formatSignedPercent(item.session.changePercent)}
                                                    </span>
                                                </div>
                                            )}
                                        </>
                                    );

                                    return canEmbedChart ? (
                                        <button
                                            key={item.symbol}
                                            type="button"
                                            className={styles.usEquityRow}
                                            onClick={() => onSymbolClick?.(tradingViewSymbol)}
                                            aria-label={`打开 ${item.displaySymbol} K线`}
                                        >
                                            {rowContent}
                                        </button>
                                    ) : (
                                        <a
                                            key={item.symbol}
                                            className={styles.usEquityRow}
                                            href={buildMacroEquityTradingViewUrl(item.symbol)}
                                            target="_blank"
                                            rel="noreferrer"
                                            aria-label={`在 TradingView 打开 ${item.displaySymbol} K线`}
                                        >
                                            {rowContent}
                                        </a>
                                    );
                                })}
                            </div>
                        </div>
                    ))}
                </div>
            ) : (
                <div className={styles.emptyState}>{emptyText}</div>
            )}
        </section>
    );
}
