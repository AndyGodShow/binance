import assert from 'node:assert/strict';
import test from 'node:test';

import {
    isBacktestSymbolCandidate,
    selectBacktestSymbolsByVolume,
} from './backtestSymbolSelection.ts';

test('isBacktestSymbolCandidate accepts localized USDT futures symbols', () => {
    assert.equal(isBacktestSymbolCandidate('BTCUSDT'), true);
    assert.equal(isBacktestSymbolCandidate('1000PEPEUSDT'), true);
    assert.equal(isBacktestSymbolCandidate('币安人生USDT'), true);
    assert.equal(isBacktestSymbolCandidate('龙虾USDT'), true);
    assert.equal(isBacktestSymbolCandidate('我踏马来了USDT'), true);
    assert.equal(isBacktestSymbolCandidate('ETH-USDT'), false);
    assert.equal(isBacktestSymbolCandidate('TOO-LONG-SYMBOLUSDT'), false);
});

test('selectBacktestSymbolsByVolume keeps localized market rows while sorting', () => {
    const symbols = selectBacktestSymbolsByVolume([
        { symbol: 'BTCUSDT', quoteVolume: '500' },
        { symbol: '币安人生USDT', quoteVolume: '999999' },
        { symbol: 'ETH-USDT', quoteVolume: '300' },
        { symbol: 'ETHUSDT', quoteVolume: '2000' },
    ]);

    assert.deepEqual(symbols, ['币安人生USDT', 'ETHUSDT', 'BTCUSDT']);
});
