"use client";

import { useMemo } from 'react';
import { ExternalLink } from 'lucide-react';

import { usePersistentSWR } from '@/hooks/usePersistentSWR';
import type { DailyNewsApiResponse, DailyNewsDigest, DailyNewsItem, NewsCategory } from '@/lib/dailyNews/types';
import styles from './DailyNewsView.module.css';

const CATEGORY_CONFIG: Array<{
    key: NewsCategory;
    title: string;
    subtitle: string;
}> = [
    { key: 'macro', title: '宏观新闻', subtitle: '央行、利率、通胀、地缘与大类资产' },
    { key: 'ai', title: '人工智能新闻', subtitle: '模型、芯片、产品、融资与监管' },
    { key: 'crypto', title: '加密新闻', subtitle: 'BTC/ETH、ETF、监管、交易所与链上安全' },
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
    if (item.importanceLevel === 'high') return `高 · ${item.importanceScore}`;
    if (item.importanceLevel === 'medium') return `中 · ${item.importanceScore}`;
    return `低 · ${item.importanceScore}`;
}

function getStatusLabel(digest: DailyNewsDigest, category: NewsCategory): string {
    const status = digest.categoryStatus[category];
    if (!status) return '状态未知';
    if (status.status === 'failed') return '抓取失败';
    if (status.status === 'partial') return `实际 ${status.returned} 条`;
    return '10 条完整';
}

function NewsItemCard({ item, timezone }: { item: DailyNewsItem; timezone: string }) {
    return (
        <article className={styles.newsItem}>
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
            </div>
            <p className={styles.summary}>{item.summary}</p>
            <div className={styles.tagRow}>
                {item.tags.slice(0, 6).map((tag) => (
                    <span key={tag} className={styles.tag}>{tag}</span>
                ))}
            </div>
        </article>
    );
}

export default function DailyNewsView() {
    const { data, error, isLoading } = usePersistentSWR<DailyNewsApiResponse>(
        '/api/daily-news',
        fetcher,
        {
            refreshInterval: 10 * 60 * 1000,
            revalidateOnFocus: false,
            dedupingInterval: 60 * 1000,
            storageTtlMs: 12 * 60 * 60 * 1000,
            persistIntervalMs: 5 * 60 * 1000,
            storageKey: 'persistent-swr:v1:/api/daily-news',
        }
    );

    const digest = data?.digest;
    const totalCount = useMemo(() => {
        if (!digest) return 0;
        return digest.macro.length + digest.ai.length + digest.crypto.length;
    }, [digest]);

    if (isLoading && !digest) {
        return <div className={styles.placeholder}>每日新闻正在读取最新摘要…</div>;
    }

    if (error && !digest) {
        return <div className={styles.placeholder}>每日新闻暂时不可用，请稍后重试。</div>;
    }

    if (!digest) {
        return (
            <section className={styles.page}>
                <header className={styles.hero}>
                    <div>
                        <div className={styles.kicker}>每日要闻</div>
                        <h1 className={styles.title}>每日新闻</h1>
                        <p className={styles.subtitle}>过去 24 小时内最重要的宏观 / 人工智能 / 加密新闻。</p>
                    </div>
                </header>
                <div className={styles.emptyState}>
                    暂时还没有可展示的每日新闻摘要。系统会自动生成最近 24 小时的重要新闻，稍后刷新即可查看最新结果。
                </div>
            </section>
        );
    }

    return (
        <section className={styles.page}>
            <header className={styles.hero}>
                <div className={styles.heroCopy}>
                    <div className={styles.kicker}>每日要闻</div>
                    <h1 className={styles.title}>每日新闻</h1>
                    <p className={styles.subtitle}>过去 24 小时内最重要的宏观 / 人工智能 / 加密新闻，用于开盘前快速校准风险偏好和产业叙事。</p>
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
                        <span className={styles.metaLabel}>入选新闻</span>
                        <strong>{totalCount} 条</strong>
                    </div>
                </div>
            </header>

            {data?.message && <div className={styles.notice}>{data.message}</div>}

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
                                        <NewsItemCard key={item.id} item={item} timezone={digest.timezone} />
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
