"use client";

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { usePersistentSWR } from '@/hooks/usePersistentSWR';
import { formatCompact, formatCurrency } from '@/lib/utils';
import {
    buildOnchainStorageKey,
} from '@/lib/onchain/presenter';
import { getFallbackBannerMessage } from '@/lib/onchain/service';
import type {
    DexPriceWindow,
    DexTradeWindow,
    OnchainSearchScope,
    TokenResearchPayload,
    TokenSearchResult,
    TopHolderItem,
    ClassifiedHolder,
} from '@/lib/onchain/types';
import styles from './OnchainTracker.module.css';

const DEFAULT_QUERY = 'PEPE';
const MAX_QUERY_LENGTH = 64;
const SUBMIT_COOLDOWN_MS = 2000;

const normalizeQueryInput = (value: string) => value.trim().slice(0, MAX_QUERY_LENGTH) || DEFAULT_QUERY;

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
    const shouldUsePersistedOnchainData = useCallback(
        (payload: TokenResearchPayload) => payload.sourceMode === 'hybrid',
        []
    );

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
            shouldPersistData: shouldUsePersistedOnchainData,
            shouldRestoreData: shouldUsePersistedOnchainData,
        }
    );

    const displayData = useMemo(() => {
        if (!data || data.query !== query || data.scope !== scope) {
            return undefined;
        }

        return data;
    }, [data, query, scope]);
    const selected = displayData?.selectedToken ?? null;
    const metrics = displayData?.metrics ?? null;
    const analysis = displayData?.analysis ?? null;
    const topHolders = displayData?.topHolders ?? [];
    const holderConcentration = displayData?.holderConcentration ?? null;
    const supplyBreakdown = displayData?.supplyBreakdown ?? null;
    const dataQuality = displayData?.dataQuality ?? null;
    const identity = displayData?.identity ?? null;
    const eligibility = displayData?.eligibility ?? null;
    const isStaleData = data !== undefined && displayData === undefined;

    const isFallback = displayData?.sourceMode === 'fallback';
    const isCandidateMapping = displayData?.mappingStatus === 'candidate';
    const fallbackMessage = useMemo(
        () => getFallbackBannerMessage(displayData?.fallbackReason),
        [displayData?.fallbackReason]
    );

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

        const nextQuery = normalizeQueryInput(input);
        setQuery(nextQuery);
    }, [input]);

    useEffect(() => () => {
        if (cooldownTimerRef.current) {
            clearTimeout(cooldownTimerRef.current);
        }
    }, []);

    const scopeMeta = useMemo(() => (
        scope === 'alpha'
            ? {
                label: '币安 Alpha',
                subtitle: '先从币安 Alpha 名录定位候选地址，再展示身份可信度、原始 holder 分布和数据异常。',
                badge: 'Alpha 观察',
                emptyText: '输入一个 Alpha 币后，这里会围绕候选地址展示链上筹码结构观察和数据可信度。',
                directText: '已按 Binance Alpha 名录优先定位候选地址，并通过可信度门槛决定是否展示分析。',
            }
            : {
                label: '币安合约',
                subtitle: '合约标的只证明币安有交易市场，链上地址必须单独校验；本页先展示原始数据和可信度门槛。',
                badge: '合约观察',
                emptyText: '输入一个合约币后，这里会展示候选链上地址、原始 holder 集中度和数据可信度。',
                directText: '币安合约 universe 不能证明链上合约地址，本页会对 fallback 地址降级展示。',
            }
    ), [scope]);

    return (
        <section className={styles.page}>
            <header className={styles.hero}>
                <div className={styles.heroMain}>
                    <div className={styles.heroCopy}>
                        <span className={styles.kicker}>Onchain Holder Review</span>
                        <h2 className={styles.title}>链上筹码结构观察</h2>
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
                                    setQuery(normalizeQueryInput(input));
                                }}
                            >
                                币安合约
                            </button>
                            <button
                                type="button"
                                className={`${styles.scopeButton} ${scope === 'alpha' ? styles.scopeButtonActive : ''}`}
                                onClick={() => {
                                    setScope('alpha');
                                    setQuery(normalizeQueryInput(input));
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

            </header>

            {error && <div className={styles.errorBanner}>单币筹码分析加载失败，请稍后再试。</div>}

            {isFallback && (
                <div className={styles.fallbackBanner}>
                    {fallbackMessage}
                </div>
            )}

            {isCandidateMapping && (
                <div className={styles.fallbackBanner}>
                    候选待确认：当前合约地址来自市值、流动性、持币人数和名称匹配的二次筛选，不是官方确认地址，本次只展示原始数据。
                </div>
            )}

            {(isLoading || isStaleData) && (
                <div className={styles.emptyState}>正在加载 {query} 的链上筹码观察…</div>
            )}

            <div className={styles.singleWorkspace}>
                <main className={styles.main}>
                    {selected && metrics ? (
                        <>
                            <section className={styles.tokenHero}>
                                <div className={styles.tokenMain}>
                                    <div className={styles.tokenHeader}>
                                        <div>
                                            <div className={styles.tokenRow}>
                                                <h3 className={styles.tokenTitle}>{selected.symbol}</h3>
                                                <span className={styles.scopeBadge}>{scopeMeta.badge}</span>
                                                {isCandidateMapping && <span className={styles.chainBadge}>候选待确认</span>}
                                                <span className={styles.chainBadge}>{selected.chainName}</span>
                                                {eligibility && <span className={styles.scoreBadge}>{eligibility.category} 类 · {eligibilityLabel(eligibility.level)}</span>}
                                            </div>
                                            <p className={styles.tokenName}>{selected.name}</p>
                                        </div>
                                        <div className={styles.priceCluster}>
                                            <strong className={styles.priceValue}>{formatMaybeCurrency(selected.usdPrice)}</strong>
                                            <span className={styles.priceHint}>现价快照</span>
                                        </div>
                                    </div>

                                    {identity && eligibility && (
                                        <div className={styles.qualityPanel}>
                                            <div>
                                                <span className={styles.executiveLabel}>身份可信度</span>
                                                <strong className={qualityClassName(identityConfidenceToQuality(identity.confidence))}>
                                                    {identity.confidence}
                                                </strong>
                                            </div>
                                            <p>{identity.address ? `${identity.symbol} · ${identity.chain} · ${truncateAddress(identity.address)}` : '当前没有可确认链上地址。'}</p>
                                            <div className={styles.qualityMeta}>
                                                <span>{eligibility.category} 类</span>
                                                <span>{eligibilityLabel(eligibility.level)}</span>
                                                <span>{identity.riskFlags.length} 个风险标记</span>
                                            </div>
                                            <div className={styles.qualityWarnings}>
                                                {[...identity.evidence, ...identity.riskFlags, ...eligibility.reasons].slice(0, 5).map((item) => (
                                                    <span key={item}>{item}</span>
                                                ))}
                                            </div>
                                        </div>
                                    )}

                                    {dataQuality && (
                                        <div className={styles.qualityPanel}>
                                            <div>
                                                <span className={styles.executiveLabel}>数据可信度</span>
                                                <strong className={qualityClassName(dataQuality.confidence)}>
                                                    {dataQuality.confidence}可信
                                                </strong>
                                            </div>
                                            <p>{dataQuality.summary}</p>
                                            <div className={styles.qualityMeta}>
                                                <span>Top holders {dataQuality.topHoldersCount}</span>
                                                <span>历史 {dataQuality.historicalDays} 天</span>
                                                <span>污染占比 {dataQuality.flaggedTopHolderSharePercent.toFixed(2)}%</span>
                                            </div>
                                            {dataQuality.warnings.length > 0 && (
                                                <div className={styles.qualityWarnings}>
                                                    {dataQuality.warnings.slice(0, 3).map((warning) => (
                                                        <span key={warning}>{warning}</span>
                                                    ))}
                                                </div>
                                            )}
                                        </div>
                                    )}

                                    {supplyBreakdown && (
                                        <div className={styles.qualityPanel}>
                                            <div>
                                                <span className={styles.executiveLabel}>供应口径</span>
                                                <strong className={qualityClassName(supplyConfidenceToQuality(supplyBreakdown.confidence))}>
                                                    {supplyBreakdown.confidence}
                                                </strong>
                                            </div>
                                            <p>估算可流通供应不等于真实流通量，当前口径依赖 Top holders balance、percentage 与地址分类质量。</p>
                                            <div className={styles.qualityMeta}>
                                                <span>Total {formatMaybeCompact(supplyBreakdown.totalSupply)}</span>
                                                <span>Float {formatMaybeCompact(supplyBreakdown.estimatedFloatSupply)}</span>
                                                <span>Unknown {formatMaybeCompact(supplyBreakdown.unknownTopHolderSupply)}</span>
                                            </div>
                                            {(supplyBreakdown.warnings.length > 0 || supplyBreakdown.evidence.length > 0) && (
                                                <div className={styles.qualityWarnings}>
                                                    {[...supplyBreakdown.warnings, ...supplyBreakdown.evidence].slice(0, 4).map((item) => (
                                                        <span key={item}>{item}</span>
                                                    ))}
                                                </div>
                                            )}
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
                                            <span className={styles.sectionKicker}>原始数据</span>
                                            <h4 className={styles.sectionTitle}>原始 Holder 集中度快照</h4>
                                        </div>
                                        <p className={styles.sectionHint}>这里是未净化的原始链上读数，可能包含交易所、LP、销毁、合约或项目方地址。</p>
                                    </div>
                                    <div className={styles.metricsGrid}>
                                        <StatCard label="Top1" value={formatTopHolderShare(topHolders, 1)} hint="第一大地址占比" />
                                        <StatCard label="Top5" value={formatTopHolderShare(topHolders, 5)} hint="前五地址占比" />
                                        <StatCard label="Top10" value={formatPercent(metrics.holderSupply.top10.supplyPercent)} hint="前十大地址占比" />
                                        <StatCard label="Top50" value={formatPercent(metrics.holderSupply.top50.supplyPercent)} hint="前五十地址占比" />
                                        <StatCard label="Top100" value={formatPercent(metrics.holderSupply.top100.supplyPercent)} hint="前一百地址占比" />
                                        <StatCard label="7d 变化" value={`${metrics.holderChange['7d'].changePercent.toFixed(2)}%`} hint="地址数量变化" />
                                        <StatCard label="1h 变化" value={`${metrics.holderChange['1h'].changePercent.toFixed(2)}%`} hint="短线地址数变化" />
                                    </div>
                                </article>
                            </section>

                            <section className={styles.contentGrid}>
                                <article className={styles.section}>
                                    <div className={styles.sectionHead}>
                                        <div>
                                            <span className={styles.sectionKicker}>DEX 活跃度</span>
                                            <h4 className={styles.sectionTitle}>DEX 交易笔数</h4>
                                        </div>
                                    </div>
                                    <DexTradeActivityView trades={selected.dexTrades} />
                                </article>

                                <article className={styles.section}>
                                    <div className={styles.sectionHead}>
                                        <div>
                                            <span className={styles.sectionKicker}>市场活跃度</span>
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

                            {holderConcentration && (
                                <section className={styles.contentGrid}>
                                    <article className={styles.section}>
                                        <div className={styles.sectionHead}>
                                            <div>
                                                <span className={styles.sectionKicker}>地址分类</span>
                                                <h4 className={styles.sectionTitle}>分类拆解</h4>
                                            </div>
                                            <p className={styles.sectionHint}>该结果依赖标签质量，未知地址不会被当成确定普通钱包。</p>
                                        </div>
                                        <div className={styles.metricsGrid}>
                                            <StatCard label="疑似非流通" value={`${holderConcentration.excludedSharePercent.toFixed(2)}%`} hint="被剔除地址占比" />
                                            <StatCard label="未知地址" value={`${holderConcentration.unknownSharePercent.toFixed(2)}%`} hint="未能可靠分类" />
                                            {eligibility?.level === 'analysis_allowed' ? (
                                                <>
                                                    <StatCard label="净化 Top1" value={formatNullablePercent(holderConcentration.floatTop1)} hint="仅 user_wallet + unknown" />
                                                    <StatCard label="净化 Top5" value={formatNullablePercent(holderConcentration.floatTop5)} hint="不生成 Top50/Top100" />
                                                </>
                                            ) : (
                                                <StatCard label="净化观察" value="已隐藏" hint="未通过 eligibility gate" />
                                            )}
                                        </div>
                                    </article>

                                    {supplyBreakdown && (
                                        <article className={styles.section}>
                                            <div className={styles.sectionHead}>
                                                <div>
                                                    <span className={styles.sectionKicker}>供应口径</span>
                                                    <h4 className={styles.sectionTitle}>估算可流通供应</h4>
                                                </div>
                                                <p className={styles.sectionHint}>该数值为估算，不等于真实流通量；低可信时不会生成净化后 TopN。</p>
                                            </div>
                                            <div className={styles.metricsGrid}>
                                                <StatCard label="Total Supply" value={formatMaybeCompact(supplyBreakdown.totalSupply)} hint="Top holders 反推估算" />
                                                <StatCard label="Circulating" value={formatMaybeCompact(supplyBreakdown.circulatingSupply)} hint="当前无独立来源则为空" />
                                                <StatCard label="Estimated Float" value={formatMaybeCompact(supplyBreakdown.estimatedFloatSupply)} hint="扣除已识别非流通/基础设施" />
                                                <StatCard label="Burned" value={formatMaybeCompact(supplyBreakdown.burnedSupply)} hint="销毁地址供应" />
                                                <StatCard label="Infrastructure" value={formatMaybeCompact(supplyBreakdown.lockedOrInfrastructureSupply)} hint="LP/treasury/vesting/staking/bridge/contract" />
                                                <StatCard label="CEX" value={formatMaybeCompact(supplyBreakdown.cexSupply)} hint="交易所标签地址" />
                                                <StatCard label="Unknown" value={formatMaybeCompact(supplyBreakdown.unknownTopHolderSupply)} hint="未知地址供应占比需复核" />
                                                <StatCard label="Confidence" value={supplyBreakdown.confidence} hint="供应口径可信度" />
                                            </div>
                                        </article>
                                    )}

                                    <article className={styles.section}>
                                        <div className={styles.sectionHead}>
                                            <div>
                                                <span className={styles.sectionKicker}>剔除列表</span>
                                                <h4 className={styles.sectionTitle}>疑似非流通/基础设施地址</h4>
                                            </div>
                                        </div>
                                        <ClassifiedHolderList holders={holderConcentration.excludedTopHolders} />
                                    </article>
                                </section>
                            )}

                            {analysis && eligibility?.level === 'analysis_allowed' ? (
                                <section className={styles.conclusionSection}>
                                    <div className={styles.sectionHead}>
                                        <div>
                                            <span className={styles.sectionKicker}>净化后观察</span>
                                            <h4 className={styles.sectionTitle}>链上筹码结构观察</h4>
                                        </div>
                                    </div>
                                    <div className={styles.insightList}>
                                        {analysis.summaryCards.map((item) => (
                                            <div key={item.title} className={styles.insightItem}>
                                                <strong>{item.title}：{item.value}</strong>
                                                <span>{item.description}</span>
                                            </div>
                                        ))}
                                        {analysis.insights.map((item, idx) => (
                                            <div key={idx} className={styles.insightItem}>
                                                {item}
                                            </div>
                                        ))}
                                    </div>
                                    <div className={styles.researchFootnote}>
                                        {displayData?.notes.map((note, idx) => (
                                            <p key={idx}>{note}</p>
                                        ))}
                                    </div>
                                </section>
                            ) : (
                                <section className={styles.conclusionSection}>
                                    <div className={styles.sectionHead}>
                                        <div>
                                            <span className={styles.sectionKicker}>分析已隐藏</span>
                                            <h4 className={styles.sectionTitle}>仅展示原始数据</h4>
                                        </div>
                                    </div>
                                    <div className={styles.researchFootnote}>
                                        {(eligibility?.reasons ?? ['当前数据未通过可信度门槛。']).map((reason) => (
                                            <p key={reason}>{reason}</p>
                                        ))}
                                        {(eligibility?.requiredManualChecks ?? []).map((item) => (
                                            <p key={item}>需人工复核：{item}</p>
                                        ))}
                                        {displayData?.notes.map((note, idx) => (
                                            <p key={idx}>{note}</p>
                                        ))}
                                    </div>
                                </section>
                            )}
                        </>
                    ) : selected ? (
                        <section className={styles.tokenHero}>
                            <div className={styles.tokenMain}>
                                <div className={styles.tokenHeader}>
                                    <div>
                                        <div className={styles.tokenRow}>
                                            <h3 className={styles.tokenTitle}>{selected.symbol}</h3>
                                            <span className={styles.scopeBadge}>{scopeMeta.badge}</span>
                                            <span className={styles.chainBadge}>{selected.chainName}</span>
                                        </div>
                                        <p className={styles.tokenName}>{selected.name}</p>
                                    </div>
                                    <div className={styles.priceCluster}>
                                        <strong className={styles.priceValue}>{formatMaybeCurrency(selected.usdPrice)}</strong>
                                        <span className={styles.priceHint}>现价快照</span>
                                    </div>
                                </div>
                            </div>

                            <div className={styles.marketStrip}>
                                <MarketMetric label="市值" value={formatMaybeCompact(selected.marketCap)} />
                                <MarketMetric label="24H 成交额" value={formatMaybeCurrencyCompact(selected.dexPriceStats.h24.volumeUsd)} />
                                <MarketMetric label="流动性" value={formatMaybeCurrencyCompact(selected.totalLiquidityUsd)} />
                                <MarketMetric label="候选地址" value={truncateAddress(selected.tokenAddress)} />
                                <MarketMetric label="所属链" value={selected.chainName} />
                            </div>

                            <section className={styles.conclusionSection}>
                                <div className={styles.sectionHead}>
                                    <div>
                                        <span className={styles.sectionKicker}>数据状态</span>
                                        <h4 className={styles.sectionTitle}>当前状态</h4>
                                    </div>
                                </div>
                                <div className={styles.researchFootnote}>
                                    {displayData?.notes.map((note, idx) => (
                                        <p key={idx}>{note}</p>
                                    ))}
                                </div>
                            </section>
                        </section>
                    ) : (
                        <div className={styles.emptyState}>{scopeMeta.emptyText}</div>
                    )}
                </main>
            </div>
        </section>
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
            <div className={`${styles.holderRow} ${styles.holderHeaderRow}`}>
                <span>排名</span>
                <span>地址 / 标签</span>
                <span>占比</span>
            </div>
            {holders.map((holder, index) => (
                <div key={`${holder.address}-${index}`} className={styles.holderRow}>
                    <div className={styles.holderRank}>#{index + 1}</div>
                    <div className={styles.holderIdentity}>
                        <div className={styles.holderNameLine}>
                            <strong>{holder.label || holder.entity || '未标记地址'}</strong>
                            {holder.isContract && <span className={styles.holderTag}>合约</span>}
                        </div>
                        <div className={styles.walletAddress}>{truncateAddress(holder.address)}</div>
                    </div>
                    <div className={styles.holderMeta}>
                        <strong>{formatHolderPercent(holder.percentage)}</strong>
                    </div>
                </div>
            ))}
        </div>
    );
}

function ClassifiedHolderList({ holders }: { holders: ClassifiedHolder[] }) {
    if (holders.length === 0) {
        return <div className={styles.emptyState}>当前 Top holders 中没有识别到需要剔除的基础设施地址。</div>;
    }

    return (
        <div className={styles.holderTable}>
            {holders.slice(0, 6).map((holder, index) => (
                <div key={`${holder.address}-${index}`} className={styles.holderRow}>
                    <div className={styles.holderRank}>#{index + 1}</div>
                    <div className={styles.holderIdentity}>
                        <div className={styles.holderNameLine}>
                            <strong>{holder.label || holder.entity || classLabel(holder.class)}</strong>
                            <span className={styles.holderTag}>{classLabel(holder.class)}</span>
                        </div>
                        <div className={styles.walletAddress}>{truncateAddress(holder.address)}</div>
                    </div>
                    <div className={styles.holderMeta}>
                        <strong>{formatNullablePercent(holder.percentage)}</strong>
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
    if (!Number.isFinite(value)) {
        return '--';
    }

    const normalized = value < 1 ? value * 100 : value;
    if (normalized < 0 || normalized > 100) {
        return '异常';
    }

    return `${normalized.toFixed(2)}%`;
}

function formatNullablePercent(value: number | null | undefined) {
    if (value === null || value === undefined || !Number.isFinite(value)) {
        return '--';
    }

    return `${value.toFixed(2)}%`;
}

function classLabel(value: ClassifiedHolder['class']) {
    switch (value) {
        case 'lp_pool': return 'LP/Pool';
        case 'burn': return 'Burn';
        case 'cex': return 'CEX';
        case 'treasury': return 'Treasury';
        case 'vesting': return 'Vesting';
        case 'staking': return 'Staking';
        case 'bridge': return 'Bridge';
        case 'router': return 'Router';
        case 'contract': return 'Contract';
        case 'market_maker': return 'MM';
        case 'user_wallet': return 'Wallet';
        case 'unknown':
        default:
            return 'Unknown';
    }
}

function truncateAddress(value: string) {
    if (value.length <= 14) {
        return value;
    }

    return `${value.slice(0, 6)}...${value.slice(-4)}`;
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

function qualityClassName(confidence: '高' | '中' | '低') {
    if (confidence === '高') return `${styles.qualityValue} ${styles.qualityHigh}`;
    if (confidence === '中') return `${styles.qualityValue} ${styles.qualityMedium}`;
    return `${styles.qualityValue} ${styles.qualityLow}`;
}

function identityConfidenceToQuality(confidence: TokenResearchPayload['identity']['confidence']): '高' | '中' | '低' {
    if (confidence === 'official' || confidence === 'probable') return '高';
    if (confidence === 'fallback') return '中';
    return '低';
}

function supplyConfidenceToQuality(confidence: TokenResearchPayload['supplyBreakdown']['confidence']): '高' | '中' | '低' {
    if (confidence === 'high') return '高';
    if (confidence === 'medium') return '中';
    return '低';
}

function eligibilityLabel(level: TokenResearchPayload['eligibility']['level']) {
    if (level === 'analysis_allowed') return '允许观察';
    if (level === 'raw_only') return '仅原始数据';
    return '已阻断';
}

function formatTopHolderShare(holders: TopHolderItem[], count: number) {
    if (holders.length === 0) {
        return '--';
    }

    const selectedHolders = holders.slice(0, count);
    if (selectedHolders.some((holder) => holder.percentage < 0 || holder.percentage > 100 || !Number.isFinite(holder.percentage))) {
        return '异常';
    }

    const total = selectedHolders.reduce((sum, holder) => sum + holder.percentage, 0);
    if (total > 100.000001) {
        return '异常';
    }

    return `${total.toFixed(2)}%`;
}

function formatHolderPercent(value: number) {
    if (!Number.isFinite(value) || value < 0 || value > 100) {
        return '异常';
    }

    return `${value.toFixed(2)}%`;
}
