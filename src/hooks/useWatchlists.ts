"use client";

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { WatchlistsState } from '@/lib/types';
import {
    addSymbolToWatchlist,
    createWatchlist,
    createWatchlistsState,
    deleteWatchlist,
    removeSymbolFromWatchlist,
    renameWatchlist,
    selectWatchlist,
} from '@/lib/watchlists';

const STORAGE_KEY = 'watchlists_state_v1';

function readStoredState(): WatchlistsState {
    if (typeof window === 'undefined') {
        return createWatchlistsState();
    }

    try {
        const raw = window.localStorage.getItem(STORAGE_KEY);
        if (!raw) {
            return createWatchlistsState();
        }

        const parsed = JSON.parse(raw) as WatchlistsState;
        if (!parsed || !Array.isArray(parsed.watchlists)) {
            return createWatchlistsState();
        }

        return {
            watchlists: parsed.watchlists,
            activeWatchlistId: parsed.activeWatchlistId ?? parsed.watchlists[0]?.id ?? null,
        };
    } catch {
        return createWatchlistsState();
    }
}

export function useWatchlists() {
    const [state, setState] = useState<WatchlistsState>(() => readStoredState());

    useEffect(() => {
        try {
            window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
        } catch {
            // Ignore persistence failures; runtime state remains usable.
        }
    }, [state]);

    const addWatchlist = useCallback((name: string) => {
        setState((current) => createWatchlist(current, name));
    }, []);

    const updateWatchlistName = useCallback((watchlistId: string, name: string) => {
        setState((current) => renameWatchlist(current, watchlistId, name));
    }, []);

    const removeWatchlist = useCallback((watchlistId: string) => {
        setState((current) => deleteWatchlist(current, watchlistId));
    }, []);

    const setActiveWatchlist = useCallback((watchlistId: string | null) => {
        setState((current) => selectWatchlist(current, watchlistId));
    }, []);

    const addSymbol = useCallback((watchlistId: string, symbol: string) => {
        setState((current) => addSymbolToWatchlist(current, watchlistId, symbol));
    }, []);

    const removeSymbol = useCallback((watchlistId: string, symbol: string) => {
        setState((current) => removeSymbolFromWatchlist(current, watchlistId, symbol));
    }, []);

    const activeWatchlist = useMemo(
        () => state.watchlists.find((watchlist) => watchlist.id === state.activeWatchlistId) ?? null,
        [state.activeWatchlistId, state.watchlists]
    );

    return {
        state,
        watchlists: state.watchlists,
        activeWatchlist,
        addWatchlist,
        updateWatchlistName,
        removeWatchlist,
        setActiveWatchlist,
        addSymbol,
        removeSymbol,
    };
}
