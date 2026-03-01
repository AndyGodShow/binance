"use client";

import { memo } from 'react';
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

const MemoizedTableRow = memo(({ row, index, maxVolume, onSymbolClick }: TableRowProps) => {
    const quoteVol = parseFloat(row.quoteVolume);
    const volumePercent = maxVolume > 0 ? (quoteVol / maxVolume) * 100 : 0;
    const funding = parseFloat(row.fundingRate || '0');
    const isFundingHigh = Math.abs(funding) > 0.0005;

    return (
        <tr
            className={cn(styles.row, onSymbolClick && styles.clickable)}
            onClick={() => onSymbolClick?.(row.symbol)}
        >
            <td className={styles.rank}>
                <span className={cn(
                    "text-xs font-mono opacity-50",
                    index < 3 && "text-yellow opacity-100 font-bold"
                )}>
                    {index + 1}
                </span>
            </td>

            <td className={styles.symbol}>
                <div className={styles.symbolContainer}>
                    <div className={styles.symbolText}>{row.symbol.replace('USDT', '')}</div>
                    <div className={styles.perpText}>PERP</div>
                </div>
            </td>

            <td className={cn(styles.price, styles.alignRight)}>
                {parseFloat(row.lastPrice) > 10
                    ? parseFloat(row.lastPrice).toFixed(2)
                    : parseFloat(row.lastPrice).toFixed(4)}
            </td>

            <td className={styles.alignRight}>
                {row.change15m !== undefined ? (
                    <span className={row.change15m > 0 ? 'text-green' : (row.change15m < 0 ? 'text-red' : '')}>
                        {row.change15m > 0 ? '+' : ''}{row.change15m.toFixed(2)}%
                    </span>
                ) : <span className="text-secondary">-</span>}
            </td>

            <td className={styles.alignRight}>
                {row.change1h !== undefined ? (
                    <span className={row.change1h > 0 ? 'text-green' : (row.change1h < 0 ? 'text-red' : '')}>
                        {row.change1h > 0 ? '+' : ''}{row.change1h.toFixed(2)}%
                    </span>
                ) : <span className="text-secondary">-</span>}
            </td>

            <td className={styles.alignRight}>
                {row.change4h !== undefined ? (
                    <span className={row.change4h > 0 ? 'text-green' : (row.change4h < 0 ? 'text-red' : '')}>
                        {row.change4h > 0 ? '+' : ''}{row.change4h.toFixed(2)}%
                    </span>
                ) : <span className="text-secondary">-</span>}
            </td>

            <td className={cn(styles.alignRight,
                parseFloat(row.priceChangePercent) > 0 ? 'text-green' :
                    (parseFloat(row.priceChangePercent) < 0 ? 'text-red' : '')
            )}>
                {parseFloat(row.priceChangePercent) > 0 ? '+' : ''}{parseFloat(row.priceChangePercent).toFixed(2)}%
            </td>

            <td className={styles.alignRight}>
                <div className={cn(
                    styles.fundingCell,
                    isFundingHigh && (funding > 0 ? styles.bgGreenSoft : styles.bgRedSoft),
                    funding > 0 ? 'text-green' : (funding < 0 ? 'text-red' : '')
                )}>
                    {(funding * 100).toFixed(4)}%
                </div>
            </td>

            <td className={styles.alignRight}>
                <div className={styles.barContainer}>
                    <div
                        className={styles.progressBar}
                        style={{ width: `${Math.min(volumePercent, 100)}%` }}
                    />
                    <span className={styles.barValue}>{formatCompact(row.quoteVolume)}</span>
                </div>
            </td>

            <td className={styles.alignRight}>
                {(row.openInterestValue && row.openInterestValue !== '0') ? (
                    <span className="text-primary font-mono">
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

function DataTable({
    data,
    sortConfig,
    onSort,
    maxVolume = 0,
    compactMode = false,
    onSymbolClick
}: DataTableProps) {

    const getSortIcon = (key: SortableKey) => {
        if (sortConfig?.key !== key) return <ArrowUpDown size={12} className={styles.sortIcon} />;
        return sortConfig.direction === 'asc' ?
            <ArrowUp size={12} className={cn(styles.sortIcon, styles.activeSort)} /> :
            <ArrowDown size={12} className={cn(styles.sortIcon, styles.activeSort)} />;
    };

    const headers: { key: SortableKey; label: string; right?: boolean }[] = [
        { key: 'rank', label: '#' },
        { key: 'symbol', label: '币种' },
        { key: 'lastPrice', label: '最新价', right: true },
        { key: 'change15m', label: '15m', right: true },
        { key: 'change1h', label: '1h', right: true },
        { key: 'change4h', label: '4h', right: true },
        { key: 'priceChangePercent', label: '24h', right: true },
        { key: 'fundingRate', label: '资金费率', right: true },
        { key: 'quoteVolume', label: '24h成交量', right: true },
        { key: 'openInterestValue', label: '持仓金额', right: true },
    ];

    return (
        <div className={styles.tableWrapper}>
            <table className={cn(styles.table, compactMode && styles.compact)}>
                <thead className={styles.thead}>
                    <tr>
                        {headers.map((h) => (
                            <th
                                key={h.key}
                                onClick={() => h.key !== 'rank' && onSort(h.key)}
                                className={cn(h.right && styles.alignRight)}
                                style={{ cursor: h.key !== 'rank' ? 'pointer' : 'default' }}
                            >
                                <div className={cn(styles.thContent, h.right && styles.thContentRight)}>
                                    {h.label}
                                    {h.key !== 'rank' && getSortIcon(h.key)}
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
    );
}

// 使用React.memo优化，只在props真正变化时才重渲染
export default memo(DataTable, (prevProps, nextProps) => {
    return (
        prevProps.data === nextProps.data &&
        prevProps.sortConfig === nextProps.sortConfig &&
        prevProps.compactMode === nextProps.compactMode &&
        prevProps.onSort === nextProps.onSort &&
        prevProps.onSymbolClick === nextProps.onSymbolClick
    );
});
