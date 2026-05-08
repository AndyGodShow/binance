"use client";

import { useMemo, useState } from 'react';
import { ChevronDown, ChevronUp, ExternalLink, RefreshCw } from 'lucide-react';

import { usePersistentSWR } from '@/hooks/usePersistentSWR';
import type { DailyNewsApiResponse, DailyNewsBrief, DailyNewsDigest, DailyNewsItem, NewsCategory } from '@/lib/dailyNews/types';
import {
    buildNewsViewModel,
    filterNewsItems,
    getCategoryLabel,
    getConfirmationLabel,
    getDirectionLabel,
    getSourceTierLabel,
    type NewsCategoryHealth,
    type NewsFilterKey,
    type NewsFilterOption,
    type NewsHealthStatus,
    type NewsItemViewModel,
    type NewsTopEventsModel,
    type NewsViewModel,
} from '@/lib/dailyNews/viewModel';
import styles from './DailyNewsView.module.css';

const fetcher = async (url: string) => {
    const response = await fetch(url, {
        cache: 'no-store',
    });
    if (!response.ok) {
        throw new Error(`Failed to fetch daily news: ${response.status}`);
    }
    return response.json() as Promise<DailyNewsApiResponse>;
};

function formatInTimeZone(iso: string, timezone: string): string {
    const formatter = new Intl.DateTimeFormat('en-CA', {
        timeZone: timezone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23',
    });
    const parts = Object.fromEntries(
        formatter.formatToParts(new Date(iso)).map((part) => [part.type, part.value])
    );

    return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}`;
}

function formatRelativeTime(iso: string): string {
    const diffMs = Date.now() - new Date(iso).getTime();
    if (!Number.isFinite(diffMs) || diffMs < 0) return '刚刚';

    const minutes = Math.floor(diffMs / 60000);
    if (minutes < 1) return '刚刚';
    if (minutes < 60) return `${minutes} 分钟前`;

    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours} 小时前`;

    return `${Math.floor(hours / 24)} 天前`;
}

function formatWindow(digest: DailyNewsDigest): string {
    return `${formatInTimeZone(digest.windowStart, digest.timezone)} ~ ${formatInTimeZone(digest.windowEnd, digest.timezone)}`;
}

function healthLabel(status: NewsHealthStatus['overallStatus']): string {
    if (status === 'healthy') return '正常';
    if (status === 'partial') return '部分可用';
    if (status === 'degraded') return '部分失败';
    return '数据不足';
}

function categoryStatusLabel(status: NewsCategoryHealth['status']): string {
    if (status === 'success') return '正常';
    if (status === 'failed') return '失败';
    if (status === 'empty') return '空';
    return '部分';
}

function NewsCommandHeader({
    digest,
    model,
    isRefreshing,
    isValidating,
    lastRefreshAt,
    onRefresh,
    message,
}: {
    digest: DailyNewsDigest;
    model: NewsViewModel;
    isRefreshing: boolean;
    isValidating: boolean;
    lastRefreshAt: string | null;
    onRefresh: () => void;
    message?: string;
}) {
    const highest = model.highestScoreItem;

    return (
        <header className={styles.commandHeader}>
            <div className={styles.commandIntro}>
                <div className={styles.kicker}>24 小时事件摘要</div>
                <h1 className={styles.title}>重要事件指挥台</h1>
                <p className={styles.subtitle}>过去 24 小时加密、宏观、AI 事件过滤摘要。</p>
                <div className={styles.windowMeta}>
                    <span>统计窗口：{formatWindow(digest)}</span>
                    <span>生成时间：{formatInTimeZone(digest.generatedAt, digest.timezone)}</span>
                </div>
            </div>

            <div className={styles.commandMetrics}>
                <div className={`${styles.metricTile} ${styles[model.health.overallStatus]}`}>
                    <span>风险偏向</span>
                    <strong>{digest.brief ? getDirectionLabel(digest.brief.riskBias) : '待确认'}</strong>
                </div>
                <div className={styles.metricTile}>
                    <span>入选事件</span>
                    <strong>{model.health.totalSelected} 条</strong>
                </div>
                <div className={styles.metricTile}>
                    <span>重大事件</span>
                    <strong>{model.health.highImpactCount} 条</strong>
                </div>
                <div className={styles.metricTile}>
                    <span>最高分事件</span>
                    <strong>{highest ? `${highest.importanceScore} · ${highest.title}` : '暂无'}</strong>
                </div>
                <div className={`${styles.metricTile} ${styles[model.health.overallStatus]}`}>
                    <span>数据健康</span>
                    <strong>{healthLabel(model.health.overallStatus)}</strong>
                </div>
            </div>

            <aside className={styles.commandActions}>
                <button
                    className={styles.refreshButton}
                    type="button"
                    onClick={onRefresh}
                    disabled={isRefreshing || isValidating}
                    aria-label="刷新重要新闻"
                >
                    <RefreshCw size={16} />
                    <span>{isRefreshing || isValidating ? '刷新中' : '刷新新闻'}</span>
                </button>
                <div className={styles.actionStatus}>
                    <span>上次刷新：{lastRefreshAt ? formatInTimeZone(lastRefreshAt, digest.timezone) : '本次会话尚未手动刷新'}</span>
                    <span>缓存状态：{isValidating ? '正在校验最新摘要' : 'SWR 持久缓存可用'}</span>
                    <span>缓存年龄：{model.health.cacheAgeMinutes === null ? '未知' : `${model.health.cacheAgeMinutes} 分钟`}</span>
                </div>
                {(model.health.overallStatus !== 'healthy' || message) && (
                    <div className={styles.degradedNotice}>
                        {model.health.overallStatus !== 'healthy' ? `${model.health.message}。` : message}
                    </div>
                )}
            </aside>
        </header>
    );
}

function NewsHealthStrip({ health }: { health: NewsHealthStatus }) {
    const categories: NewsCategory[] = ['crypto', 'macro', 'ai'];

    return (
        <section className={styles.healthStrip} aria-label="新闻采集健康状态">
            {categories.map((category) => {
                const item = health.categoryHealth[category];
                return (
                    <div key={category} className={`${styles.healthItem} ${styles[item.status]}`}>
                        <div className={styles.healthTopline}>
                            <strong>{item.label}</strong>
                            <span>{categoryStatusLabel(item.status)}</span>
                        </div>
                        <p>{item.message}</p>
                        <div className={styles.healthCounts}>
                            <span>候选 {item.requested}</span>
                            <span>入选 {item.selected}</span>
                            <span>不相关 {item.irrelevant}</span>
                            <span>不重要 {item.unimportant}</span>
                            <span>重复 {item.duplicates}</span>
                        </div>
                        {item.error && <em>{item.error}</em>}
                    </div>
                );
            })}
        </section>
    );
}

function NewsDigestPanel({
    brief,
    notices,
}: {
    brief?: DailyNewsBrief;
    notices: string[];
}) {
    if (!brief && notices.length === 0) {
        return null;
    }

    return (
        <section className={styles.digestPanel}>
            <div>
                <div className={styles.sectionEyebrow}>摘要判断</div>
                <h2>{brief?.headline || '暂无可用摘要'}</h2>
                {notices.length > 0 && (
                    <div className={styles.digestNotices}>
                        {notices.map((notice) => <p key={notice} className={styles.digestNotice}>{notice}</p>)}
                    </div>
                )}
            </div>
            {brief && (
                <div className={styles.digestMeta}>
                    <span>{getDirectionLabel(brief.riskBias)}</span>
                    <span>重大 {brief.highImpactCount}</span>
                    {brief.driverTags.slice(0, 5).map((tag) => <span key={tag}>{tag}</span>)}
                    {brief.affectedAssets.slice(0, 5).map((asset) => <span key={asset}>{asset}</span>)}
                </div>
            )}
            {brief?.latestSignals && brief.latestSignals.length > 0 && (
                <div className={styles.latestSignals}>
                    {brief.latestSignals.map((signal) => <span key={signal}>{signal}</span>)}
                </div>
            )}
        </section>
    );
}

function TopEventsSection({
    topEvents,
    digest,
}: {
    topEvents: NewsTopEventsModel;
    digest: DailyNewsDigest;
}) {
    const allItems = useMemo(() => [...digest.crypto, ...digest.macro, ...digest.ai], [digest]);

    return (
        <section className={styles.topEventsSection}>
            <div className={styles.sectionHeader}>
                <div>
                    <div className={styles.sectionEyebrow}>Top Events</div>
                    <h2>{topEvents.title}</h2>
                    <p>{topEvents.subtitle}</p>
                </div>
                <span className={styles.sourceBadge}>{topEvents.source === 'digest' ? '摘要生成' : topEvents.source === 'fallback' ? '回退排序' : '空态'}</span>
            </div>
            {topEvents.events.length > 0 ? (
                <div className={styles.topEventList}>
                    {topEvents.events.map((event, index) => {
                        const sourceItem = allItems.find((item) => item.id === event.id);
                        return (
                            <article key={event.id} className={styles.topEventItem}>
                                <div className={styles.topRank}>{index + 1}</div>
                                <div className={styles.topEventBody}>
                                    <h3>{event.headline}</h3>
                                    <p>{event.whyImportant.replace(/^为什么重要：/, '')}</p>
                                    <div className={styles.inlineMeta}>
                                        <span>{getCategoryLabel(event.category)}</span>
                                        <span>{getConfirmationLabel(event.confirmationLevel)}</span>
                                        <span>{getSourceTierLabel(event.sourceTier)}</span>
                                        <span>{event.importanceScore}</span>
                                    </div>
                                    {sourceItem && (
                                        <a href={sourceItem.url} target="_blank" rel="noreferrer">
                                            原文 <ExternalLink size={13} aria-hidden="true" />
                                        </a>
                                    )}
                                </div>
                            </article>
                        );
                    })}
                </div>
            ) : (
                <div className={styles.emptyState}>
                    过去 24 小时暂无达到入选标准的重大事件。请查看上方采集健康状态，失败分类不代表没有新闻。
                </div>
            )}
        </section>
    );
}

function NewsFilterTabs({
    filters,
    activeFilter,
    onChange,
}: {
    filters: NewsFilterOption[];
    activeFilter: NewsFilterKey;
    onChange: (filter: NewsFilterKey) => void;
}) {
    return (
        <div className={styles.filterTabs} aria-label="新闻筛选">
            {filters.map((filter) => (
                <button
                    key={filter.key}
                    type="button"
                    className={`${styles.filterButton} ${activeFilter === filter.key ? styles.activeFilter : ''} ${filter.weak ? styles.weakFilter : ''}`}
                    onClick={() => onChange(filter.key)}
                >
                    <span>{filter.label}</span>
                    <strong>{filter.count}</strong>
                </button>
            ))}
        </div>
    );
}

function ScoreBreakdown({ item }: { item: DailyNewsItem }) {
    if (!item.scoreBreakdown) {
        return <div className={styles.scoreEmpty}>暂无评分拆解。</div>;
    }

    const entries = [
        ['实体', item.scoreBreakdown.entityWeight],
        ['来源', item.scoreBreakdown.sourceWeight],
        ['确认', item.scoreBreakdown.confirmationWeight],
        ['类别', item.scoreBreakdown.categoryWeight],
        ['新信息', item.scoreBreakdown.noveltyWeight],
        ['影响', item.scoreBreakdown.impactWeight],
    ] as const;

    return (
        <div className={styles.scoreGrid}>
            {entries.map(([label, value]) => (
                <div key={label}>
                    <span>{label}</span>
                    <strong>{value}</strong>
                </div>
            ))}
        </div>
    );
}

function EventCard({
    model,
    expanded,
    onToggle,
    timezone,
}: {
    model: NewsItemViewModel;
    expanded: boolean;
    onToggle: () => void;
    timezone: string;
}) {
    const { item, card } = model;
    const confidenceClass = item.confirmationLevel === 'single_source' ? styles.lowConfidence : '';

    return (
        <article className={`${styles.eventCard} ${item.importanceLevel === 'high' ? styles.highImpact : ''} ${confidenceClass}`}>
            <div className={styles.eventHeader}>
                <div>
                    <div className={styles.eventMetaLine}>
                        <span>{card.categoryLabel}</span>
                        <span>{formatRelativeTime(item.publishedAt)}</span>
                        <span>{item.source}</span>
                    </div>
                    <h3>{item.title}</h3>
                </div>
                <div className={styles.scorePill}>
                    <span>{item.importanceLevel === 'high' ? '重大' : item.importanceLevel === 'medium' ? '重要' : '观察'}</span>
                    <strong>{item.importanceScore}</strong>
                </div>
            </div>

            <p className={styles.whyImportant}>{card.whyImportant.replace(/^为什么重要：/, '')}</p>

            <div className={styles.eventFactGrid}>
                <span>{card.confirmationLabel}</span>
                <span>{card.sourceTierLabel}</span>
                <span>{card.directionLabel}</span>
                <span>{card.horizonLabel}</span>
                <span>{formatInTimeZone(item.publishedAt, timezone)}</span>
                <span>{card.affectedAssets.length > 0 ? card.affectedAssets.slice(0, 4).join('、') : '未标记资产'}</span>
            </div>

            <button className={styles.expandButton} type="button" onClick={onToggle} aria-expanded={expanded}>
                <span>{expanded ? '收起事件细节' : '展开事件细节'}</span>
                {expanded ? <ChevronUp size={14} aria-hidden="true" /> : <ChevronDown size={14} aria-hidden="true" />}
            </button>

            {expanded && (
                <div className={styles.expandedBody}>
                    <div className={styles.summarySections}>
                        <div>
                            <span>发生了什么</span>
                            <p>{(item.summarySections?.whatHappened || item.summary).replace(/^发生了什么：/, '')}</p>
                        </div>
                        <div>
                            <span>为什么重要</span>
                            <p>{(item.summarySections?.whyImportant || item.whyItMatters || item.summary).replace(/^为什么重要：/, '')}</p>
                        </div>
                        <div>
                            <span>后续看什么</span>
                            <p>{(item.summarySections?.whatToWatch || item.watchpoints?.[0] || '后续看官方文件、数据修正和更多来源是否确认。').replace(/^后续看什么：/, '')}</p>
                        </div>
                        <div>
                            <span>来源与确认度</span>
                            <p>{(item.summarySections?.sourceAndConfirmation || item.editorialReason || '暂无来源确认说明。').replace(/^来源与确认度：/, '')}</p>
                        </div>
                    </div>

                    {item.timeline && item.timeline.length > 0 && (
                        <div className={styles.timeline}>
                            <span className={styles.blockLabel}>事件时间线</span>
                            {item.timeline.map((entry) => (
                                <a key={`${entry.label}-${entry.url}`} href={entry.url} target="_blank" rel="noreferrer" className={styles.timelineEntry}>
                                    <span>{entry.label}</span>
                                    <strong>{entry.source}</strong>
                                    <em>{formatInTimeZone(entry.publishedAt, timezone)}</em>
                                </a>
                            ))}
                        </div>
                    )}

                    {item.watchpoints && item.watchpoints.length > 0 && (
                        <div className={styles.watchpoints}>
                            <span className={styles.blockLabel}>后续看点</span>
                            {item.watchpoints.slice(0, 4).map((point) => <span key={point}>{point}</span>)}
                        </div>
                    )}

                    <ScoreBreakdown item={item} />

                    <a className={styles.originalLink} href={item.url} target="_blank" rel="noreferrer">
                        打开原文 <ExternalLink size={14} aria-hidden="true" />
                    </a>
                </div>
            )}
        </article>
    );
}

function CategoryStatusPanel({ health }: { health: NewsHealthStatus }) {
    const categories: NewsCategory[] = ['crypto', 'macro', 'ai'];

    return (
        <section className={styles.categoryStatusPanel}>
            <div className={styles.sectionHeader}>
                <div>
                    <div className={styles.sectionEyebrow}>采集诊断</div>
                    <h2>分类状态与过滤计数</h2>
                </div>
                <span className={styles.sourceBadge}>{health.message}</span>
            </div>
            <div className={styles.statusTable}>
                {categories.map((category) => {
                    const item = health.categoryHealth[category];
                    return (
                        <div key={category} className={styles.statusRow}>
                            <strong>{item.label}</strong>
                            <span>{categoryStatusLabel(item.status)}</span>
                            <span>候选 {item.requested}</span>
                            <span>入选 {item.selected}</span>
                            <span>不相关 {item.irrelevant}</span>
                            <span>不重要 {item.unimportant}</span>
                            <span>重复 {item.duplicates}</span>
                            <em>{item.error || item.message}</em>
                        </div>
                    );
                })}
            </div>
        </section>
    );
}

function EmptyOrDegradedState({
    model,
    filteredCount,
}: {
    model: NewsViewModel;
    filteredCount: number;
}) {
    if (filteredCount > 0) {
        return null;
    }

    if (model.allItems.length === 0) {
        return (
            <div className={styles.emptyState}>
                过去 24 小时暂无达到入选标准的重大事件。若上方存在失败分类，请将其理解为采集失败，不代表对应领域没有新闻。
            </div>
        );
    }

    return <div className={styles.emptyState}>当前筛选下没有入选事件，可切回“全部”查看。</div>;
}

export default function DailyNewsView() {
    const [expandedItems, setExpandedItems] = useState<Set<string>>(() => new Set());
    const [activeFilter, setActiveFilter] = useState<NewsFilterKey>('all');
    const [isRefreshing, setIsRefreshing] = useState(false);
    const [lastRefreshAt, setLastRefreshAt] = useState<string | null>(null);
    const { data, error, isLoading, isValidating, mutate } = usePersistentSWR<DailyNewsApiResponse>(
        '/api/daily-news',
        fetcher,
        {
            refreshInterval: 5 * 60 * 1000,
            revalidateOnFocus: true,
            dedupingInterval: 30 * 1000,
            storageTtlMs: 2 * 60 * 60 * 1000,
            persistIntervalMs: 60 * 1000,
            storageKey: 'persistent-swr:v4:/api/daily-news:important-news',
        }
    );

    const digest = data?.digest;
    const model = useMemo(() => digest ? buildNewsViewModel(digest) : null, [digest]);
    const filteredItems = useMemo(() => {
        if (!model) return [];
        const filteredRawItems = filterNewsItems(model.allItems, activeFilter);
        const filteredIds = new Set(filteredRawItems.map((item) => item.id));
        return model.items.filter((itemModel) => filteredIds.has(itemModel.item.id));
    }, [activeFilter, model]);

    const toggleExpandedItem = (itemId: string) => {
        setExpandedItems((current) => {
            const next = new Set(current);
            if (next.has(itemId)) {
                next.delete(itemId);
            } else {
                next.add(itemId);
            }
            return next;
        });
    };

    const handleRefresh = async () => {
        setIsRefreshing(true);
        try {
            await mutate(fetcher('/api/daily-news?refresh=1'), {
                populateCache: true,
                revalidate: false,
            });
            setLastRefreshAt(new Date().toISOString());
        } finally {
            setIsRefreshing(false);
        }
    };

    if (isLoading && !digest) {
        return <div className={styles.placeholder}>重要新闻正在读取最新摘要…</div>;
    }

    if (error && !digest) {
        return <div className={styles.placeholder}>重要新闻暂时不可用，请稍后重试。</div>;
    }

    if (!digest || !model) {
        return (
            <section className={styles.page}>
                <div className={styles.emptyState}>
                    暂时还没有可展示的重要新闻摘要。系统会自动生成最近 24 小时的重要事件，稍后刷新即可查看最新结果。
                </div>
            </section>
        );
    }

    return (
        <section className={styles.page}>
            <NewsCommandHeader
                digest={digest}
                model={model}
                isRefreshing={isRefreshing}
                isValidating={isValidating}
                lastRefreshAt={lastRefreshAt}
                onRefresh={handleRefresh}
                message={data?.message}
            />
            <NewsHealthStrip health={model.health} />
            <NewsDigestPanel brief={digest.brief} notices={model.briefNotices} />
            <TopEventsSection topEvents={model.topEvents} digest={digest} />

            <section className={styles.eventWorkspace}>
                <div className={styles.sectionHeader}>
                    <div>
                        <div className={styles.sectionEyebrow}>事件工作台</div>
                        <h2>入选事件</h2>
                        <p>按重要性分数、确认度和发布时间排序。</p>
                    </div>
                    <span className={styles.sourceBadge}>显示 {filteredItems.length} / {model.allItems.length}</span>
                </div>
                <NewsFilterTabs filters={model.filters} activeFilter={activeFilter} onChange={setActiveFilter} />
                <EmptyOrDegradedState model={model} filteredCount={filteredItems.length} />
                {filteredItems.length > 0 && (
                    <div className={styles.eventList}>
                        {filteredItems.map((itemModel) => (
                            <EventCard
                                key={itemModel.item.id}
                                model={itemModel}
                                expanded={expandedItems.has(itemModel.item.id)}
                                onToggle={() => toggleExpandedItem(itemModel.item.id)}
                                timezone={digest.timezone}
                            />
                        ))}
                    </div>
                )}
            </section>

            <CategoryStatusPanel health={model.health} />
        </section>
    );
}
