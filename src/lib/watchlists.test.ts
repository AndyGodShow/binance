import test from 'node:test';
import assert from 'node:assert/strict';

import type { TickerData } from './types.ts';
import {
    addSymbolToWatchlist,
    createWatchlist,
    createWatchlistsState,
    filterTickersByWatchlist,
    removeSymbolFromWatchlist,
} from './watchlists.ts';

function createTicker(symbol: string): TickerData {
    return {
        symbol,
        lastPrice: '0',
        priceChange: '0',
        priceChangePercent: '0',
        weightedAvgPrice: '0',
        prevClosePrice: '0',
        highPrice: '0',
        lowPrice: '0',
        volume: '0',
        quoteVolume: '0',
        openTime: 0,
        closeTime: 0,
    };
}

test('createWatchlist adds a new list and selects it', () => {
    const initial = createWatchlistsState();
    const created = createWatchlist(initial, '龙头');

    assert.equal(created.watchlists.length, 1);
    assert.equal(created.activeWatchlistId, created.watchlists[0].id);
    assert.equal(created.watchlists[0].name, '龙头');
});

test('addSymbolToWatchlist uppercases and deduplicates symbols', () => {
    const created = createWatchlist(createWatchlistsState(), '短线');
    const watchlistId = created.activeWatchlistId!;
    const first = addSymbolToWatchlist(created, watchlistId, 'btc');
    const second = addSymbolToWatchlist(first, watchlistId, 'BTCUSDT');

    assert.equal(second.watchlists[0].symbols.length, 1);
    assert.equal(second.watchlists[0].symbols[0], 'BTCUSDT');
});

test('filterTickersByWatchlist only keeps selected symbols', () => {
    const created = createWatchlist(createWatchlistsState(), '观察');
    const watchlistId = created.activeWatchlistId!;
    const withBtc = addSymbolToWatchlist(created, watchlistId, 'BTC');
    const withEth = addSymbolToWatchlist(withBtc, watchlistId, 'ETHUSDT');

    const filtered = filterTickersByWatchlist(
        [createTicker('BTCUSDT'), createTicker('ETHUSDT'), createTicker('SOLUSDT')],
        withEth.watchlists[0]
    );

    assert.deepEqual(filtered.map((ticker) => ticker.symbol), ['BTCUSDT', 'ETHUSDT']);
});

test('removeSymbolFromWatchlist deletes only that symbol', () => {
    const created = createWatchlist(createWatchlistsState(), '价值');
    const watchlistId = created.activeWatchlistId!;
    const seeded = addSymbolToWatchlist(addSymbolToWatchlist(created, watchlistId, 'BTC'), watchlistId, 'ETH');
    const next = removeSymbolFromWatchlist(seeded, watchlistId, 'BTCUSDT');

    assert.deepEqual(next.watchlists[0].symbols, ['ETHUSDT']);
});
