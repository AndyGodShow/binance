import assert from 'node:assert/strict';
import test from 'node:test';

import {
    buildSymbolChunks,
    selectTopUsdtPerpetualSymbols,
    type MarketUniverseTicker,
    type MarketUniverseExchangeInfo,
} from './topSymbolUniverse.ts';

const exchangeInfo: MarketUniverseExchangeInfo = {
    symbols: [
        { symbol: 'BTCUSDT', contractType: 'PERPETUAL', status: 'TRADING' },
        { symbol: 'ETHUSDT', contractType: 'PERPETUAL', status: 'TRADING' },
        { symbol: 'BNBUSDT', contractType: 'PERPETUAL', status: 'TRADING' },
        { symbol: 'BTCUSD_PERP', contractType: 'PERPETUAL', status: 'TRADING' },
        { symbol: 'DELISTUSDT', contractType: 'PERPETUAL', status: 'SETTLING' },
        { symbol: 'NEXTUSDT', contractType: 'CURRENT_QUARTER', status: 'TRADING' },
    ],
};

test('selectTopUsdtPerpetualSymbols keeps only active USDT perpetual contracts sorted by quote volume', () => {
    const tickers: MarketUniverseTicker[] = [
        { symbol: 'ETHUSDT', quoteVolume: '200' },
        { symbol: 'BTCUSDT', quoteVolume: '500' },
        { symbol: 'BNBUSDT', quoteVolume: '100' },
        { symbol: 'DELISTUSDT', quoteVolume: '999999' },
        { symbol: 'BTCUSD_PERP', quoteVolume: '300' },
    ];

    assert.deepEqual(
        selectTopUsdtPerpetualSymbols(tickers, exchangeInfo, 2),
        ['BTCUSDT', 'ETHUSDT'],
    );
});

test('selectTopUsdtPerpetualSymbols ignores non-finite quote volumes and deduplicates symbols', () => {
    const tickers: MarketUniverseTicker[] = [
        { symbol: 'BTCUSDT', quoteVolume: 'not-a-number' },
        { symbol: 'BTCUSDT', quoteVolume: '500' },
        { symbol: 'ETHUSDT', quoteVolume: '200' },
        { symbol: 'BNBUSDT', quoteVolume: '100' },
    ];

    assert.deepEqual(
        selectTopUsdtPerpetualSymbols(tickers, exchangeInfo, 5),
        ['BTCUSDT', 'ETHUSDT', 'BNBUSDT'],
    );
});

test('selectTopUsdtPerpetualSymbols rejects symbols outside the standard backtest universe format', () => {
    const tickers: MarketUniverseTicker[] = [
        { symbol: 'BTCUSDT', quoteVolume: '500' },
        { symbol: '币安人生USDT', quoteVolume: '999999' },
        { symbol: 'ETH-USDT', quoteVolume: '300' },
        { symbol: 'ETHUSDT', quoteVolume: '200' },
    ];

    const customExchangeInfo: MarketUniverseExchangeInfo = {
        symbols: [
            { symbol: 'BTCUSDT', contractType: 'PERPETUAL', status: 'TRADING' },
            { symbol: '币安人生USDT', contractType: 'PERPETUAL', status: 'TRADING' },
            { symbol: 'ETH-USDT', contractType: 'PERPETUAL', status: 'TRADING' },
            { symbol: 'ETHUSDT', contractType: 'PERPETUAL', status: 'TRADING' },
        ],
    };

    assert.deepEqual(
        selectTopUsdtPerpetualSymbols(tickers, customExchangeInfo, 10),
        ['BTCUSDT', 'ETHUSDT'],
    );
});

test('buildSymbolChunks splits symbols into stable batch sizes', () => {
    assert.deepEqual(
        buildSymbolChunks(['A', 'B', 'C', 'D', 'E'], 2),
        [['A', 'B'], ['C', 'D'], ['E']],
    );
});
