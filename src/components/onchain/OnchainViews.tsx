"use client";

import { formatCompact, formatCurrency } from '@/lib/utils';
import type {
    ClassifiedHolder,
    DexPriceWindow,
    DexTradeWindow,
    TokenResearchPayload,
    TokenSearchResult,
    TopHolderItem,
} from '@/lib/onchain/types';
import styles from '../OnchainTracker.module.css';

export function StatCard({ label, value, hint }: { label: string; value: string; hint: string }) {
    return (
        <div className={styles.statCard}>
            <span className={styles.statLabel}>{label}</span>
            <strong className={styles.statValue}>{value}</strong>
            <span className={styles.statHint}>{hint}</span>
        </div>
    );
}

export function DexTradeActivityView({ trades }: { trades: TokenSearchResult['dexTrades'] }) {
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

export function DexPriceStatsView({ stats }: { stats: TokenSearchResult['dexPriceStats'] }) {
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

export function TopHoldersView({ holders }: { holders: TopHolderItem[] }) {
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

export function ClassifiedHolderList({ holders }: { holders: ClassifiedHolder[] }) {
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

export function MarketMetric({
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

export function formatMaybeCurrency(value: number | null | undefined) {
    if (value === null || value === undefined || !Number.isFinite(value)) {
        return '--';
    }
    if (Math.abs(value) < 0.01) {
        return `$${value.toPrecision(4)}`;
    }
    return formatCurrency(value);
}

export function formatMaybeCompact(value: number | null | undefined) {
    if (value === null || value === undefined || !Number.isFinite(value)) {
        return '--';
    }
    return formatCompact(value);
}

export function formatMaybeCurrencyCompact(value: number | null | undefined) {
    if (value === null || value === undefined || !Number.isFinite(value)) {
        return '--';
    }

    if (Math.abs(value) >= 1000) {
        return `$${formatCompact(value)}`;
    }

    return formatCurrency(value);
}

export function formatPercent(value: number) {
    if (!Number.isFinite(value)) {
        return '--';
    }

    const normalized = value < 1 ? value * 100 : value;
    if (normalized < 0 || normalized > 100) {
        return '异常';
    }

    return `${normalized.toFixed(2)}%`;
}

export function formatNullablePercent(value: number | null | undefined) {
    if (value === null || value === undefined || !Number.isFinite(value)) {
        return '--';
    }

    return `${value.toFixed(2)}%`;
}

export function classLabel(value: ClassifiedHolder['class']) {
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

export function truncateAddress(value: string) {
    if (value.length <= 14) {
        return value;
    }

    return `${value.slice(0, 6)}...${value.slice(-4)}`;
}

export function formatMaybeSignedPercent(value: number | null | undefined) {
    if (value === null || value === undefined || !Number.isFinite(value)) {
        return '--';
    }

    return `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`;
}

export function formatMaybeRatio(value: number | null | undefined) {
    if (value === null || value === undefined || !Number.isFinite(value)) {
        return '--';
    }

    return `${(value * 100).toFixed(1)}%`;
}

export function formatMaybeCount(value: number | null | undefined) {
    if (value === null || value === undefined || !Number.isFinite(value)) {
        return '--';
    }

    return formatCompact(value);
}

export function toneClassForChange(value: number | null | undefined) {
    if (value === null || value === undefined || !Number.isFinite(value)) {
        return styles.marketValue;
    }

    return value >= 0 ? styles.positive : styles.negative;
}

export function qualityClassName(confidence: '高' | '中' | '低') {
    if (confidence === '高') return `${styles.qualityValue} ${styles.qualityHigh}`;
    if (confidence === '中') return `${styles.qualityValue} ${styles.qualityMedium}`;
    return `${styles.qualityValue} ${styles.qualityLow}`;
}

export function identityConfidenceToQuality(confidence: TokenResearchPayload['identity']['confidence']): '高' | '中' | '低' {
    if (confidence === 'official' || confidence === 'probable') return '高';
    if (confidence === 'fallback') return '中';
    return '低';
}

export function supplyConfidenceToQuality(confidence: TokenResearchPayload['supplyBreakdown']['confidence']): '高' | '中' | '低' {
    if (confidence === 'high') return '高';
    if (confidence === 'medium') return '中';
    return '低';
}

export function eligibilityLabel(level: TokenResearchPayload['eligibility']['level']) {
    if (level === 'analysis_allowed') return '允许观察';
    if (level === 'raw_only') return '仅原始数据';
    return '已阻断';
}

export function formatTopHolderShare(holders: TopHolderItem[], count: number) {
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

export function formatHolderPercent(value: number) {
    if (!Number.isFinite(value) || value < 0 || value > 100) {
        return '异常';
    }

    return `${value.toFixed(2)}%`;
}
