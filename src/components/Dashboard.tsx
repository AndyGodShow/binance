"use client";

import { useState, useMemo, useEffect, useCallback } from 'react';
import { TickerData, SortableKey } from '@/lib/types';
import { formatCompact } from '@/lib/utils';
import { useAlertMonitor } from '@/hooks/useAlertMonitor';
import { useScheduledAlerts } from '@/hooks/useScheduledAlerts';
import ControlBar from './ControlBar';
import DataTable from './DataTable';
import AlertNotification from './AlertNotification';
import AlertSettings from './AlertSettings';
import ScheduledAlertCard from './ScheduledAlertCard';
import styles from './Dashboard.module.css';

interface DashboardProps {
    processedData?: TickerData[];
    onSymbolClick?: (symbol: string) => void;
}

const SORT_LABELS: Record<string, string> = {
    rank: '排名',
    symbol: '币种',
    lastPrice: '最新价',
    change15m: '15m 涨跌',
    change1h: '1h 涨跌',
    change4h: '4h 涨跌',
    priceChangePercent: '24h 涨跌',
    fundingRate: '资金费率',
    quoteVolume: '24h 成交量',
    openInterestValue: '持仓金额',
};

const VOLUME_FILTER_LABELS: Record<string, string> = {
    '0': '全部流动性',
    '500000000_gt': '成交额 > 5 亿',
    '100000000_gt': '成交额 > 1 亿',
    '5000000_lt': '成交额 < 5M',
    '10000000_lt': '成交额 < 10M',
    '30000000_lt': '成交额 < 30M',
    '50000000_lt': '成交额 < 50M',
    '100000000_lt': '成交额 < 1 亿',
    '300000000_lt': '成交额 < 3 亿',
};

export default function Dashboard({ processedData: externalData, onSymbolClick }: DashboardProps) {
    const [mounted, setMounted] = useState(false);
    const [search, setSearch] = useState('');
    const [volumeFilter, setVolumeFilter] = useState('0');
    const [compactMode, setCompactMode] = useState(false);
    const [showAlertSettings, setShowAlertSettings] = useState(false);
    const [sortConfig, setSortConfig] = useState<{ key: SortableKey; direction: 'asc' | 'desc' } | null>({
        key: 'quoteVolume',
        direction: 'desc',
    });

    useEffect(() => {
        setMounted(true);
    }, []);

    // Filter and sort the external data
    const filteredData = useMemo(() => {
        if (!externalData) return [];

        let result = [...externalData];

        // Filter by Search
        if (search) {
            const q = search.toLowerCase();
            result = result.filter((t) => t.symbol.toLowerCase().includes(q));
        }

        // Filter by Volume
        if (volumeFilter !== '0') {
            const [val, op] = volumeFilter.split('_');
            const threshold = Number(val);
            if (op === 'lt') {
                result = result.filter((t) => Number(t.quoteVolume) < threshold);
            } else if (op === 'gt') {
                result = result.filter((t) => Number(t.quoteVolume) > threshold);
            }
        }

        // Sort
        if (sortConfig) {
            result.sort((a, b) => {
                const key = sortConfig.key;
                let aVal: number | string = 0;
                let bVal: number | string = 0;

                const valA = a[key as keyof TickerData];
                const valB = b[key as keyof TickerData];

                if (valA === undefined && valB === undefined) return 0;
                if (valA === undefined) return 1;
                if (valB === undefined) return -1;

                const numericKeys: (keyof TickerData)[] = [
                    'lastPrice', 'priceChangePercent', 'quoteVolume',
                    'fundingRate', 'openInterest', 'change15m', 'change1h', 'change4h'
                ];

                if (numericKeys.includes(key as keyof TickerData) || key === 'openInterest' || key === 'openInterestValue') {
                    aVal = Number(valA);
                    bVal = Number(valB);
                } else {
                    aVal = valA as string;
                    bVal = valB as string;
                }

                if (aVal < bVal) return sortConfig.direction === 'asc' ? -1 : 1;
                if (aVal > bVal) return sortConfig.direction === 'asc' ? 1 : -1;
                return 0;
            });
        }

        return result;
    }, [externalData, search, volumeFilter, sortConfig]);

    // BUG-1: Calculate maxVolume for DataTable progress bars
    const maxVolume = useMemo(() => {
        if (filteredData.length === 0) return 0;
        return Math.max(...filteredData.map(t => Number(t.quoteVolume) || 0));
    }, [filteredData]);

    const marketSummary = useMemo(() => {
        const totalUniverse = externalData?.length ?? 0;

        if (filteredData.length === 0) {
            return {
                totalUniverse,
                pairCount: 0,
                gainers: 0,
                losers: 0,
                breadth: 0,
                totalVolume: 0,
                averageFundingRate: 0,
                leaderSymbol: '--',
                leaderVolume: 0,
            };
        }

        let gainers = 0;
        let losers = 0;
        let totalVolume = 0;
        let fundingSum = 0;
        let fundingCount = 0;
        let leader = filteredData[0];

        filteredData.forEach((ticker) => {
            const dayChange = Number(ticker.priceChangePercent);
            const volume = Number(ticker.quoteVolume) || 0;
            const funding = Number(ticker.fundingRate);

            if (dayChange > 0) gainers += 1;
            if (dayChange < 0) losers += 1;

            totalVolume += volume;

            if (Number.isFinite(funding)) {
                fundingSum += funding;
                fundingCount += 1;
            }

            if (volume > Number(leader.quoteVolume || 0)) {
                leader = ticker;
            }
        });

        return {
            totalUniverse,
            pairCount: filteredData.length,
            gainers,
            losers,
            breadth: filteredData.length > 0 ? Math.round((gainers / filteredData.length) * 100) : 0,
            totalVolume,
            averageFundingRate: fundingCount > 0 ? (fundingSum / fundingCount) * 100 : 0,
            leaderSymbol: leader.symbol.replace('USDT', ''),
            leaderVolume: Number(leader.quoteVolume) || 0,
        };
    }, [externalData, filteredData]);

    const currentSortLabel = useMemo(() => {
        if (!sortConfig) {
            return '默认排序';
        }

        const label = SORT_LABELS[sortConfig.key] || sortConfig.key;
        return `${label} · ${sortConfig.direction === 'desc' ? '降序' : '升序'}`;
    }, [sortConfig]);

    const currentVolumeFilterLabel = VOLUME_FILTER_LABELS[volumeFilter] || '全部流动性';

    const alertData = externalData || [];

    // Alert Monitor Hook
    const { alerts, config: alertConfig, updateConfig: updateAlertConfig, dismissAlert, clearAllAlerts } = useAlertMonitor(alertData);

    // Scheduled Alerts Hook
    const { scheduledAlerts, dismissAlert: dismissScheduledAlert } = useScheduledAlerts(
        alertData,
        alertConfig.enableScheduledAlerts,
        { enableSound: alertConfig.enableSound, enableNotification: alertConfig.enableNotification }
    );

    const handleSort = useCallback((key: SortableKey) => {
        let direction: 'asc' | 'desc' = 'desc';
        if (sortConfig && sortConfig.key === key && sortConfig.direction === 'desc') {
            direction = 'asc';
        }
        setSortConfig({ key, direction });
    }, [sortConfig]);

    const handleOpenAlertSettings = useCallback(() => {
        setShowAlertSettings(true);
    }, []);

    const handleCloseAlertSettings = useCallback(() => {
        setShowAlertSettings(false);
    }, []);

    if (!mounted) {
        return null;
    }

    return (
        <div className={styles.dashboard}>
            <section className={styles.header}>
                <div className={styles.heroBlock}>
                    <span className={styles.eyebrow}>Realtime Futures Radar</span>
                    <div className={styles.heroTitleRow}>
                        <h1 className={styles.title}>数据面板</h1>
                        <span className={styles.liveBadge}>实时监控</span>
                    </div>
                    <p className={styles.subtitle}>
                        搜索、筛选并比较主力合约的短周期动能、资金费率与持仓热度，把注意力集中在最活跃的标的上。
                    </p>
                    <div className={styles.metaRow}>
                        <span className={styles.status}>排序：{currentSortLabel}</span>
                        <span className={styles.statusMuted}>流动性：{currentVolumeFilterLabel}</span>
                        {search && <span className={styles.statusMuted}>搜索：{search.toUpperCase()}</span>}
                        <span className={styles.statusMuted}>
                            平均费率：{marketSummary.averageFundingRate >= 0 ? '+' : ''}{marketSummary.averageFundingRate.toFixed(4)}%
                        </span>
                    </div>
                </div>

                <div className={styles.statsGrid}>
                    <article className={styles.statCard}>
                        <span className={styles.statLabel}>可见合约</span>
                        <strong className={styles.statValue}>{marketSummary.pairCount}</strong>
                        <span className={styles.statMeta}>总监控范围 {marketSummary.totalUniverse}</span>
                    </article>

                    <article className={styles.statCard}>
                        <span className={styles.statLabel}>上涨占比</span>
                        <strong className={styles.statValue}>{marketSummary.breadth}%</strong>
                        <span className={styles.statMeta}>{marketSummary.gainers} 涨 / {marketSummary.losers} 跌</span>
                    </article>

                    <article className={styles.statCard}>
                        <span className={styles.statLabel}>样本成交额</span>
                        <strong className={styles.statValue}>{formatCompact(marketSummary.totalVolume)}</strong>
                        <span className={styles.statMeta}>24h 汇总成交额</span>
                    </article>

                    <article className={styles.statCard}>
                        <span className={styles.statLabel}>最活跃合约</span>
                        <strong className={styles.statValue}>{marketSummary.leaderSymbol}</strong>
                        <span className={styles.statMeta}>成交额 {formatCompact(marketSummary.leaderVolume)}</span>
                    </article>
                </div>
            </section>

            <ControlBar
                search={search}
                setSearch={setSearch}
                volumeFilter={volumeFilter}
                setVolumeFilter={setVolumeFilter}
                compactMode={compactMode}
                setCompactMode={setCompactMode}
                onOpenAlertSettings={handleOpenAlertSettings}
            />

            <DataTable
                data={filteredData}
                onSymbolClick={onSymbolClick}
                onSort={handleSort}
                sortConfig={sortConfig}
                compactMode={compactMode}
                maxVolume={maxVolume}
            />

            {/* Alert Notifications */}
            {alerts.length > 0 && (
                <AlertNotification
                    alerts={alerts}
                    onDismiss={dismissAlert}
                    onClearAll={clearAllAlerts}
                />
            )}

            {/* Scheduled Alert Cards */}
            {scheduledAlerts.slice(0, 2).map((alert) => (
                <ScheduledAlertCard
                    key={alert.id}
                    alert={alert}
                    onDismiss={dismissScheduledAlert}
                />
            ))}

            {/* Alert Settings Panel */}
            {showAlertSettings && (
                <AlertSettings
                    config={alertConfig}
                    onUpdateConfig={updateAlertConfig}
                    onClose={handleCloseAlertSettings}
                />
            )}
        </div>
    );
}
