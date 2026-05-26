import test from 'node:test';
import assert from 'node:assert/strict';

import {
    validateBacktestKlinesParams,
    validateLongShortParams,
    validateOnchainDashboardParams,
    validateSymbolsParam,
} from './apiRequestValidation.ts';

test('validates and normalizes a futures symbol', () => {
    const result = validateLongShortParams(new URLSearchParams('symbol=btcusdt&period=1h&limit=30'));

    assert.equal(result.ok, true);
    if (result.ok) {
        assert.equal(result.value.symbol, 'BTCUSDT');
        assert.equal(result.value.period, '1h');
        assert.equal(result.value.limit, 30);
    }
});

test('accepts single-character Binance futures symbols', () => {
    const result = validateLongShortParams(new URLSearchParams('symbol=busdt&period=1h&limit=30'));

    assert.equal(result.ok, true);
    if (result.ok) {
        assert.equal(result.value.symbol, 'BUSDT');
    }
});

test('rejects invalid futures symbols', () => {
    const result = validateLongShortParams(new URLSearchParams('symbol=https://evil.test/BTCUSDT&period=1h'));

    assert.equal(result.ok, false);
    if (!result.ok) {
        assert.match(result.details, /symbol/i);
    }
});

test('rejects invalid interval for backtest klines', () => {
    const result = validateBacktestKlinesParams(new URLSearchParams('symbol=BTCUSDT&interval=7m'));

    assert.equal(result.ok, false);
    if (!result.ok) {
        assert.match(result.details, /interval/i);
    }
});

test('accepts localized symbols for backtest klines', () => {
    const result = validateBacktestKlinesParams(new URLSearchParams('symbol=币安人生USDT&interval=1h'));

    assert.equal(result.ok, true);
    if (result.ok) {
        assert.equal(result.value.symbol, '币安人生USDT');
    }
});

test('rejects invalid long short period', () => {
    const result = validateLongShortParams(new URLSearchParams('symbol=BTCUSDT&period=3d'));

    assert.equal(result.ok, false);
    if (!result.ok) {
        assert.match(result.details, /period/i);
    }
});

test('rejects invalid limit values', () => {
    const result = validateBacktestKlinesParams(new URLSearchParams('symbol=BTCUSDT&limit=1501'));

    assert.equal(result.ok, false);
    if (!result.ok) {
        assert.match(result.details, /limit/i);
    }
});

test('rejects invalid start and end time ranges', () => {
    const result = validateBacktestKlinesParams(new URLSearchParams('symbol=BTCUSDT&startTime=1700000000000&endTime=1600000000000'));

    assert.equal(result.ok, false);
    if (!result.ok) {
        assert.match(result.details, /startTime/i);
    }
});

test('rejects open-ended backtest time ranges over one year', () => {
    const result = validateBacktestKlinesParams(new URLSearchParams('symbol=BTCUSDT&startTime=1600000000000'));

    assert.equal(result.ok, false);
    if (!result.ok) {
        assert.match(result.details, /365/);
    }
});

test('rejects symbol batches over the route limit', () => {
    const symbols = Array.from({ length: 21 }, (_, index) => `TEST${index}USDT`).join(',');
    const result = validateSymbolsParam(new URLSearchParams(`symbols=${symbols}`), { maxSymbols: 20 });

    assert.equal(result.ok, false);
    if (!result.ok) {
        assert.match(result.details, /20/);
    }
});

test('deduplicates and normalizes symbol batches', () => {
    const result = validateSymbolsParam(new URLSearchParams('symbols=btcusdt,ETHUSDT,btcusdt'), { maxSymbols: 20 });

    assert.equal(result.ok, true);
    if (result.ok) {
        assert.deepEqual(result.value, ['BTCUSDT', 'ETHUSDT']);
    }
});

test('accepts localized Binance symbols only when enabled for symbol batches', () => {
    const strictResult = validateSymbolsParam(new URLSearchParams('symbols=币安人生USDT'), { maxSymbols: 20 });
    assert.equal(strictResult.ok, false);

    const localizedResult = validateSymbolsParam(
        new URLSearchParams('symbols=币安人生USDT,龙虾USDT'),
        { maxSymbols: 20, allowLocalized: true }
    );

    assert.equal(localizedResult.ok, true);
    if (localizedResult.ok) {
        assert.deepEqual(localizedResult.value, ['币安人生USDT', '龙虾USDT']);
    }
});

test('rejects unsafe localized symbol batch values', () => {
    const result = validateSymbolsParam(
        new URLSearchParams('symbols=https://evil.test/币安人生USDT'),
        { maxSymbols: 20, allowLocalized: true }
    );

    assert.equal(result.ok, false);
});

test('validates onchain keyword length and scope', () => {
    const tooLongKeyword = 'A'.repeat(65);
    const result = validateOnchainDashboardParams(new URLSearchParams(`keyword=${tooLongKeyword}&scope=contracts`));

    assert.equal(result.ok, false);
    if (!result.ok) {
        assert.match(result.details, /keyword/i);
    }
});
