"use client";

import { memo, useMemo, useState } from 'react';
import {
    Activity,
    AlertTriangle,
    BarChart3,
    CircleDot,
    ExternalLink,
    Gauge,
    Globe2,
    Landmark,
    RefreshCw,
    ShieldAlert,
    Sparkles,
    TrendingDown,
    TrendingUp,
    Waves,
} from 'lucide-react';

import { usePersistentSWR } from '@/hooks/usePersistentSWR';
import { normalizeMacroDashboardData, type MacroAssetPerformance, type MacroBoardGroup, type MacroDashboardData, type MacroMonitorCard } from '@/lib/macro';
import {
    buildMacroEquityTradingViewSymbol,
    buildMacroEquityTradingViewUrl,
    canEmbedMacroEquityChart,
} from '@/lib/macroTradingView';
import styles from './MacroView.module.css';

const fetcher = async (url: string) => {
    const res = await fetch(url);
    if (!res.ok) {
        throw new Error(`Failed to fetch macro data: ${res.status}`);
    }
    return res.json() as Promise<MacroDashboardData>;
};

const INDEX_SYMBOLS = new Set(['^GSPC', '^IXIC', '^NDX', '^HSI', '^HSCE', '000001.SS', '399001.SZ', '399006.SZ', '^KS11', '^N225']);
const ZERO_DECIMAL_PRICE_SYMBOLS = new Set(['XAUUSD=X', 'GC=F']);
type MacroSection = 'global' | 'us-equities' | 'hk-equities' | 'a-share-equities';
type Tone = MacroMonitorCard['tone'];
type MacroSource = MacroDashboardData['sourceStatus'][number];
type EquityDashboard = MacroDashboardData['usEquities'];
type PerformanceKey = keyof MacroAssetPerformance;

const PERFORMANCE_PERIODS: Array<{ key: PerformanceKey; label: string }> = [
    { key: 'year', label: 'year' },
    { key: 'month', label: 'month' },
    { key: 'week', label: 'week' },
    { key: 'day', label: 'day' },
];

function formatSignedPercent(value: number): string {
    return `${value > 0 ? '+' : ''}${value.toFixed(2)}%`;
}

function formatAssetPrice(symbol: string, value: number): string {
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

function formatRelativeTime(timestamp: string): string {
    const diffMs = Date.now() - new Date(timestamp).getTime();
    if (!Number.isFinite(diffMs) || diffMs < 0) return '刚刚';

    const minutes = Math.floor(diffMs / 60000);
    if (minutes < 1) return '刚刚';
    if (minutes < 60) return `${minutes}分钟前`;

    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}小时前`;

    return `${Math.floor(hours / 24)}天前`;
}

function formatSourceTimestamp(timestamp?: string): string | undefined {
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

function getFreshnessText(freshness?: MacroDashboardData['sourceStatus'][number]['freshness']): string | undefined {
    if (freshness === 'realtime') return '实时';
    if (freshness === 'intraday') return '盘中';
    if (freshness === 'daily') return '日频';
    if (freshness === 'stale') return '过旧';
    if (freshness === 'unknown') return '未知';
    return undefined;
}

function getToneClass(tone: MacroMonitorCard['tone']): string {
    if (tone === 'positive') return styles.tonePositive;
    if (tone === 'negative') return styles.toneNegative;
    return styles.toneNeutral;
}

function getChangeClass(value: number): string {
    return value >= 0 ? styles.tonePositive : styles.toneNegative;
}

function getPerformanceEntries(performance?: MacroAssetPerformance) {
    if (!performance) return [];

    return PERFORMANCE_PERIODS
        .map((period) => ({
            ...period,
            value: performance[period.key],
        }))
        .filter((entry): entry is { key: PerformanceKey; label: string; value: number } => Number.isFinite(entry.value));
}

function isSourceStale(source: MacroDashboardData['sourceStatus'][number]): boolean {
    return source.freshness === 'stale' || source.freshness === 'unknown';
}

function getSourceBadgeText(source: MacroDashboardData['sourceStatus'][number]): string {
    const freshnessText = getFreshnessText(source.freshness);
    if (isSourceStale(source) && freshnessText) return freshnessText;
    if (source.status === 'live') return '正常';
    if (source.status === 'fallback') return '备用源';
    return '异常';
}

function getSourceBadgeClass(source: MacroDashboardData['sourceStatus'][number]): string {
    if (source.status === 'unavailable') return styles.toneNegative;
    if (source.status === 'fallback' || isSourceStale(source)) return styles.toneNeutral;
    return styles.tonePositive;
}

function renderToneIcon(tone: Tone) {
    if (tone === 'positive') return <TrendingUp size={15} aria-hidden="true" />;
    if (tone === 'negative') return <TrendingDown size={15} aria-hidden="true" />;
    return <CircleDot size={15} aria-hidden="true" />;
}

function renderRegimeIcon(code: MacroDashboardData['regime']['code']) {
    if (code === 'RISK_ON') return <Sparkles size={26} aria-hidden="true" />;
    if (code === 'RISK_OFF') return <ShieldAlert size={26} aria-hidden="true" />;
    return <Gauge size={26} aria-hidden="true" />;
}

function summarizeGroups(groups: MacroBoardGroup[]) {
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

function getRegimeDisplayText(code: MacroDashboardData['regime']['code']): string {
    if (code === 'RISK_ON') return '进攻环境';
    if (code === 'RISK_OFF') return '防守环境';
    return '中性环境';
}

function EquityObserverPanel({
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

function MacroView({ onSymbolClick }: { onSymbolClick?: (symbol: string) => void }) {
    const [activeSection, setActiveSection] = useState<MacroSection>('global');
    const { data: rawData, error, isLoading } = usePersistentSWR<MacroDashboardData>(
        '/api/macro',
        fetcher,
        {
            refreshInterval: 60 * 1000,
            revalidateOnFocus: true,
            dedupingInterval: 30 * 1000,
            storageTtlMs: 10 * 60 * 1000,
            persistIntervalMs: 60 * 1000,
        }
    );
    const data = useMemo(() => rawData ? normalizeMacroDashboardData(rawData) : undefined, [rawData]);

    const monitorRows = useMemo<Array<{
        label: string;
        valueText: string;
        hint: string;
        statusLabel: string;
        tone: MacroMonitorCard['tone'];
        deltaText?: string;
    }>>(() => {
        if (!data) {
            return [];
        }

        return [
            {
                label: '宏观环境判断',
                valueText: getRegimeDisplayText(data.regime.code),
                hint: data.regime.summary,
                statusLabel: `${data.regime.label} · 综合评分 ${data.regime.score > 0 ? '+' : ''}${data.regime.score}`,
                tone: data.regime.code === 'RISK_ON' ? 'positive' : data.regime.code === 'RISK_OFF' ? 'negative' : 'neutral',
            },
            data.monitors.fearGreed,
            data.monitors.vix,
            data.monitors.dxy,
            data.monitors.us10y,
            data.monitors.ethBtc,
        ];
    }, [data]);

    const globalSummary = useMemo(
        () => data ? summarizeGroups(data.groups) : undefined,
        [data]
    );

    const sourceSummary = useMemo(() => {
        if (!data) {
            return { live: 0, freshLive: 0, fallback: 0, unavailable: 0, stale: 0 };
        }

        return {
            live: data.sourceStatus.filter((source) => source.status === 'live').length,
            freshLive: data.sourceStatus.filter((source) => source.status === 'live' && !isSourceStale(source)).length,
            fallback: data.sourceStatus.filter((source) => source.status === 'fallback').length,
            unavailable: data.sourceStatus.filter((source) => source.status === 'unavailable').length,
            stale: data.sourceStatus.filter(isSourceStale).length,
        };
    }, [data]);

    const pageClassName = useMemo(() => {
        if (!data) return styles.page;
        if (data.regime.code === 'RISK_ON') return `${styles.page} ${styles.pageRiskOn}`;
        if (data.regime.code === 'RISK_OFF') return `${styles.page} ${styles.pageRiskOff}`;
        return `${styles.page} ${styles.pageNeutral}`;
    }, [data]);

    const usEquitySource = useMemo(
        () => data?.sourceStatus.find((source) => source.key === 'us-equities'),
        [data]
    );
    const hkEquitySource = useMemo(
        () => data?.sourceStatus.find((source) => source.key === 'hk-equities'),
        [data]
    );
    const aShareEquitySource = useMemo(
        () => data?.sourceStatus.find((source) => source.key === 'a-share-equities'),
        [data]
    );

    if (isLoading && !data) {
        return <div className={styles.placeholder}>宏观视角正在加载跨市场数据…</div>;
    }

    if (error && !data) {
        return <div className={styles.placeholder}>宏观视角暂时不可用，请稍后重试。</div>;
    }

    if (!data) {
        return null;
    }

    return (
        <section className={pageClassName}>
            <header className={styles.hero}>
                <div className={styles.heroCopy}>
                    <div className={styles.kicker}><Globe2 size={14} /> 宏观工作台</div>
                    <h1 className={styles.title}>宏观视角</h1>
                    <p className={styles.subtitle}>{data.regime.summary}</p>
                    <div className={styles.heroActions} aria-label="宏观视角状态">
                        <span className={`${styles.liveDot} ${sourceSummary.unavailable > 0 || sourceSummary.stale > 0 ? styles.liveDotWarn : ''}`}>
                            {sourceSummary.unavailable > 0
                                ? '数据降级'
                                : sourceSummary.stale > 0
                                    ? '数据需复核'
                                    : '数据在线'}
                        </span>
                        <span><RefreshCw size={14} /> {formatRelativeTime(data.updatedAt)}</span>
                    </div>
                </div>

                <div className={styles.commandPanel}>
                    <div className={styles.regimeSnapshot}>
                        {renderRegimeIcon(data.regime.code)}
                        <div>
                            <span className={styles.metaLabel}>当前环境</span>
                            <strong>{getRegimeDisplayText(data.regime.code)}</strong>
                        </div>
                    </div>
                    <div className={styles.scoreCard}>
                        <span className={styles.metaLabel}>{data.regime.label}</span>
                        <strong>{data.regime.score > 0 ? '+' : ''}{data.regime.score}</strong>
                        <span>{data.regime.statusLine}</span>
                    </div>
                    <div className={styles.commandStats}>
                        <div>
                            <span className={styles.metaLabel}>市场宽度</span>
                            <strong>{globalSummary?.advancers ?? 0}/{globalSummary?.decliners ?? 0}</strong>
                        </div>
                        <div>
                            <span className={styles.metaLabel}>数据源</span>
                            <strong>{sourceSummary.freshLive}/{data.sourceStatus.length}</strong>
                        </div>
                    </div>
                </div>
            </header>

            <div className={styles.sectionSwitch} role="tablist" aria-label="宏观视角分区">
                <button
                    type="button"
                    className={`${styles.sectionSwitchBtn} ${activeSection === 'global' ? styles.sectionSwitchBtnActive : ''}`}
                    onClick={() => setActiveSection('global')}
                    role="tab"
                    aria-selected={activeSection === 'global'}
                >
                    <BarChart3 size={15} />
                    全球总览
                </button>
                <button
                    type="button"
                    className={`${styles.sectionSwitchBtn} ${activeSection === 'us-equities' ? styles.sectionSwitchBtnActive : ''}`}
                    onClick={() => setActiveSection('us-equities')}
                    role="tab"
                    aria-selected={activeSection === 'us-equities'}
                >
                    <Landmark size={15} />
                    美股观察
                </button>
                <button
                    type="button"
                    className={`${styles.sectionSwitchBtn} ${activeSection === 'hk-equities' ? styles.sectionSwitchBtnActive : ''}`}
                    onClick={() => setActiveSection('hk-equities')}
                    role="tab"
                    aria-selected={activeSection === 'hk-equities'}
                >
                    <Landmark size={15} />
                    港股观察
                </button>
                <button
                    type="button"
                    className={`${styles.sectionSwitchBtn} ${activeSection === 'a-share-equities' ? styles.sectionSwitchBtnActive : ''}`}
                    onClick={() => setActiveSection('a-share-equities')}
                    role="tab"
                    aria-selected={activeSection === 'a-share-equities'}
                >
                    <Landmark size={15} />
                    A股观察
                </button>
            </div>

            {activeSection === 'global' ? (
                <>
                    <section className={styles.utilityBar}>
                        <div className={styles.insightPanel}>
                            <div className={styles.panelEyebrow}><Activity size={13} /> 今日判断</div>
                            <div className={styles.insightList}>
                                {data.insights.map((insight) => (
                                    <p key={insight} className={styles.insightItem}>{insight}</p>
                                ))}
                            </div>
                        </div>

                        <div className={styles.sourcePanel}>
                            <div className={styles.panelHeaderCompact}>
                                <div className={styles.panelEyebrow}><Waves size={13} /> 数据健康</div>
                                <span className={styles.sourceSummaryText}>
                                    {sourceSummary.freshLive} 正常 · {sourceSummary.stale} 需复核 · {sourceSummary.fallback} 备用 · {sourceSummary.unavailable} 异常
                                </span>
                            </div>
                            <div className={styles.sourceList}>
                                {data.sourceStatus.map((source) => {
                                    const sourceDetail = [
                                        source.detail,
                                        getFreshnessText(source.freshness),
                                        formatSourceTimestamp(source.dataTimestamp),
                                        typeof source.latencyMs === 'number' ? `${source.latencyMs}ms` : undefined,
                                    ].filter(Boolean).join(' · ');

                                    return (
                                        <div key={source.key} className={styles.sourceRow}>
                                            <div>
                                                <div className={styles.sourceLabel}>{source.label}</div>
                                                <div className={styles.sourceProvider}>{source.provider}</div>
                                            </div>
                                            <div className={styles.sourceMeta}>
                                                <span
                                                    className={`${styles.sourceBadge} ${getSourceBadgeClass(source)}`}
                                                >
                                                    {getSourceBadgeText(source)}
                                                </span>
                                                {sourceDetail && <span className={styles.sourceDetail}>{sourceDetail}</span>}
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    </section>

                    <section className={styles.summaryStrip} aria-label="全球市场摘要">
                        <div className={styles.summaryCell}>
                            <span className={styles.metricLabel}>覆盖标的</span>
                            <strong>{globalSummary?.total ?? 0}</strong>
                        </div>
                        <div className={styles.summaryCell}>
                            <span className={styles.metricLabel}>平均涨跌</span>
                            <strong className={globalSummary ? getChangeClass(globalSummary.averageChange) : undefined}>
                                {globalSummary ? formatSignedPercent(globalSummary.averageChange) : '--'}
                            </strong>
                        </div>
                        <div className={styles.summaryCell}>
                            <span className={styles.metricLabel}>最强</span>
                            <strong>{globalSummary?.strongest?.displaySymbol ?? '--'}</strong>
                            {globalSummary?.strongest && <small className={getChangeClass(globalSummary.strongest.changePercent)}>{formatSignedPercent(globalSummary.strongest.changePercent)}</small>}
                        </div>
                        <div className={styles.summaryCell}>
                            <span className={styles.metricLabel}>最弱</span>
                            <strong>{globalSummary?.weakest?.displaySymbol ?? '--'}</strong>
                            {globalSummary?.weakest && <small className={getChangeClass(globalSummary.weakest.changePercent)}>{formatSignedPercent(globalSummary.weakest.changePercent)}</small>}
                        </div>
                    </section>

                    <div className={styles.sectionHeader}>
                        <div>
                            <div className={styles.panelEyebrow}>全球总览</div>
                            <h2 className={styles.panelTitle}>跨市场行情</h2>
                        </div>
                        <p className={styles.panelHint}>美股指数 · 大宗商品 · 数字资产 ETF · 中韩日指数</p>
                    </div>

                    <section className={styles.marketTape}>
                        {data.groups.map((group) => {
                            const isCompactGroup = group.title === '数字资产 ETF' && group.items.length === 1;

                            return (
                                <div key={group.title} className={`${styles.marketGroup} ${isCompactGroup ? styles.marketGroupCompact : ''}`}>
                                    <div className={styles.marketGroupLabel}>{group.title}</div>
                                    <div className={styles.marketGroupItems}>
                                        {group.items.map((item) => (
                                            <article key={item.symbol} className={`${styles.marketItem} ${isCompactGroup ? styles.marketItemCompact : ''}`}>
                                                {isCompactGroup ? (
                                                    <>
                                                        <div className={styles.marketCompactTop}>
                                                            <span className={styles.marketSymbol}>{item.displaySymbol}</span>
                                                            <span className={styles.marketHint}>现货代理</span>
                                                        </div>
                                                        <div className={styles.marketCompactBottom}>
                                                            <div className={styles.marketPrice}>{formatAssetPrice(item.symbol, item.price)}</div>
                                                            <span className={`${styles.marketChange} ${getChangeClass(item.changePercent)}`}>
                                                                {formatSignedPercent(item.changePercent)}
                                                            </span>
                                                        </div>
                                                    </>
                                                ) : (
                                                    <>
                                                        <div className={styles.marketSymbolRow}>
                                                            <span className={styles.marketSymbol}>
                                                                <span className={`${styles.directionDot} ${item.changePercent >= 0 ? styles.directionUp : styles.directionDown}`} />
                                                                {item.displaySymbol}
                                                            </span>
                                                            <span className={`${styles.marketChange} ${getChangeClass(item.changePercent)}`}>
                                                                {formatSignedPercent(item.changePercent)}
                                                            </span>
                                                        </div>
                                                        <div className={styles.marketPrice}>{formatAssetPrice(item.symbol, item.price)}</div>
                                                    </>
                                                )}
                                            </article>
                                        ))}
                                    </div>
                                </div>
                            );
                        })}
                    </section>

                    <section className={styles.workspace}>
                        <div className={styles.regimePanel}>
                            <div className={styles.panelEyebrow}><Gauge size={13} /> 环境定位</div>
                            <div className={styles.regimeCode}>{getRegimeDisplayText(data.regime.code)}</div>
                            <div className={styles.regimeLine}>
                                <span>{data.regime.label}</span>
                                <span>{data.regime.statusLine}</span>
                            </div>
                            <p className={styles.regimeSummary}>{data.regime.summary}</p>
                            <div className={styles.scoreRail}>
                                <span className={styles.scoreLabel}>评分区间 · -5 到 +5</span>
                                <div className={styles.scoreTrack}>
                                    <div
                                        className={styles.scoreThumb}
                                        style={{ left: `${((data.regime.score + 5) / 10) * 100}%` }}
                                    />
                                </div>
                                <div className={styles.scoreRange}>
                                    <span>防守</span>
                                    <span>中性</span>
                                    <span>进攻</span>
                                </div>
                            </div>
                        </div>

                        <div className={styles.monitorPanel}>
                            <div className={styles.panelHeader}>
                                <div>
                                    <div className={styles.panelEyebrow}>宏观监控</div>
                                    <h2 className={styles.panelTitle}>关键开关</h2>
                                </div>
                                <p className={styles.panelHint}>环境判断 · 恐贪 · 波动率 · 美元 · 美债</p>
                            </div>

                            <div className={styles.monitorTable}>
                                {monitorRows.map((row) => (
                                    <article key={row.label} className={styles.monitorRow}>
                                        <div className={styles.monitorLead}>
                                            <span className={styles.monitorName}>
                                                {renderToneIcon(row.tone)}
                                                {row.label}
                                            </span>
                                            <span className={`${styles.monitorBadge} ${getToneClass(row.tone)}`}>{row.statusLabel}</span>
                                        </div>
                                        <div className={styles.monitorMetric}>
                                            <span className={styles.monitorMetricValue}>{row.valueText}</span>
                                            {row.deltaText && (
                                                <span className={`${styles.monitorDelta} ${row.deltaText.startsWith('+') ? styles.tonePositive : styles.toneNegative}`}>
                                                    {row.deltaText}
                                                </span>
                                            )}
                                        </div>
                                        <p className={styles.monitorRule}>{row.hint}</p>
                                    </article>
                                ))}
                            </div>
                        </div>
                    </section>

                    <section className={styles.detailGrid}>
                        <article className={styles.detailPanel}>
                            <div className={styles.panelHeader}>
                                <div>
                                    <div className={styles.panelEyebrow}><Activity size={13} /> 比特币观察</div>
                                    <h2 className={styles.panelTitle}>BTC 监控</h2>
                                </div>
                            </div>

                            <div className={styles.primaryMetricRow}>
                                <div>
                                    <div className={styles.metricLabel}>BTC 价格</div>
                                    <div className={styles.primaryMetric}>${data.btc.price.toLocaleString('en-US', { maximumFractionDigits: 0 })}</div>
                                </div>
                                <div className={`${styles.metricChange} ${getChangeClass(data.btc.changePercent)}`}>
                                    {formatSignedPercent(data.btc.changePercent)}
                                </div>
                            </div>

                            <div className={styles.twoColMeta}>
                                <div>
                                    <div className={styles.metricLabel}>24h 高</div>
                                    <div className={styles.metricValue}>${data.btc.high24h.toLocaleString('en-US', { maximumFractionDigits: 0 })}</div>
                                </div>
                                <div>
                                    <div className={styles.metricLabel}>24h 低</div>
                                    <div className={styles.metricValue}>${data.btc.low24h.toLocaleString('en-US', { maximumFractionDigits: 0 })}</div>
                                </div>
                            </div>

                            <div className={styles.inlineMeter}>
                                <div className={styles.inlineMeterTop}>
                                    <span className={styles.metricLabel}>{data.btc.funding.label}</span>
                                    <span className={styles.metricValue}>{data.btc.funding.valueText}</span>
                                </div>
                                <div className={`${styles.monitorBadge} ${getToneClass(data.btc.funding.tone)}`}>{data.btc.funding.statusLabel}</div>
                                <p className={styles.monitorRule}>{data.btc.funding.hint}</p>
                            </div>

                            {data.btc.lsRatio && (
                                <div className={styles.inlineMeter}>
                                    <div className={styles.inlineMeterTop}>
                                        <span className={styles.metricLabel}>{data.btc.lsRatio.label}</span>
                                        <span className={styles.metricValue}>{data.btc.lsRatio.valueText}</span>
                                    </div>
                                    <div className={`${styles.monitorBadge} ${getToneClass(data.btc.lsRatio.tone)}`}>{data.btc.lsRatio.statusLabel}</div>
                                    <p className={styles.monitorRule}>{data.btc.lsRatio.hint}</p>
                                </div>
                            )}
                        </article>

                        <article className={styles.detailPanel}>
                            <div className={styles.panelHeader}>
                                <div>
                                    <div className={styles.panelEyebrow}><Waves size={13} /> ETF 资金</div>
                                    <h2 className={styles.panelTitle}>BTC ETF 净流入</h2>
                                </div>
                                {data.etfFlow?.provider && (
                                    <span className={styles.panelPill}>{data.etfFlow.provider}</span>
                                )}
                            </div>

                            {data.etfFlow ? (
                                <>
                                    <div className={styles.primaryMetricRow}>
                                        <div>
                                            <div className={styles.metricLabel}>{data.etfFlow.date.slice(5)} 当日净流入</div>
                                            <div className={`${styles.primaryMetric} ${getChangeClass(data.etfFlow.totalNetInflowUsdMillion)}`}>
                                                {data.etfFlow.totalNetInflowUsdMillion >= 0 ? '+' : ''}
                                                {data.etfFlow.totalNetInflowUsdMillion.toFixed(1)}M
                                            </div>
                                        </div>
                                        <div className={styles.sideNote}>
                                            BTC ${data.etfFlow.btcPrice?.toLocaleString('en-US', { maximumFractionDigits: 0 }) ?? '--'}
                                        </div>
                                    </div>

                                    <div className={styles.twoColMeta}>
                                        <div>
                                            <div className={styles.metricLabel}>7日累计</div>
                                            <div className={`${styles.metricValue} ${getChangeClass(data.etfFlow.rolling7dNetInflowUsdMillion)}`}>
                                                {data.etfFlow.rolling7dNetInflowUsdMillion >= 0 ? '+' : ''}
                                                {data.etfFlow.rolling7dNetInflowUsdMillion.toFixed(1)}M
                                            </div>
                                        </div>
                                        <div>
                                            <div className={styles.metricLabel}>交易日分布</div>
                                            <div className={styles.metricValue}>
                                                {data.etfFlow.rolling7dPositiveDays}入 / {data.etfFlow.rolling7dNegativeDays}出
                                            </div>
                                        </div>
                                    </div>

                                    {data.etfFlow.flows.length > 0 ? (
                                        <div className={styles.flowList}>
                                            {data.etfFlow.flows.slice(0, 5).map((flow) => (
                                                <div key={flow.symbol} className={styles.flowRow}>
                                                    <span>{flow.symbol}</span>
                                                    <span className={getChangeClass(flow.netInflowUsdMillion)}>
                                                        {flow.netInflowUsdMillion >= 0 ? '+' : ''}
                                                        {flow.netInflowUsdMillion.toFixed(1)}M
                                                    </span>
                                                </div>
                                            ))}
                                        </div>
                                    ) : (
                                        <div className={styles.emptyState}>当前数据源提供聚合净流入，暂不展示单只 ETF 拆分。</div>
                                    )}
                                </>
                            ) : (
                                <div className={styles.emptyState}>ETF 流入数据暂未拉到，但页面其余宏观指标仍可正常判断环境。</div>
                            )}
                        </article>
                    </section>
                </>
            ) : activeSection === 'us-equities' ? (
                <EquityObserverPanel
                    title="美股观察"
                    heading="核心股票、杠杆 ETF 与板块宽度"
                    dashboard={data.usEquities}
                    source={usEquitySource}
                    emptyText="美股观察数据暂未拉到，全球总览仍可正常用于宏观定位。"
                    onSymbolClick={onSymbolClick}
                />
            ) : activeSection === 'hk-equities' ? (
                <EquityObserverPanel
                    title="港股观察"
                    heading="恒指、科技互联网、金融地产与资源股"
                    dashboard={data.hkEquities}
                    source={hkEquitySource}
                    emptyText="港股观察数据暂未拉到，全球总览仍可正常用于宏观定位。"
                    onSymbolClick={onSymbolClick}
                />
            ) : (
                <EquityObserverPanel
                    title="A股观察"
                    heading="宽基指数、核心资产、半导体与新能源"
                    dashboard={data.aShareEquities}
                    source={aShareEquitySource}
                    emptyText="A股观察数据暂未拉到，全球总览仍可正常用于宏观定位。"
                    onSymbolClick={onSymbolClick}
                />
            )}

            <footer className={styles.footerNote}>
                <AlertTriangle size={14} />
                数据源：雅虎财经、Alternative.me、Binance、Bitbo、Farside Investors。这个页面用于做宏观定位和风险开关，不替代具体进出场信号。
            </footer>
        </section>
    );
}

export default memo(MacroView);
