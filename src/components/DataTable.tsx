"use client";

import { memo, useEffect, useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react';
import { TickerData, SortableKey } from '@/lib/types';
import { cn, formatCompact } from '@/lib/utils';
import styles from './DataTable.module.css';

interface DataTableProps {
    data: TickerData[];
    sortConfig: { key: SortableKey; direction: 'asc' | 'desc' } | null;
    onSort: (key: SortableKey) => void;
    maxVolume?: number;
    compactMode?: boolean;
    onSymbolClick?: (symbol: string) => void;
}

interface TableRowProps {
    row: TickerData;
    index: number;
    maxVolume: number;
    onSymbolClick?: (symbol: string) => void;
}

const MOBILE_CARD_BREAKPOINT = '(max-width: 720px)';

function formatLastPrice(price: string) {
    const numericPrice = parseFloat(price);
    if (!Number.isFinite(numericPrice)) {
        return '--';
    }

    return numericPrice > 10 ? numericPrice.toFixed(2) : numericPrice.toFixed(4);
}

function getSignedClassName(value: number | undefined) {
    if (value === undefined) return '';
    if (value > 0) return 'text-green';
    if (value < 0) return 'text-red';
    return '';
}

function renderSignedPercent(value: number | undefined) {
    if (value === undefined) {
        return <span className="text-secondary">-</span>;
    }

    return (
        <span className={getSignedClassName(value)}>
            {value > 0 ? '+' : ''}{value.toFixed(2)}%
        </span>
    );
}

const MemoizedTableRow = memo(({ row, index, maxVolume, onSymbolClick }: TableRowProps) => {
    const quoteVol = parseFloat(row.quoteVolume);
    const volumePercent = maxVolume > 0 ? (quoteVol / maxVolume) * 100 : 0;
    const funding = parseFloat(row.fundingRate || '0');
    const isFundingHigh = Math.abs(funding) > 0.0005;
    const dayChange = parseFloat(row.priceChangePercent);

    return (
        <tr
            className={cn(styles.row, onSymbolClick && styles.clickable)}
            onClick={() => onSymbolClick?.(row.symbol)}
        >
            <td className={cn(styles.rank, styles.rankCell)}>
                <span className={cn(
                    "text-xs font-mono opacity-50",
                    index < 3 && "text-yellow opacity-100 font-bold"
                )}>
                    {index + 1}
                </span>
            </td>

            <td className={cn(styles.symbol, styles.symbolCell)}>
                <div className={styles.symbolContainer}>
                    <div className={styles.symbolText}>{row.symbol.replace('USDT', '')}</div>
                    <div className={styles.perpText}>PERP</div>
                </div>
            </td>

            <td className={cn(styles.price, styles.numericCell, styles.priceCell)}>
                {formatLastPrice(row.lastPrice)}
            </td>

            <td className={cn(styles.numericCell, styles.metricCell)}>
                {renderSignedPercent(row.change15m)}
            </td>

            <td className={cn(styles.numericCell, styles.metricCell)}>
                {renderSignedPercent(row.change1h)}
            </td>

            <td className={cn(styles.numericCell, styles.metricCell)}>
                {renderSignedPercent(row.change4h)}
            </td>

            <td className={cn(styles.numericCell, styles.metricCell, getSignedClassName(dayChange), styles.dayCell)}>
                {dayChange > 0 ? '+' : ''}{dayChange.toFixed(2)}%
            </td>

            <td className={styles.numericCell}>
                <div className={cn(
                    styles.fundingCell,
                    isFundingHigh && (funding > 0 ? styles.bgGreenSoft : styles.bgRedSoft),
                    funding > 0 ? 'text-green' : (funding < 0 ? 'text-red' : ''),
                    styles.fundingCellWrap
                )}>
                    {(funding * 100).toFixed(4)}%
                </div>
            </td>

            <td className={cn(styles.numericCell, styles.volumeCell)}>
                <div className={styles.barContainer}>
                    <div
                        className={styles.progressBar}
                        style={{ width: `${Math.min(volumePercent, 100)}%` }}
                    />
                    <span className={styles.barValue}>{formatCompact(row.quoteVolume)}</span>
                </div>
            </td>

            <td className={cn(styles.numericCell, styles.openInterestCell)}>
                {(row.openInterestValue && row.openInterestValue !== '0') ? (
                    <span className={cn("text-primary font-mono", styles.metricStrong)}>
                        {formatCompact(row.openInterestValue)}
                    </span>
                ) : (
                    <span className="text-secondary">-</span>
                )}
            </td>
        </tr>
    );
}, (prev, next) => {
    // 深度对比：只有当这些直接影响渲染的属性发生变化时，这一行才重新渲染
    return (
        prev.index === next.index &&
        prev.maxVolume === next.maxVolume &&
        prev.row.lastPrice === next.row.lastPrice &&
        prev.row.change15m === next.row.change15m &&
        prev.row.change1h === next.row.change1h &&
        prev.row.change4h === next.row.change4h &&
        prev.row.priceChangePercent === next.row.priceChangePercent &&
        prev.row.fundingRate === next.row.fundingRate &&
        prev.row.quoteVolume === next.row.quoteVolume &&
        prev.row.openInterestValue === next.row.openInterestValue
    );
});

const MemoizedMobileCard = memo(({ row, index, maxVolume, onSymbolClick }: TableRowProps) => {
    const quoteVol = parseFloat(row.quoteVolume);
    const volumePercent = maxVolume > 0 ? (quoteVol / maxVolume) * 100 : 0;
    const funding = parseFloat(row.fundingRate || '0');
    const dayChange = parseFloat(row.priceChangePercent);

    return (
        <article
            className={cn(styles.mobileCard, onSymbolClick && styles.clickable)}
            onClick={() => onSymbolClick?.(row.symbol)}
        >
            <div className={styles.mobileCardTop}>
                <div className={styles.mobileIdentity}>
                    <span className={styles.mobileRank}>{index + 1}</span>
                    <div className={styles.mobileSymbolBlock}>
                        <span className={styles.mobileSymbol}>{row.symbol.replace('USDT', '')}</span>
                        <span className={styles.mobilePerp}>PERP</span>
                    </div>
                </div>

                <div className={styles.mobilePriceBlock}>
                    <span className={styles.mobilePrice}>{formatLastPrice(row.lastPrice)}</span>
                    <span className={cn(styles.mobileDayChange, getSignedClassName(dayChange))}>
                        {dayChange > 0 ? '+' : ''}{dayChange.toFixed(2)}%
                    </span>
                </div>
            </div>

            <div className={styles.mobileTrendGrid}>
                <div className={styles.mobileMetric}>
                    <span className={styles.mobileMetricLabel}>15m</span>
                    <strong className={styles.mobileMetricValue}>{renderSignedPercent(row.change15m)}</strong>
                </div>
                <div className={styles.mobileMetric}>
                    <span className={styles.mobileMetricLabel}>1h</span>
                    <strong className={styles.mobileMetricValue}>{renderSignedPercent(row.change1h)}</strong>
                </div>
                <div className={styles.mobileMetric}>
                    <span className={styles.mobileMetricLabel}>4h</span>
                    <strong className={styles.mobileMetricValue}>{renderSignedPercent(row.change4h)}</strong>
                </div>
                <div className={styles.mobileMetric}>
                    <span className={styles.mobileMetricLabel}>24h</span>
                    <strong className={styles.mobileMetricValue}>
                        <span className={getSignedClassName(dayChange)}>
                            {dayChange > 0 ? '+' : ''}{dayChange.toFixed(2)}%
                        </span>
                    </strong>
                </div>
            </div>

            <div className={styles.mobileMetaGrid}>
                <div className={styles.mobileMetaItem}>
                    <span className={styles.mobileMetricLabel}>资金费率</span>
                    <strong className={cn(styles.mobileMetaValue, funding > 0 ? 'text-green' : funding < 0 ? 'text-red' : '')}>
                        {(funding * 100).toFixed(4)}%
                    </strong>
                </div>
                <div className={styles.mobileMetaItem}>
                    <span className={styles.mobileMetricLabel}>24h 成交量</span>
                    <strong className={styles.mobileMetaValue}>{formatCompact(row.quoteVolume)}</strong>
                </div>
                <div className={styles.mobileMetaItem}>
                    <span className={styles.mobileMetricLabel}>持仓金额</span>
                    <strong className={styles.mobileMetaValue}>
                        {row.openInterestValue && row.openInterestValue !== '0' ? formatCompact(row.openInterestValue) : '-'}
                    </strong>
                </div>
            </div>

            <div className={styles.mobileVolumeTrack}>
                <div
                    className={styles.mobileVolumeFill}
                    style={{ width: `${Math.min(volumePercent, 100)}%` }}
                />
            </div>
        </article>
    );
}, (prev, next) => {
    return (
        prev.index === next.index &&
        prev.maxVolume === next.maxVolume &&
        prev.row.lastPrice === next.row.lastPrice &&
        prev.row.change15m === next.row.change15m &&
        prev.row.change1h === next.row.change1h &&
        prev.row.change4h === next.row.change4h &&
        prev.row.priceChangePercent === next.row.priceChangePercent &&
        prev.row.fundingRate === next.row.fundingRate &&
        prev.row.quoteVolume === next.row.quoteVolume &&
        prev.row.openInterestValue === next.row.openInterestValue
    );
});

function DataTable({
    data,
    sortConfig,
    onSort,
    maxVolume = 0,
    compactMode = false,
    onSymbolClick
}: DataTableProps) {
    const [isMobileView, setIsMobileView] = useState(false);

    useEffect(() => {
        const mediaQuery = window.matchMedia(MOBILE_CARD_BREAKPOINT);
        const syncView = () => setIsMobileView(mediaQuery.matches);

        syncView();
        mediaQuery.addEventListener('change', syncView);

        return () => {
            mediaQuery.removeEventListener('change', syncView);
        };
    }, []);

    const getSortIcon = (key: SortableKey) => {
        if (sortConfig?.key !== key) return <ArrowUpDown size={12} className={styles.sortIcon} />;
        return sortConfig.direction === 'asc' ?
            <ArrowUp size={12} className={cn(styles.sortIcon, styles.activeSort)} /> :
            <ArrowDown size={12} className={cn(styles.sortIcon, styles.activeSort)} />;
    };

    const headers = useMemo(() => [
        { key: 'rank' as SortableKey, label: '#', width: '72px' },
        { key: 'symbol' as SortableKey, label: '币种', width: '210px' },
        { key: 'lastPrice' as SortableKey, label: '最新价', right: true, width: '126px' },
        { key: 'change15m' as SortableKey, label: '15m', right: true, width: '108px' },
        { key: 'change1h' as SortableKey, label: '1h', right: true, width: '108px' },
        { key: 'change4h' as SortableKey, label: '4h', right: true, width: '108px' },
        { key: 'priceChangePercent' as SortableKey, label: '24h', right: true, width: '110px' },
        { key: 'fundingRate' as SortableKey, label: '资金费率', right: true, width: '128px' },
        { key: 'quoteVolume' as SortableKey, label: '24h成交量', right: true, width: '146px' },
        { key: 'openInterestValue' as SortableKey, label: '持仓金额', right: true, width: '132px' },
    ], []);

    const activeSortLabel = useMemo(() => {
        if (!sortConfig) {
            return '默认排序';
        }

        const label = headers.find((header) => header.key === sortConfig.key)?.label || sortConfig.key;
        return `${label}${sortConfig.direction === 'desc' ? ' ↓' : ' ↑'}`;
    }, [headers, sortConfig]);

    if (data.length === 0) {
        return (
            <section className={styles.tableSurface}>
                <div className={styles.tableMeta}>
                    <div>
                        <span className={styles.tableTag}>实时榜单</span>
                        <strong className={styles.tableHeading}>当前没有可展示的合约</strong>
                    </div>
                </div>
                <div className={styles.emptyState}>
                    <p className={styles.emptyTitle}>没有匹配到结果</p>
                    <p className={styles.emptyDescription}>试试放宽搜索关键词或切换成交额筛选条件。</p>
                </div>
            </section>
        );
    }

    if (isMobileView) {
        return (
            <section className={styles.tableSurface}>
                <div className={styles.tableMeta}>
                    <div>
                        <span className={styles.tableTag}>移动速览</span>
                        <strong className={styles.tableHeading}>{data.length} 个合约</strong>
                    </div>
                    <div className={styles.tableMetaInfo}>
                        <span>按 {activeSortLabel}</span>
                    </div>
                </div>

                <div className={styles.mobileList}>
                    {data.map((row, index) => (
                        <MemoizedMobileCard
                            key={row.symbol}
                            row={row}
                            index={index}
                            maxVolume={maxVolume}
                            onSymbolClick={onSymbolClick}
                        />
                    ))}
                </div>
            </section>
        );
    }

    return (
        <section className={styles.tableSurface}>
            <div className={styles.tableMeta}>
                <div>
                    <span className={styles.tableTag}>实时榜单</span>
                    <strong className={styles.tableHeading}>{data.length} 个合约</strong>
                </div>
                <div className={styles.tableMetaInfo}>
                    <span>按 {activeSortLabel}</span>
                    <span className={styles.tableScrollHint}>左右滑动查看更多指标</span>
                </div>
            </div>

            <div className={styles.tableWrapper}>
                <table className={cn(styles.table, compactMode && styles.compact)}>
                    <caption className={styles.srOnly}>实时合约行情榜单</caption>
                    <colgroup>
                        {headers.map((header) => (
                            <col key={header.key} style={{ width: header.width }} />
                        ))}
                    </colgroup>
                    <thead className={styles.thead}>
                        <tr>
                            {headers.map((h) => (
                                <th
                                    key={h.key}
                                    onClick={() => h.key !== 'rank' && onSort(h.key)}
                                    className={cn(
                                        h.right && styles.alignRight,
                                        sortConfig?.key === h.key && styles.activeHeader
                                    )}
                                    style={{ cursor: h.key !== 'rank' ? 'pointer' : 'default' }}
                                >
                                    <div className={cn(styles.thContent, h.right && styles.thContentRight)}>
                                        {h.right && h.key !== 'rank' && getSortIcon(h.key)}
                                        {h.label}
                                        {!h.right && h.key !== 'rank' && getSortIcon(h.key)}
                                    </div>
                                </th>
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        {data.map((row, index) => (
                            <MemoizedTableRow
                                key={row.symbol}
                                row={row}
                                index={index}
                                maxVolume={maxVolume}
                                onSymbolClick={onSymbolClick}
                            />
                        ))}
                    </tbody>
                </table>
            </div>
        </section>
    );
}

// 使用React.memo优化，只在props真正变化时才重渲染
export default memo(DataTable, (prevProps, nextProps) => {
    return (
        prevProps.data === nextProps.data &&
        prevProps.sortConfig === nextProps.sortConfig &&
        prevProps.compactMode === nextProps.compactMode &&
        prevProps.maxVolume === nextProps.maxVolume &&
        prevProps.onSort === nextProps.onSort &&
        prevProps.onSymbolClick === nextProps.onSymbolClick
    );
});
