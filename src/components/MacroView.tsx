"use client";

import { useMemo } from 'react';

import { usePersistentSWR } from '@/hooks/usePersistentSWR';
import type { MacroDashboardData, MacroMonitorCard } from '@/lib/macro';
import styles from './MacroView.module.css';

const fetcher = async (url: string) => {
    const res = await fetch(url);
    if (!res.ok) {
        throw new Error(`Failed to fetch macro data: ${res.status}`);
    }
    return res.json() as Promise<MacroDashboardData>;
};

function formatSignedPercent(value: number): string {
    return `${value > 0 ? '+' : ''}${value.toFixed(2)}%`;
}

function formatAssetPrice(symbol: string, value: number): string {
    if (symbol === '^KS11' || symbol === '^N225') {
        return value.toLocaleString('en-US', { maximumFractionDigits: 0 });
    }

    if (symbol === '^TNX') {
        return `${value.toFixed(3)}%`;
    }

    return `$${value.toLocaleString('en-US', {
        minimumFractionDigits: symbol === 'GC=F' ? 0 : 2,
        maximumFractionDigits: symbol === 'GC=F' ? 0 : 2,
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

function getToneClass(tone: MacroMonitorCard['tone']): string {
    if (tone === 'positive') return styles.tonePositive;
    if (tone === 'negative') return styles.toneNegative;
    return styles.toneNeutral;
}

function getChangeClass(value: number): string {
    return value >= 0 ? styles.tonePositive : styles.toneNegative;
}

export default function MacroView() {
    const { data, error, isLoading } = usePersistentSWR<MacroDashboardData>(
        '/api/macro',
        fetcher,
        {
            refreshInterval: 60 * 1000,
            revalidateOnFocus: false,
            dedupingInterval: 30 * 1000,
            storageTtlMs: 30 * 60 * 1000,
            persistIntervalMs: 60 * 1000,
        }
    );

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
                label: 'Regime 判断',
                valueText: data.regime.code,
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

    if (isLoading && !data) {
        return <div className={styles.placeholder}>宏观视角正在加载跨市场数据…</div>;
    }

    if (error && !data) {
        return <div className={styles.placeholder}>宏观视角暂时不可用，请稍后重试。</div>;
    }

    const pageClassName = useMemo(() => {
        if (!data) return styles.page;
        if (data.regime.code === 'RISK_ON') return `${styles.page} ${styles.pageRiskOn}`;
        if (data.regime.code === 'RISK_OFF') return `${styles.page} ${styles.pageRiskOff}`;
        return `${styles.page} ${styles.pageNeutral}`;
    }, [data]);

    if (!data) {
        return null;
    }

    return (
        <section className={pageClassName}>
            <header className={styles.hero}>
                <div className={styles.heroCopy}>
                    <div className={styles.kicker}>Macro Workspace</div>
                    <h1 className={styles.title}>宏观视角</h1>
                    <p className={styles.subtitle}>
                        把美股风险偏好、避险资产、亚洲指数、BTC 价格和 ETF 资金流放进同一工作区，
                        用来判断今天更适合进攻、观望还是防守。
                    </p>
                </div>

                <div className={styles.heroMeta}>
                    <div className={styles.metaBlock}>
                        <span className={styles.metaLabel}>更新时间</span>
                        <strong>{formatRelativeTime(data.updatedAt)}</strong>
                    </div>
                    <div className={styles.metaBlock}>
                        <span className={styles.metaLabel}>宏观环境</span>
                        <strong>{data.regime.label}</strong>
                    </div>
                    <div className={styles.metaBlock}>
                        <span className={styles.metaLabel}>综合评分</span>
                        <strong>{data.regime.score > 0 ? '+' : ''}{data.regime.score}</strong>
                    </div>
                </div>
            </header>

            <section className={styles.utilityBar}>
                <div className={styles.insightPanel}>
                    <div className={styles.panelEyebrow}>今日判断</div>
                    <div className={styles.insightList}>
                        {data.insights.map((insight) => (
                            <p key={insight} className={styles.insightItem}>{insight}</p>
                        ))}
                    </div>
                </div>

                <div className={styles.sourcePanel}>
                    <div className={styles.panelEyebrow}>数据健康</div>
                    <div className={styles.sourceList}>
                        {data.sourceStatus.map((source) => (
                            <div key={source.key} className={styles.sourceRow}>
                                <div>
                                    <div className={styles.sourceLabel}>{source.label}</div>
                                    <div className={styles.sourceProvider}>{source.provider}</div>
                                </div>
                                <div className={styles.sourceMeta}>
                                    <span
                                        className={`${styles.sourceBadge} ${
                                            source.status === 'live'
                                                ? styles.tonePositive
                                                : source.status === 'fallback'
                                                    ? styles.toneNeutral
                                                    : styles.toneNegative
                                        }`}
                                    >
                                        {source.status === 'live' ? '正常' : source.status === 'fallback' ? '回退' : '异常'}
                                    </span>
                                    {source.detail && <span className={styles.sourceDetail}>{source.detail}</span>}
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            </section>

            <section className={styles.marketTape}>
                {data.groups.map((group) => {
                    const isCompactGroup = group.title === '比特币 ETF' && group.items.length === 1;

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
                                                <span className={styles.marketSymbol}>{item.displaySymbol}</span>
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
                )})}
            </section>

            <section className={styles.workspace}>
                <div className={styles.regimePanel}>
                    <div className={styles.panelEyebrow}>环境定位</div>
                    <div className={styles.regimeCode}>{data.regime.code}</div>
                    <div className={styles.regimeLine}>
                        <span>{data.regime.label}</span>
                        <span>{data.regime.statusLine}</span>
                    </div>
                    <p className={styles.regimeSummary}>{data.regime.summary}</p>
                    <div className={styles.scoreRail}>
                        <span className={styles.scoreLabel}>评分区间</span>
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
                        <p className={styles.panelHint}>Regime 判断 · VIX · F&G · DXY · 美债</p>
                    </div>

                    <div className={styles.monitorTable}>
                        {monitorRows.map((row) => (
                            <article key={row.label} className={styles.monitorRow}>
                                <div className={styles.monitorLead}>
                                    <span className={styles.monitorName}>{row.label}</span>
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
                            <div className={styles.panelEyebrow}>比特币观察</div>
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
                                <div className={styles.panelEyebrow}>ETF 资金</div>
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
                        </>
                    ) : (
                        <div className={styles.emptyState}>ETF 流入数据暂未拉到，但页面其余宏观指标仍可正常判断环境。</div>
                    )}
                </article>
            </section>

            <footer className={styles.footerNote}>
                数据源：Yahoo Finance、Alternative.me、Binance、Farside Investors。这个页面用于做宏观定位和风险开关，不替代具体进出场信号。
            </footer>
        </section>
    );
}
