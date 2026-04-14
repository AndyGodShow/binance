"use client";

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { usePersistentSWR } from '@/hooks/usePersistentSWR';
import { formatCompact, formatCurrency } from '@/lib/utils';
import {
    buildExecutiveSummary,
    buildOnchainStorageKey,
} from '@/lib/onchain/presenter';
import type {
    ChipScoreBreakdownItem,
    DexPriceWindow,
    DexTradeWindow,
    OnchainSearchScope,
    TokenResearchPayload,
    TokenSearchResult,
    TopHolderItem,
} from '@/lib/onchain/types';
import styles from './OnchainTracker.module.css';

const DEFAULT_QUERY = 'PEPE';
const MAX_QUERY_LENGTH = 64;
const SUBMIT_COOLDOWN_MS = 2000;

const fetcher = async (url: string) => {
    const res = await fetch(url);
    if (!res.ok) {
        throw new Error(`Failed to fetch onchain payload: ${res.status}`);
    }
    return res.json() as Promise<TokenResearchPayload>;
};

export default function OnchainTracker() {
    const [input, setInput] = useState(DEFAULT_QUERY);
    const [query, setQuery] = useState(DEFAULT_QUERY);
    const [scope, setScope] = useState<OnchainSearchScope>('contracts');

    const apiUrl = useMemo(() => {
        const params = new URLSearchParams({ keyword: query, scope });
        return `/api/onchain/dashboard?${params.toString()}`;
    }, [query, scope]);

    const storageKey = useMemo(() => buildOnchainStorageKey(`${scope}:${query}`), [query, scope]);

    const { data, error, isLoading } = usePersistentSWR<TokenResearchPayload>(
        apiUrl,
        fetcher,
        {
            refreshInterval: 5 * 60 * 1000,
            revalidateOnFocus: false,
            dedupingInterval: 20 * 1000,
            storageTtlMs: 5 * 60 * 1000,
            persistIntervalMs: 60 * 1000,
            storageKey,
        }
    );

    const selected = data?.selectedToken ?? null;
    const metrics = data?.metrics ?? null;
    const analysis = data?.analysis ?? null;
    const topHolders = data?.topHolders ?? [];

    const isFallback = data?.sourceMode === 'fallback';

    const lastSubmitRef = useRef(0);
    const cooldownTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const [submitDisabled, setSubmitDisabled] = useState(false);

    const handleSubmit = useCallback((event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        const now = Date.now();
        if (now - lastSubmitRef.current < SUBMIT_COOLDOWN_MS) {
            return;
        }
        lastSubmitRef.current = now;
        setSubmitDisabled(true);
        if (cooldownTimerRef.current) {
            clearTimeout(cooldownTimerRef.current);
        }
        cooldownTimerRef.current = setTimeout(() => {
            setSubmitDisabled(false);
            cooldownTimerRef.current = null;
        }, SUBMIT_COOLDOWN_MS);

        const nextQuery = input.trim().slice(0, MAX_QUERY_LENGTH) || DEFAULT_QUERY;
        setQuery(nextQuery);
    }, [input]);

    useEffect(() => () => {
        if (cooldownTimerRef.current) {
            clearTimeout(cooldownTimerRef.current);
        }
    }, []);

    const executiveSummary = useMemo(() => (
        selected && metrics && analysis
            ? buildExecutiveSummary(selected, metrics, analysis)
            : null
    ), [analysis, metrics, selected]);

    const scopeMeta = useMemo(() => (
        scope === 'alpha'
            ? {
                label: '币安 Alpha',
                subtitle: '先从币安 Alpha 币池定位目标，再判断它是不是被少数地址主导、筹码是否正在扩散。',
                badge: 'Alpha 观察',
                emptyText: '输入一个 Alpha 币后，这里会展示它的控筹情况、筹码分布和持币地址变化。',
                directText: '已按 Binance Alpha 名录自动定位主研究对象。',
            }
            : {
                label: '币安合约',
                subtitle: '默认只研究你在币安合约里真正会碰到的币，先定位主标的，再看谁在控筹、筹码落在哪一层。',
                badge: '合约主池',
                emptyText: '输入一个合约币后，这里会展示它的控筹情况、筹码分布和持币地址变化。',
                directText: '已按币安合约主标的自动直达研究页。',
            }
    ), [scope]);

    return (
        <section className={styles.page}>
            <header className={styles.hero}>
                <div className={styles.heroMain}>
                    <div className={styles.heroCopy}>
                        <span className={styles.kicker}>Onchain Research</span>
                        <h2 className={styles.title}>单币筹码分析台</h2>
                        <p className={styles.subtitle}>
                            {scopeMeta.subtitle}
                        </p>
                    </div>
                    <div className={styles.heroControls}>
                        <form className={styles.searchBar} onSubmit={handleSubmit}>
                            <input
                                className={styles.searchInput}
                                value={input}
                                onChange={(event) => setInput(event.target.value)}
                                placeholder="输入币种名、符号或合约地址，例如 PEPE / WIF / BONK"
                            />
                            <button className={styles.searchButton} type="submit" disabled={submitDisabled || isLoading}>
                                {submitDisabled ? '查询中…' : '开始研究'}
                            </button>
                        </form>
                        <div className={styles.scopeSwitch}>
                            <button
                                type="button"
                                className={`${styles.scopeButton} ${scope === 'contracts' ? styles.scopeButtonActive : ''}`}
                                onClick={() => {
                                    setScope('contracts');
                                }}
                            >
                                币安合约
                            </button>
                            <button
                                type="button"
                                className={`${styles.scopeButton} ${scope === 'alpha' ? styles.scopeButtonActive : ''}`}
                                onClick={() => {
                                    setScope('alpha');
                                }}
                            >
                                币安 Alpha
                            </button>
                        </div>
                    </div>
                    <div className={styles.contextLine}>
                        <span className={styles.contextLabel}>当前模式</span>
                        <p className={styles.contextText}>{scopeMeta.directText}</p>
                    </div>
                </div>

                <div className={styles.heroRail}>
                    <DataChip label="研究范围" value={scopeMeta.label} />
                    <DataChip label="候选数量" value={String(data?.searchResults.length ?? 0)} />
                    <DataChip label="持币过滤" value=">= 100 地址" />
                </div>
            </header>

            {error && <div className={styles.errorBanner}>单币筹码分析加载失败，请稍后再试。</div>}

            {isFallback && (
                <div className={styles.fallbackBanner}>
                    当前显示的是回退样本数据，通常意味着当前数据源暂时不可用或请求失败。稍后重试，或检查链上数据配置。
                </div>
            )}

            <div className={styles.singleWorkspace}>
                <main className={styles.main}>
                    {selected && metrics && analysis ? (
                        <>
                            <section className={styles.tokenHero}>
                                <div className={styles.tokenMain}>
                                    <div className={styles.tokenHeader}>
                                        <div>
                                            <div className={styles.tokenRow}>
                                                <h3 className={styles.tokenTitle}>{selected.symbol}</h3>
                                                <span className={styles.scopeBadge}>{scopeMeta.badge}</span>
                                                <span className={styles.chainBadge}>{selected.chainName}</span>
                                                <span className={styles.scoreBadge}>控筹指数 {analysis.chipScore}</span>
                                            </div>
                                            <p className={styles.tokenName}>{selected.name}</p>
                                        </div>
                                        <div className={styles.priceCluster}>
                                            <strong className={styles.priceValue}>{formatMaybeCurrency(selected.usdPrice)}</strong>
                                            <span className={styles.priceHint}>现价快照</span>
                                        </div>
                                    </div>

                                    {executiveSummary && (
                                        <div className={styles.executiveSummary}>
                                            <span className={styles.executiveLabel}>一句话判断</span>
                                            <p className={styles.executiveText}>{executiveSummary}</p>
                                        </div>
                                    )}

                                </div>

                                <div className={styles.marketStrip}>
                                    <MarketMetric label="市值" value={formatMaybeCompact(selected.marketCap)} />
                                    <MarketMetric label="24H 成交额" value={formatMaybeCurrencyCompact(selected.dexPriceStats.h24.volumeUsd)} />
                                    <MarketMetric label="换手率" value={formatMaybeRatio(selected.turnoverRatio)} />
                                    <MarketMetric label="持币地址" value={formatCompact(metrics.totalHolders)} />
                                    <MarketMetric label="流动性" value={formatMaybeCurrencyCompact(selected.totalLiquidityUsd)} />
                                </div>
                            </section>

                            <section className={styles.wideGrid}>
                                <article className={styles.section}>
                                    <div className={styles.sectionHead}>
                                        <div>
                                            <span className={styles.sectionKicker}>控筹快照</span>
                                            <h4 className={styles.sectionTitle}>控筹总览</h4>
                                        </div>
                                    </div>
                                    <div className={styles.metricsGrid}>
                                        <StatCard label="Top1" value={formatTopHolderShare(topHolders, 1)} hint="第一大地址占比" />
                                        <StatCard label="Top5" value={formatTopHolderShare(topHolders, 5)} hint="前五地址占比" />
                                        <StatCard label="Top10" value={formatPercent(metrics.holderSupply.top10.supplyPercent)} hint="前十大地址占比" />
                                        <StatCard label="Top100" value={formatPercent(metrics.holderSupply.top100.supplyPercent)} hint="前一百地址占比" />
                                        <StatCard label="Top50" value={formatPercent(metrics.holderSupply.top50.supplyPercent)} hint="前五十地址占比" />
                                        <StatCard label="7d 变化" value={`${metrics.holderChange['7d'].changePercent.toFixed(2)}%`} hint="持币地址变化" />
                                        <StatCard label="1h 变化" value={`${metrics.holderChange['1h'].changePercent.toFixed(2)}%`} hint="短线扩散速度" />
                                    </div>
                                    <div className={styles.breakdownList}>
                                        {analysis.breakdown.map((item) => (
                                            <BreakdownRow key={item.id} item={item} />
                                        ))}
                                    </div>
                                </article>
                            </section>

                            <section className={styles.contentGrid}>
                                <article className={styles.section}>
                                    <div className={styles.sectionHead}>
                                        <div>
                                            <span className={styles.sectionKicker}>链上交易</span>
                                            <h4 className={styles.sectionTitle}>DEX 链上活动</h4>
                                        </div>
                                    </div>
                                    <DexTradeActivityView trades={selected.dexTrades} />
                                </article>

                                <article className={styles.section}>
                                    <div className={styles.sectionHead}>
                                        <div>
                                            <span className={styles.sectionKicker}>价格行为</span>
                                            <h4 className={styles.sectionTitle}>价格变化 · 成交量</h4>
                                        </div>
                                    </div>
                                    <DexPriceStatsView stats={selected.dexPriceStats} />
                                </article>
                            </section>

                            <section className={styles.wideGrid}>
                                <article className={styles.section}>
                                    <div className={styles.sectionHead}>
                                        <div>
                                            <span className={styles.sectionKicker}>头部地址</span>
                                            <h4 className={styles.sectionTitle}>Top Holders</h4>
                                        </div>
                                    </div>
                                    <TopHoldersView holders={topHolders} />
                                </article>
                            </section>

                            <section className={styles.conclusionSection}>
                                <div className={styles.sectionHead}>
                                    <div>
                                        <span className={styles.sectionKicker}>研究备注</span>
                                        <h4 className={styles.sectionTitle}>研究结论</h4>
                                    </div>
                                </div>
                                <div className={styles.insightList}>
                                    {analysis.insights.map((item, idx) => (
                                        <div key={idx} className={styles.insightItem}>
                                            {item}
                                        </div>
                                    ))}
                                </div>
                                <div className={styles.researchFootnote}>
                                    {data?.notes.map((note, idx) => (
                                        <p key={idx}>{note}</p>
                                    ))}
                                </div>
                            </section>
                        </>
                    ) : (
                        <div className={styles.emptyState}>{scopeMeta.emptyText}</div>
                    )}
                </main>
            </div>
        </section>
    );
}

function DataChip({ label, value }: { label: string; value: string }) {
    return (
        <div className={styles.dataChip}>
            <span className={styles.dataChipLabel}>{label}</span>
            <strong className={styles.dataChipValue}>{value}</strong>
        </div>
    );
}

function StatCard({ label, value, hint }: { label: string; value: string; hint: string }) {
    return (
        <div className={styles.statCard}>
            <span className={styles.statLabel}>{label}</span>
            <strong className={styles.statValue}>{value}</strong>
            <span className={styles.statHint}>{hint}</span>
        </div>
    );
}

function BreakdownRow({ item }: { item: ChipScoreBreakdownItem }) {
    const width = `${Math.min(100, Math.max(10, Math.abs(item.score) * 4))}%`;
    const scoreClass = item.score >= 0 ? styles.positive : styles.negative;

    return (
        <div className={styles.breakdownItem}>
            <div className={styles.breakdownHead}>
                <span>{item.label}</span>
                <strong className={scoreClass}>{item.score >= 0 ? `+${item.score}` : item.score}</strong>
            </div>
            <div className={styles.breakdownMeta}>
                <span>{item.value}</span>
                <span>{item.rationale}</span>
            </div>
            <div className={styles.breakdownTrack}>
                <div
                    className={`${styles.breakdownBar} ${item.score >= 0 ? styles.breakdownPositive : styles.breakdownNegative}`}
                    style={{ width }}
                />
            </div>
        </div>
    );
}

function DexTradeActivityView({ trades }: { trades: TokenSearchResult['dexTrades'] }) {
    const rows: Array<{ label: string; trade: DexTradeWindow }> = [
        { label: '1h', trade: trades.h1 },
        { label: '6h', trade: trades.h6 },
        { label: '24h', trade: trades.h24 },
    ];

    return (
        <div className={styles.activityList}>
            {rows.map(({ label, trade }) => (
                <div key={label} className={styles.activityRow}>
                    <div className={styles.activityLabel}>{label}</div>
                    <div className={styles.activityDetail}>
                        <strong className={styles.positive}>{formatMaybeCount(trade.buys)}买</strong>
                        <strong className={styles.negative}>{formatMaybeCount(trade.sells)}卖</strong>
                        <span>{formatMaybeCount(trade.total)}笔</span>
                    </div>
                </div>
            ))}
        </div>
    );
}

function DexPriceStatsView({ stats }: { stats: TokenSearchResult['dexPriceStats'] }) {
    const rows: Array<{ label: string; stat: DexPriceWindow }> = [
        { label: '5m', stat: stats.m5 },
        { label: '1h', stat: stats.h1 },
        { label: '6h', stat: stats.h6 },
        { label: '24h', stat: stats.h24 },
    ];

    return (
        <div className={styles.activityList}>
            {rows.map(({ label, stat }) => (
                <div key={label} className={styles.activityRow}>
                    <div className={styles.activityLabel}>{label}</div>
                    <div className={styles.activityDetail}>
                        <strong className={toneClassForChange(stat.priceChangePercent)}>
                            {formatMaybeSignedPercent(stat.priceChangePercent)}
                        </strong>
                        <span>Vol: {formatMaybeCurrencyCompact(stat.volumeUsd)}</span>
                    </div>
                </div>
            ))}
        </div>
    );
}

function TopHoldersView({ holders }: { holders: TopHolderItem[] }) {
    if (holders.length === 0) {
        return <div className={styles.emptyState}>当前数据源没有返回 top holders 明细。</div>;
    }

    return (
        <div className={styles.holderTable}>
            {holders.map((holder, index) => (
                <div key={`${holder.address}-${index}`} className={styles.holderRow}>
                    <div>
                        <strong>
                            #{index + 1} {holder.label || holder.entity || 'Unlabeled'}
                        </strong>
                        <div className={styles.walletAddress}>
                            {holder.address.length <= 14
                                ? holder.address
                                : `${holder.address.slice(0, 6)}...${holder.address.slice(-4)}`}
                        </div>
                    </div>
                    <div className={styles.holderMeta}>
                        <strong>{holder.percentage.toFixed(2)}%</strong>
                    </div>
                </div>
            ))}
        </div>
    );
}

function MarketMetric({
    label,
    value,
    tone = 'neutral',
}: {
    label: string;
    value: string;
    tone?: 'up' | 'down' | 'neutral';
}) {
    const toneClass = tone === 'up' ? styles.positive : tone === 'down' ? styles.negative : styles.marketValue;
    return (
        <div className={styles.marketMetric}>
            <span className={styles.marketLabel}>{label}</span>
            <strong className={toneClass}>{value}</strong>
        </div>
    );
}

function formatMaybeCurrency(value: number | null | undefined) {
    if (value === null || value === undefined || !Number.isFinite(value)) {
        return '--';
    }
    if (Math.abs(value) < 0.01) {
        return `$${value.toPrecision(4)}`;
    }
    return formatCurrency(value);
}

function formatMaybeCompact(value: number | null | undefined) {
    if (value === null || value === undefined || !Number.isFinite(value)) {
        return '--';
    }
    return formatCompact(value);
}

function formatMaybeCurrencyCompact(value: number | null | undefined) {
    if (value === null || value === undefined || !Number.isFinite(value)) {
        return '--';
    }

    if (Math.abs(value) >= 1000) {
        return `$${formatCompact(value)}`;
    }

    return formatCurrency(value);
}

function formatPercent(value: number) {
    const normalized = value < 1 ? value * 100 : value;
    return `${normalized.toFixed(2)}%`;
}

function formatMaybeSignedPercent(value: number | null | undefined) {
    if (value === null || value === undefined || !Number.isFinite(value)) {
        return '--';
    }

    return `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`;
}

function formatMaybeRatio(value: number | null | undefined) {
    if (value === null || value === undefined || !Number.isFinite(value)) {
        return '--';
    }

    return `${(value * 100).toFixed(1)}%`;
}

function formatMaybeCount(value: number | null | undefined) {
    if (value === null || value === undefined || !Number.isFinite(value)) {
        return '--';
    }

    return formatCompact(value);
}

function toneClassForChange(value: number | null | undefined) {
    if (value === null || value === undefined || !Number.isFinite(value)) {
        return styles.marketValue;
    }

    return value >= 0 ? styles.positive : styles.negative;
}

function formatTopHolderShare(holders: TopHolderItem[], count: number) {
    if (holders.length === 0) {
        return '--';
    }

    const total = holders.slice(0, count).reduce((sum, holder) => sum + holder.percentage, 0);
    return `${total.toFixed(2)}%`;
}
