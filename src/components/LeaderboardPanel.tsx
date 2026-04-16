"use client";

import { useMemo } from 'react';

import { buildDashboardLeaderboards } from '@/lib/leaderboard';
import type { LeaderboardEntry, LeaderboardWindow, OpenInterestFrameSnapshot, TickerData } from '@/lib/types';
import { formatCompact } from '@/lib/utils';
import styles from './LeaderboardPanel.module.css';

const TIME_WINDOWS: LeaderboardWindow[] = ['15m', '1h', '4h', '24h'];

interface LeaderboardPanelProps {
    data: TickerData[];
    openInterestFrames?: Record<string, OpenInterestFrameSnapshot>;
    onSymbolClick?: (symbol: string) => void;
}

interface RankingListProps {
    title: string;
    items: LeaderboardEntry[];
    variant: 'percent' | 'oi' | 'ratio' | 'funding';
    onSymbolClick?: (symbol: string) => void;
}

function trimSymbol(symbol: string): string {
    return symbol.replace('USDT', '');
}

function formatSignedPercent(value: number, digits: number = 2): string {
    return `${value >= 0 ? '+' : ''}${value.toFixed(digits)}%`;
}

function formatSignedCompact(value: number): string {
    return `${value >= 0 ? '+' : '-'}${formatCompact(Math.abs(value))}`;
}

function getValueTone(value: number, variant: RankingListProps['variant']): string {
    if (variant === 'ratio') {
        return styles.emphasis;
    }

    if (value > 0) {
        return styles.positive;
    }

    if (value < 0) {
        return styles.negative;
    }

    return styles.neutral;
}

function renderPrimaryValue(item: LeaderboardEntry, variant: RankingListProps['variant']): string {
    switch (variant) {
        case 'funding':
            return formatSignedPercent(item.value * 100, 4);
        case 'ratio':
            return `${item.value.toFixed(2)}x`;
        default:
            return formatSignedPercent(item.value);
    }
}

function renderSecondaryValue(item: LeaderboardEntry, variant: RankingListProps['variant']): string | null {
    if (variant === 'oi' && item.secondaryValue !== undefined) {
        return `${formatSignedCompact(item.secondaryValue)}`;
    }

    if (variant === 'ratio' && item.secondaryValue !== undefined) {
        return `OI ${formatCompact(item.secondaryValue)}`;
    }

    return null;
}

function RankingList({ title, items, variant, onSymbolClick }: RankingListProps) {
    const isEmpty = items.length === 0;

    return (
        <div className={styles.listBlock}>
            <div className={styles.listHeader}>
                <span className={styles.listTitle}>{title}</span>
                <span className={styles.listMeta}>{isEmpty ? '同步中' : `${items.length} 条`}</span>
            </div>

            {isEmpty ? (
                <div className={styles.emptyState}>当前榜单还在同步中，稍后会自动补齐。</div>
            ) : (
                <div className={styles.rankList}>
                    {items.map((item, index) => {
                        const secondaryValue = renderSecondaryValue(item, variant);
                        const clickable = Boolean(onSymbolClick);

                        return (
                            <button
                                key={`${title}-${item.symbol}`}
                                type="button"
                                className={styles.rankRow}
                                disabled={!clickable}
                                onClick={() => onSymbolClick?.(item.symbol)}
                            >
                                <span className={styles.rankIndex}>{index + 1}</span>
                                <span className={styles.rankSymbol}>{trimSymbol(item.symbol)}</span>
                                <span className={styles.rankValueGroup}>
                                    <span className={`${styles.rankValue} ${getValueTone(item.value, variant)}`}>
                                        {renderPrimaryValue(item, variant)}
                                    </span>
                                    {secondaryValue && (
                                        <span className={styles.rankSecondary}>{secondaryValue}</span>
                                    )}
                                </span>
                            </button>
                        );
                    })}
                </div>
            )}
        </div>
    );
}

export default function LeaderboardPanel({
    data,
    openInterestFrames = {},
    onSymbolClick,
}: LeaderboardPanelProps) {
    const leaderboards = useMemo(
        () => buildDashboardLeaderboards(data, openInterestFrames),
        [data, openInterestFrames]
    );

    const oiCoverageCount = useMemo(
        () => data.reduce((count, ticker) => count + (openInterestFrames[ticker.symbol] ? 1 : 0), 0),
        [data, openInterestFrames]
    );

    return (
        <section className={styles.panel}>
            <div className={styles.panelHeader}>
                <div>
                    <span className={styles.panelTag}>Leaderboard Zone</span>
                    <h2 className={styles.panelTitle}>排行榜</h2>
                </div>
                <div className={styles.panelMeta}>
                    <span>当前筛选 {data.length} 个合约</span>
                    <span>OI 多周期覆盖 {oiCoverageCount}</span>
                </div>
            </div>

            <div className={styles.timeframeGrid}>
                {TIME_WINDOWS.map((window) => (
                    <article key={window} className={styles.timeframeCard}>
                        <div className={styles.cardHeader}>
                            <div>
                                <span className={styles.cardEyebrow}>{window}</span>
                                <h3 className={styles.cardTitle}>{window} 排行</h3>
                            </div>
                            <span className={styles.cardMeta}>价格 Top 10 / OI Top 10</span>
                        </div>

                        <div className={styles.dualColumn}>
                            <RankingList
                                title="价格涨跌幅"
                                items={leaderboards.price[window]}
                                variant="percent"
                                onSymbolClick={onSymbolClick}
                            />
                            <RankingList
                                title="OI 涨跌幅"
                                items={leaderboards.oi[window]}
                                variant="oi"
                                onSymbolClick={onSymbolClick}
                            />
                        </div>
                    </article>
                ))}
            </div>

            <article className={styles.secondaryCard}>
                <div className={styles.cardHeader}>
                    <div>
                        <span className={styles.cardEyebrow}>Funding</span>
                        <h3 className={styles.cardTitle}>资金费率</h3>
                    </div>
                    <span className={styles.cardMeta}>正向前五 / 负向前五</span>
                </div>

                <div className={styles.dualColumn}>
                    <RankingList
                        title="正资金费率"
                        items={leaderboards.funding.positive}
                        variant="funding"
                        onSymbolClick={onSymbolClick}
                    />
                    <RankingList
                        title="负资金费率"
                        items={leaderboards.funding.negative}
                        variant="funding"
                        onSymbolClick={onSymbolClick}
                    />
                </div>
            </article>
        </section>
    );
}
