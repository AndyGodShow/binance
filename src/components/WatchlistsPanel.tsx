"use client";

import { useMemo, useState } from 'react';
import { Plus, Trash2, ListFilter, Search, ArrowRight } from 'lucide-react';
import type { TickerData, Watchlist } from '@/lib/types';
import { formatCompact } from '@/lib/utils';
import styles from './WatchlistsPanel.module.css';

interface WatchlistsPanelProps {
    marketData: TickerData[];
    watchlists: Watchlist[];
    activeWatchlistId: string | null;
    onSymbolClick?: (symbol: string) => void;
    onSelectWatchlist: (watchlistId: string) => void;
    onCreateWatchlist: (name: string) => void;
    onDeleteWatchlist: (watchlistId: string) => void;
    onRenameWatchlist: (watchlistId: string, name: string) => void;
    onAddSymbol: (watchlistId: string, symbol: string) => void;
    onRemoveSymbol: (watchlistId: string, symbol: string) => void;
    onOpenDashboardWatchlist?: (watchlistId: string) => void;
}

export default function WatchlistsPanel({
    marketData,
    watchlists,
    activeWatchlistId,
    onSymbolClick,
    onSelectWatchlist,
    onCreateWatchlist,
    onDeleteWatchlist,
    onRenameWatchlist,
    onAddSymbol,
    onRemoveSymbol,
    onOpenDashboardWatchlist,
}: WatchlistsPanelProps) {
    const [newWatchlistName, setNewWatchlistName] = useState('');
    const [symbolQuery, setSymbolQuery] = useState('');
    const activeWatchlist = watchlists.find((watchlist) => watchlist.id === activeWatchlistId) ?? watchlists[0] ?? null;
    const normalizedQuery = symbolQuery.trim().toUpperCase();

    const suggestions = useMemo(() => {
        const unique = new Map<string, TickerData>();
        marketData.forEach((ticker) => {
            if (!unique.has(ticker.symbol)) {
                unique.set(ticker.symbol, ticker);
            }
        });

        const items = [...unique.values()];
        const filtered = normalizedQuery
            ? items.filter((ticker) => ticker.symbol.includes(normalizedQuery))
            : items;

        return filtered
            .sort((left, right) => Number(right.quoteVolume || 0) - Number(left.quoteVolume || 0))
            .slice(0, 18);
    }, [marketData, normalizedQuery]);

    const handleCreate = () => {
        if (!newWatchlistName.trim()) {
            return;
        }
        onCreateWatchlist(newWatchlistName);
        setNewWatchlistName('');
    };

    return (
        <section className={styles.shell}>
            <div className={styles.sidebar}>
                <div className={styles.sidebarHeader}>
                    <div>
                        <p className={styles.eyebrow}>观察池</p>
                        <h2 className={styles.title}>自选名单</h2>
                    </div>
                    <span className={styles.count}>{watchlists.length} 组</span>
                </div>

                <div className={styles.createRow}>
                    <input
                        value={newWatchlistName}
                        onChange={(event) => setNewWatchlistName(event.target.value)}
                        onKeyDown={(event) => {
                            if (event.key === 'Enter') {
                                handleCreate();
                            }
                        }}
                        className={styles.input}
                        placeholder="新名单名称，例如 龙头 / 短线"
                    />
                    <button className={styles.primaryBtn} onClick={handleCreate}>
                        <Plus size={16} />
                        新建
                    </button>
                </div>

                <div className={styles.watchlistStack}>
                    {watchlists.length === 0 && (
                        <div className={styles.emptyState}>
                            先建一个名单，把你长期想盯的币收进来。
                        </div>
                    )}
                    {watchlists.map((watchlist) => (
                        <button
                            key={watchlist.id}
                            className={`${styles.watchlistItem} ${watchlist.id === activeWatchlist?.id ? styles.activeWatchlist : ''}`}
                            onClick={() => onSelectWatchlist(watchlist.id)}
                        >
                            <div className={styles.watchlistMeta}>
                                <strong>{watchlist.name}</strong>
                                <span>{watchlist.symbols.length} 个币</span>
                            </div>
                            <span className={styles.watchlistArrow}>→</span>
                        </button>
                    ))}
                </div>
            </div>

            <div className={styles.workspace}>
                {activeWatchlist ? (
                    <>
                        <div className={styles.workspaceHeader}>
                            <div>
                                <p className={styles.eyebrow}>当前名单</p>
                                <input
                                    className={styles.nameInput}
                                    value={activeWatchlist.name}
                                    onChange={(event) => onRenameWatchlist(activeWatchlist.id, event.target.value)}
                                />
                                <p className={styles.subtle}>
                                    把你会反复看的币收进一组，之后在数据面板里一键切过去。
                                </p>
                            </div>
                            <div className={styles.workspaceActions}>
                                {onOpenDashboardWatchlist && (
                                    <button className={styles.secondaryBtn} onClick={() => onOpenDashboardWatchlist(activeWatchlist.id)}>
                                        <ArrowRight size={16} />
                                        去面板查看
                                    </button>
                                )}
                                <button className={styles.dangerBtn} onClick={() => onDeleteWatchlist(activeWatchlist.id)}>
                                    <Trash2 size={16} />
                                    删除名单
                                </button>
                            </div>
                        </div>

                        <div className={styles.grid}>
                            <section className={styles.panel}>
                                <div className={styles.panelHeader}>
                                    <div>
                                        <p className={styles.eyebrow}>名单内</p>
                                        <h3>已加入的币</h3>
                                    </div>
                                    <span className={styles.count}>{activeWatchlist.symbols.length} 个</span>
                                </div>
                                <div className={styles.symbolList}>
                                    {activeWatchlist.symbols.length === 0 && (
                                        <div className={styles.emptyState}>右侧搜索后点一下，就能把币加进这个名单。</div>
                                    )}
                                    {activeWatchlist.symbols.map((symbol) => (
                                        <div key={symbol} className={styles.symbolRow}>
                                            <button
                                                className={styles.symbolTrigger}
                                                onClick={() => onSymbolClick?.(symbol)}
                                            >
                                                <div className={styles.symbolTag}>
                                                    <ListFilter size={14} />
                                                    {symbol.replace('USDT', '')}
                                                </div>
                                            </button>
                                            <button className={styles.ghostBtn} onClick={() => onRemoveSymbol(activeWatchlist.id, symbol)}>
                                                移除
                                            </button>
                                        </div>
                                    ))}
                                </div>
                            </section>

                            <section className={styles.panel}>
                                <div className={styles.panelHeader}>
                                    <div>
                                        <p className={styles.eyebrow}>从市场添加</p>
                                        <h3>搜索并加入</h3>
                                    </div>
                                </div>
                                <div className={styles.searchBar}>
                                    <Search size={16} />
                                    <input
                                        className={styles.searchInput}
                                        value={symbolQuery}
                                        onChange={(event) => setSymbolQuery(event.target.value)}
                                        placeholder="输入 BTC / ETH / SOL"
                                    />
                                </div>
                                <div className={styles.suggestionList}>
                                    {suggestions.map((ticker) => {
                                        const alreadyAdded = activeWatchlist.symbols.includes(ticker.symbol);
                                        return (
                                            <div key={ticker.symbol} className={styles.suggestionRow}>
                                                <div className={styles.suggestionInfo}>
                                                    <strong className={styles.suggestionSymbol}>{ticker.symbol.replace('USDT', '')}</strong>
                                                    <span className={styles.suggestionMeta}>
                                                        24h 成交额 {formatCompact(ticker.quoteVolume)}
                                                    </span>
                                                </div>
                                                <button
                                                    className={alreadyAdded ? styles.disabledBtn : styles.primaryBtn}
                                                    onClick={() => onAddSymbol(activeWatchlist.id, ticker.symbol)}
                                                    disabled={alreadyAdded}
                                                >
                                                    {alreadyAdded ? '已加入' : '加入'}
                                                </button>
                                            </div>
                                        );
                                    })}
                                </div>
                            </section>
                        </div>
                    </>
                ) : (
                    <div className={styles.heroEmpty}>
                        <p className={styles.eyebrow}>还没有观察池</p>
                        <h2>先建立你的第一组自选名单</h2>
                        <p className={styles.subtle}>
                            例如把“龙头”“短线观察”“老朋友”拆开，之后在数据面板里只看这些币的波动。
                        </p>
                    </div>
                )}
            </div>
        </section>
    );
}
