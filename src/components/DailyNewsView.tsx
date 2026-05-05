"use client";

import { useMemo, useState } from 'react';
import { ChevronDown, ChevronUp, ExternalLink } from 'lucide-react';

import { usePersistentSWR } from '@/hooks/usePersistentSWR';
import type { DailyNewsApiResponse, DailyNewsBrief, DailyNewsDigest, DailyNewsItem, DailyNewsTopStory, NewsCategory } from '@/lib/dailyNews/types';
import styles from './DailyNewsView.module.css';

const CATEGORY_CONFIG: Array<{
    key: NewsCategory;
    title: string;
    subtitle: string;
}> = [
    { key: 'crypto', title: '加密主栏', subtitle: '监管、ETF、稳定币、交易所、安全与主流网络' },
    { key: 'macro', title: '宏观新闻', subtitle: '央行、利率、通胀、地缘与大类资产' },
    { key: 'ai', title: '人工智能新闻', subtitle: '模型、芯片、产品、融资与监管' },
];

const fetcher = async (url: string) => {
    const response = await fetch(url);
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

function getImportanceLabel(item: DailyNewsItem): string {
    if (item.importanceLevel === 'high') return `重大 · ${item.importanceScore}`;
    if (item.importanceLevel === 'medium') return `重要 · ${item.importanceScore}`;
    return `观察 · ${item.importanceScore}`;
}

function getStatusLabel(digest: DailyNewsDigest, category: NewsCategory): string {
    const status = digest.categoryStatus[category];
    if (!status) return '状态未知';
    if (status.status === 'failed') return '抓取失败';
    const filtered = status.dropped.unimportant ?? 0;
    const filteredText = filtered > 0 ? ` / 过滤 ${filtered}` : '';
    return `入选 ${status.returned}${filteredText}`;
}

function getDirectionLabel(item: DailyNewsItem): string | null {
    if (item.impactDirection === 'risk_on') return '进展型';
    if (item.impactDirection === 'risk_off') return '约束型';
    if (item.impactDirection === 'mixed') return '进展与风险并存';
    if (item.impactDirection === 'neutral') return '待确认';
    return null;
}

function getHorizonLabel(item: DailyNewsItem): string | null {
    if (item.impactHorizon === 'intraday') return '短期进展';
    if (item.impactHorizon === '1-4w') return '数周影响';
    if (item.impactHorizon === '1-3d') return '近期影响';
    return null;
}

function getBriefBiasLabel(brief: DailyNewsBrief): string {
    if (brief.riskBias === 'risk_on') return '进展较多';
    if (brief.riskBias === 'risk_off') return '约束更突出';
    if (brief.riskBias === 'mixed') return '进展与风险并存';
    return '方向有限';
}

function getSourceTierLabel(item: DailyNewsItem): string | null {
    if (item.sourceTier === 'official') return '官方来源';
    if (item.sourceTier === 'major') return '主流媒体';
    if (item.sourceTier === 'specialist') return '专业媒体';
    if (item.sourceTier === 'aggregated') return '聚合来源';
    if (item.sourceTier === 'unknown') return '普通来源';
    return null;
}

function getConfirmationLabel(item: DailyNewsItem): string | null {
    if (item.confirmationLevel === 'official') return '官方确认';
    if (item.confirmationLevel === 'multi_source') return '多源交叉';
    if (item.confirmationLevel === 'single_authoritative') return '权威单源';
    if (item.confirmationLevel === 'single_source') return '单源待复核';
    return null;
}

function getTopStoryConfirmationLabel(story: DailyNewsTopStory): string {
    if (story.confirmationLevel === 'official') return '官方确认';
    if (story.confirmationLevel === 'multi_source') return '多源交叉';
    if (story.confirmationLevel === 'single_authoritative') return '权威单源';
    return '单源待复核';
}

function getTopStorySourceLabel(story: DailyNewsTopStory): string {
    if (story.sourceTier === 'official') return '官方来源';
    if (story.sourceTier === 'major') return '主流媒体';
    if (story.sourceTier === 'specialist') return '专业媒体';
    if (story.sourceTier === 'aggregated') return '聚合来源';
    return '普通来源';
}

function getCategoryLabel(category: NewsCategory): string {
    if (category === 'crypto') return '加密';
    if (category === 'macro') return '宏观';
    return 'AI';
}

function NewsBriefPanel({ brief }: { brief?: DailyNewsBrief }) {
    if (!brief) {
        return null;
    }

    return (
        <section className={styles.briefPanel}>
            <div className={styles.briefMain}>
                <div className={styles.categoryEyebrow}>24 小时大事摘记</div>
                <h2 className={styles.briefHeadline}>{brief.headline}</h2>
                <div className={styles.briefMeta}>
                    <span className={`${styles.briefBias} ${styles[brief.riskBias]}`}>{getBriefBiasLabel(brief)}</span>
                    {brief.driverTags.slice(0, 5).map((tag) => (
                        <span key={tag}>{tag}</span>
                    ))}
                    {brief.affectedAssets.slice(0, 5).map((asset) => (
                        <span key={asset}>{asset}</span>
                    ))}
                </div>
            </div>
            {brief.latestSignals.length > 0 && (
                <div className={styles.briefSignals}>
                    {brief.latestSignals.map((signal) => (
                        <span key={signal}>{signal}</span>
                    ))}
                </div>
            )}
        </section>
    );
}

function TopStoriesPanel({ stories }: { stories?: DailyNewsTopStory[] }) {
    if (!stories || stories.length === 0) {
        return null;
    }

    return (
        <section className={styles.topStoriesPanel}>
            <div className={styles.sectionHeader}>
                <div>
                    <div className={styles.categoryEyebrow}>每日三件大事</div>
                    <h2 className={styles.sectionTitle}>过去 24 小时最重要的事件</h2>
                </div>
                <span className={styles.countBadge}>按重要性排序</span>
            </div>
            <div className={styles.topStoryList}>
                {stories.map((story, index) => (
                    <article key={story.id} className={styles.topStoryItem}>
                        <div className={styles.topStoryRank}>{index + 1}</div>
                        <div className={styles.topStoryBody}>
                            <h3>{story.headline}</h3>
                            <p>{story.whyImportant}</p>
                            <div className={styles.briefMeta}>
                                <span>{getCategoryLabel(story.category)}</span>
                                <span>{getTopStoryConfirmationLabel(story)}</span>
                                <span>{getTopStorySourceLabel(story)}</span>
                                <span>{story.importanceScore}</span>
                            </div>
                        </div>
                    </article>
                ))}
            </div>
        </section>
    );
}

function NewsItemCard({
    item,
    timezone,
    expanded,
    onToggle,
}: {
    item: DailyNewsItem;
    timezone: string;
    expanded: boolean;
    onToggle: () => void;
}) {
    const directionLabel = getDirectionLabel(item);
    const horizonLabel = getHorizonLabel(item);
    const sourceTierLabel = getSourceTierLabel(item);
    const confirmationLabel = getConfirmationLabel(item);
    const affectedAssets = (item.affectedAssets || []).slice(0, 4);
    const hasEventMeta = Boolean(item.subcategory || directionLabel || horizonLabel || affectedAssets.length > 0);
    const canExpand = Boolean(item.summarySections || item.summary || item.whyItMatters || item.watchpoints?.length || item.tags.length > 0);

    return (
        <article className={`${styles.newsItem} ${item.importanceLevel === 'high' ? styles.highImpactItem : ''}`}>
            <div className={styles.itemTopline}>
                <span className={`${styles.importanceBadge} ${styles[item.importanceLevel]}`}>
                    {getImportanceLabel(item)}
                </span>
                <span className={styles.itemTime}>{formatInTimeZone(item.publishedAt, timezone)}</span>
            </div>
            <a className={styles.itemTitle} href={item.url} target="_blank" rel="noreferrer">
                <span>{item.title}</span>
                <ExternalLink size={14} aria-hidden="true" />
            </a>
            <div className={styles.itemMeta}>
                <span>{item.source}</span>
                <span>{formatRelativeTime(item.publishedAt)}</span>
                {sourceTierLabel && <span className={styles.sourcePill}>{sourceTierLabel}</span>}
                {confirmationLabel && <span className={styles.sourcePill}>{confirmationLabel}</span>}
            </div>
            {hasEventMeta && (
                <div className={styles.eventMeta}>
                    {item.subcategory && <span>{item.subcategory}</span>}
                    {directionLabel && <span>{directionLabel}</span>}
                    {horizonLabel && <span>{horizonLabel}</span>}
                    {affectedAssets.map((asset) => (
                        <span key={asset}>{asset}</span>
                    ))}
                </div>
            )}
            {canExpand && (
                <button className={styles.expandButton} type="button" onClick={onToggle} aria-expanded={expanded}>
                    <span>{expanded ? '收起背景' : '查看背景'}</span>
                    {expanded ? <ChevronUp size={14} aria-hidden="true" /> : <ChevronDown size={14} aria-hidden="true" />}
                </button>
            )}
            {expanded && (
                <div className={styles.expandedBody}>
                    {item.summarySections ? (
                        <div className={styles.summarySections}>
                            <div>
                                <span>发生了什么</span>
                                <p>{item.summarySections.whatHappened.replace(/^发生了什么：/, '')}</p>
                            </div>
                            <div>
                                <span>为什么重要</span>
                                <p>{item.summarySections.whyImportant.replace(/^为什么重要：/, '')}</p>
                            </div>
                            <div>
                                <span>后续看什么</span>
                                <p>{item.summarySections.whatToWatch.replace(/^后续看什么：/, '')}</p>
                            </div>
                            <div>
                                <span>来源与确认度</span>
                                <p>{item.summarySections.sourceAndConfirmation.replace(/^来源与确认度：/, '')}</p>
                            </div>
                        </div>
                    ) : (
                        <p className={styles.summary}>{item.summary}</p>
                    )}
                    {item.editorialReason && (
                        <p className={styles.editorialReason}>{item.editorialReason}</p>
                    )}
                    {item.timeline && item.timeline.length > 0 && (
                        <div className={styles.timeline}>
                            <span className={styles.watchpointLabel}>事件时间线</span>
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
                            <span className={styles.watchpointLabel}>后续看点</span>
                            {item.watchpoints.slice(0, 3).map((point) => (
                                <span key={point} className={styles.watchpoint}>{point}</span>
                            ))}
                        </div>
                    )}
                    <div className={styles.tagRow}>
                        {item.tags.slice(0, 6).map((tag) => (
                            <span key={tag} className={styles.tag}>{tag}</span>
                        ))}
                    </div>
                </div>
            )}
        </article>
    );
}

export default function DailyNewsView() {
    const [expandedItems, setExpandedItems] = useState<Set<string>>(() => new Set());
    const { data, error, isLoading } = usePersistentSWR<DailyNewsApiResponse>(
        '/api/daily-news',
        fetcher,
        {
            refreshInterval: 10 * 60 * 1000,
            revalidateOnFocus: false,
            dedupingInterval: 60 * 1000,
            storageTtlMs: 12 * 60 * 60 * 1000,
            persistIntervalMs: 5 * 60 * 1000,
            storageKey: 'persistent-swr:v4:/api/daily-news:important-news',
        }
    );

    const digest = data?.digest;
    const totalCount = useMemo(() => {
        if (!digest) return 0;
        return digest.macro.length + digest.ai.length + digest.crypto.length;
    }, [digest]);
    const highImpactCount = useMemo(() => {
        if (!digest) return 0;
        return [...digest.macro, ...digest.ai, ...digest.crypto]
            .filter((item) => item.importanceLevel === 'high').length;
    }, [digest]);
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

    if (isLoading && !digest) {
        return <div className={styles.placeholder}>重要新闻正在读取最新摘要…</div>;
    }

    if (error && !digest) {
        return <div className={styles.placeholder}>重要新闻暂时不可用，请稍后重试。</div>;
    }

    if (!digest) {
        return (
            <section className={styles.page}>
                <header className={styles.hero}>
                    <div>
                        <div className={styles.kicker}>重要事件</div>
                        <h1 className={styles.title}>重要新闻</h1>
                    <p className={styles.subtitle}>过去 24 小时内经过筛选的加密 / 宏观 / AI 大事，只保留会改变行业认知的信息。</p>
                    </div>
                </header>
                <div className={styles.emptyState}>
                    暂时还没有可展示的重要新闻摘要。系统会自动生成最近 24 小时的重要事件，稍后刷新即可查看最新结果。
                </div>
            </section>
        );
    }

    return (
        <section className={styles.page}>
            <header className={styles.hero}>
                <div className={styles.heroCopy}>
                    <div className={styles.kicker}>重要事件</div>
                    <h1 className={styles.title}>重要新闻</h1>
                    <p className={styles.subtitle}>以加密大事为主，宏观和 AI 只保留会影响流动性、监管环境、产业格局或基础设施的重大事件。</p>
                </div>
                <div className={styles.heroMeta}>
                    <div className={styles.metaBlock}>
                        <span className={styles.metaLabel}>更新时间</span>
                        <strong>{formatInTimeZone(digest.generatedAt, digest.timezone)}</strong>
                    </div>
                    <div className={styles.metaBlock}>
                        <span className={styles.metaLabel}>统计区间</span>
                        <strong>{formatWindow(digest)}</strong>
                    </div>
                    <div className={styles.metaBlock}>
                        <span className={styles.metaLabel}>入选事件</span>
                        <strong>{totalCount} 条</strong>
                    </div>
                    <div className={styles.metaBlock}>
                        <span className={styles.metaLabel}>重大事件</span>
                        <strong>{highImpactCount} 条</strong>
                    </div>
                </div>
            </header>

            {data?.message && <div className={styles.notice}>{data.message}</div>}
            <TopStoriesPanel stories={digest.topStories} />
            <NewsBriefPanel brief={digest.brief} />

            <section className={styles.categoryGrid}>
                {CATEGORY_CONFIG.map((category) => {
                    const items = digest[category.key];
                    return (
                        <div key={category.key} className={styles.categoryPanel}>
                            <div className={styles.categoryHeader}>
                                <div>
                                    <div className={styles.categoryEyebrow}>{category.subtitle}</div>
                                    <h2 className={styles.categoryTitle}>{category.title}</h2>
                                </div>
                                <span className={styles.countBadge}>{getStatusLabel(digest, category.key)}</span>
                            </div>
                            {digest.categoryStatus[category.key]?.error && (
                                <div className={styles.categoryError}>
                                    {digest.categoryStatus[category.key].error}
                                </div>
                            )}
                            {items.length > 0 ? (
                                <div className={styles.newsList}>
                                    {items.map((item) => (
                                        <NewsItemCard
                                            key={item.id}
                                            item={item}
                                            timezone={digest.timezone}
                                            expanded={expandedItems.has(item.id)}
                                            onToggle={() => toggleExpandedItem(item.id)}
                                        />
                                    ))}
                                </div>
                            ) : (
                                <div className={styles.categoryEmpty}>这个分类在当前窗口没有足够高相关性的新闻。</div>
                            )}
                        </div>
                    );
                })}
            </section>
        </section>
    );
}
