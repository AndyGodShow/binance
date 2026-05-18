import assert from 'node:assert/strict';
import test from 'node:test';

import {
    isStrategyScanCandidate,
    selectFullCoverageFuturesIndicatorSymbols,
    selectOpenInterestCoverageSymbols,
    selectStagedFuturesIndicatorSymbols,
    selectValidFuturesIndicatorSymbols,
} from './liveMarketData.ts';

test('selectValidFuturesIndicatorSymbols keeps API-compatible USDT futures symbols by volume', () => {
    const symbols = selectValidFuturesIndicatorSymbols([
        { symbol: 'BTCUSDT', quoteVolume: '1000' },
        { symbol: '币安人生USDT', quoteVolume: '9999' },
        { symbol: 'AAPLUSDT', quoteVolume: '500' },
        { symbol: 'TOO-LONG-SYMBOLUSDT', quoteVolume: '700' },
        { symbol: 'ETHUSDT', quoteVolume: '2000' },
    ]);

    assert.deepEqual(symbols, ['ETHUSDT', 'BTCUSDT', 'AAPLUSDT']);
});

test('selectValidFuturesIndicatorSymbols can cap deferred indicator coverage to the most liquid symbols', () => {
    const symbols = selectValidFuturesIndicatorSymbols([
        { symbol: 'BTCUSDT', quoteVolume: '1000' },
        { symbol: 'ETHUSDT', quoteVolume: '3000' },
        { symbol: 'SOLUSDT', quoteVolume: '2000' },
    ], 2);

    assert.deepEqual(symbols, ['ETHUSDT', 'SOLUSDT']);
});

test('selectStagedFuturesIndicatorSymbols starts with the liquid front batch then expands later', () => {
    const tickers = [
        { symbol: 'BTCUSDT', quoteVolume: '1000' },
        { symbol: 'ETHUSDT', quoteVolume: '4000' },
        { symbol: 'SOLUSDT', quoteVolume: '3000' },
        { symbol: 'DOGEUSDT', quoteVolume: '2000' },
    ];

    assert.deepEqual(
        selectStagedFuturesIndicatorSymbols(tickers, {
            expanded: false,
            initialLimit: 2,
            expandedLimit: 4,
        }),
        ['ETHUSDT', 'SOLUSDT']
    );
    assert.deepEqual(
        selectStagedFuturesIndicatorSymbols(tickers, {
            expanded: true,
            initialLimit: 2,
            expandedLimit: 4,
        }),
        ['ETHUSDT', 'SOLUSDT', 'DOGEUSDT', 'BTCUSDT']
    );
});

test('selectOpenInterestCoverageSymbols keeps every valid futures symbol for full OI coverage', () => {
    const tickers = [
        { symbol: 'BUSDT', quoteVolume: '5000' },
        { symbol: 'BTCUSDT', quoteVolume: '1000' },
        { symbol: '币安人生USDT', quoteVolume: '9999' },
        { symbol: 'ETHUSDT', quoteVolume: '4000' },
        { symbol: 'SOLUSDT', quoteVolume: '3000' },
        { symbol: 'DOGEUSDT', quoteVolume: '2000' },
        { symbol: 'TOO-LONG-SYMBOLUSDT', quoteVolume: '700' },
    ];

    assert.deepEqual(
        selectOpenInterestCoverageSymbols(tickers),
        ['BUSDT', 'ETHUSDT', 'SOLUSDT', 'DOGEUSDT', 'BTCUSDT']
    );
});

test('selectFullCoverageFuturesIndicatorSymbols starts staged and later includes every valid futures symbol', () => {
    const tickers = [
        { symbol: 'BUSDT', quoteVolume: '5000' },
        { symbol: 'BTCUSDT', quoteVolume: '1000' },
        { symbol: '币安人生USDT', quoteVolume: '9999' },
        { symbol: 'ETHUSDT', quoteVolume: '4000' },
        { symbol: 'SOLUSDT', quoteVolume: '3000' },
        { symbol: 'DOGEUSDT', quoteVolume: '2000' },
    ];

    assert.deepEqual(
        selectFullCoverageFuturesIndicatorSymbols(tickers, {
            expanded: false,
            fullCoverage: false,
            initialLimit: 2,
            expandedLimit: 4,
        }),
        ['BUSDT', 'ETHUSDT']
    );
    assert.deepEqual(
        selectFullCoverageFuturesIndicatorSymbols(tickers, {
            expanded: true,
            fullCoverage: false,
            initialLimit: 2,
            expandedLimit: 4,
        }),
        ['BUSDT', 'ETHUSDT', 'SOLUSDT', 'DOGEUSDT']
    );
    assert.deepEqual(
        selectFullCoverageFuturesIndicatorSymbols(tickers, {
            expanded: true,
            fullCoverage: true,
            initialLimit: 2,
            expandedLimit: 4,
        }),
        ['BUSDT', 'ETHUSDT', 'SOLUSDT', 'DOGEUSDT', 'BTCUSDT']
    );
});

test('isStrategyScanCandidate keeps only rows with strategy-grade enrichment', () => {
    assert.equal(isStrategyScanCandidate({ symbol: 'BTCUSDT', lastPrice: '100', quoteVolume: '1000' }), false);
    assert.equal(isStrategyScanCandidate({ symbol: 'ETHUSDT', lastPrice: '100', quoteVolume: '1000', volumeMA: 10 }), true);
    assert.equal(isStrategyScanCandidate({
        symbol: 'SOLUSDT',
        lastPrice: '100',
        quoteVolume: '1000',
        strategyContexts: { weiShen: {} as never },
    }), true);
});
