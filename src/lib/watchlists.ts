import type { TickerData, Watchlist, WatchlistsState } from './types';

function createId(): string {
    return `watchlist-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function normalizeWatchlistSymbol(value: string): string {
    const normalized = value.trim().toUpperCase();
    if (!normalized) {
        return '';
    }

    return normalized.endsWith('USDT') ? normalized : `${normalized}USDT`;
}

export function createWatchlistsState(): WatchlistsState {
    return {
        watchlists: [],
        activeWatchlistId: null,
    };
}

export function createWatchlist(state: WatchlistsState, name: string): WatchlistsState {
    const trimmedName = name.trim();
    if (!trimmedName) {
        return state;
    }

    const now = Date.now();
    const watchlist: Watchlist = {
        id: createId(),
        name: trimmedName,
        symbols: [],
        createdAt: now,
        updatedAt: now,
    };

    return {
        watchlists: [...state.watchlists, watchlist],
        activeWatchlistId: watchlist.id,
    };
}

export function renameWatchlist(state: WatchlistsState, watchlistId: string, name: string): WatchlistsState {
    const trimmedName = name.trim();
    if (!trimmedName) {
        return state;
    }

    return {
        ...state,
        watchlists: state.watchlists.map((watchlist) => (
            watchlist.id === watchlistId
                ? { ...watchlist, name: trimmedName, updatedAt: Date.now() }
                : watchlist
        )),
    };
}

export function deleteWatchlist(state: WatchlistsState, watchlistId: string): WatchlistsState {
    const watchlists = state.watchlists.filter((watchlist) => watchlist.id !== watchlistId);
    const nextActiveWatchlistId = state.activeWatchlistId === watchlistId
        ? (watchlists[0]?.id ?? null)
        : state.activeWatchlistId;

    return {
        watchlists,
        activeWatchlistId: nextActiveWatchlistId,
    };
}

export function selectWatchlist(state: WatchlistsState, watchlistId: string | null): WatchlistsState {
    if (watchlistId === null) {
        return { ...state, activeWatchlistId: null };
    }

    const exists = state.watchlists.some((watchlist) => watchlist.id === watchlistId);
    return exists ? { ...state, activeWatchlistId: watchlistId } : state;
}

export function addSymbolToWatchlist(state: WatchlistsState, watchlistId: string, symbol: string): WatchlistsState {
    const normalizedSymbol = normalizeWatchlistSymbol(symbol);
    if (!normalizedSymbol) {
        return state;
    }

    return {
        ...state,
        watchlists: state.watchlists.map((watchlist) => {
            if (watchlist.id !== watchlistId || watchlist.symbols.includes(normalizedSymbol)) {
                return watchlist;
            }

            return {
                ...watchlist,
                symbols: [...watchlist.symbols, normalizedSymbol],
                updatedAt: Date.now(),
            };
        }),
    };
}

export function removeSymbolFromWatchlist(state: WatchlistsState, watchlistId: string, symbol: string): WatchlistsState {
    const normalizedSymbol = normalizeWatchlistSymbol(symbol);

    return {
        ...state,
        watchlists: state.watchlists.map((watchlist) => (
            watchlist.id === watchlistId
                ? {
                    ...watchlist,
                    symbols: watchlist.symbols.filter((item) => item !== normalizedSymbol),
                    updatedAt: Date.now(),
                }
                : watchlist
        )),
    };
}

export function filterTickersByWatchlist(data: TickerData[], watchlist: Watchlist | null | undefined): TickerData[] {
    if (!watchlist) {
        return data;
    }

    const symbolSet = new Set(watchlist.symbols.map((symbol) => normalizeWatchlistSymbol(symbol)));
    return data.filter((ticker) => symbolSet.has(normalizeWatchlistSymbol(ticker.symbol)));
}
