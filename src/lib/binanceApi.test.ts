import assert from 'node:assert/strict';
import test from 'node:test';

import {
    classifyBinanceFailureKind,
    createBinanceFailureLogKey,
    createBinanceFailureLogLimiter,
    extractBinanceRequestContext,
    formatBinanceRequestTarget,
    sanitizeBinanceErrorMessage,
} from './binanceApi.ts';

test('classifyBinanceFailureKind distinguishes common local network failures', () => {
    assert.equal(classifyBinanceFailureKind('connect ECONNRESET 1.2.3.4:443'), 'ECONNRESET');
    assert.equal(classifyBinanceFailureKind('TLS connection timed out'), 'TLS_TIMEOUT');
    assert.equal(classifyBinanceFailureKind('request ETIMEDOUT'), 'ETIMEDOUT');
    assert.equal(classifyBinanceFailureKind('ConnectTimeoutError: UND_ERR_CONNECT_TIMEOUT'), 'CONNECT_TIMEOUT');
    assert.equal(classifyBinanceFailureKind('getaddrinfo ENOTFOUND fapi.binance.com'), 'DNS');
    assert.equal(classifyBinanceFailureKind('https://fapi.binance.com -> HTTP 429'), 'HTTP_429');
    assert.equal(classifyBinanceFailureKind('https://fapi.binance.com -> HTTP 418'), 'HTTP_418');
});

test('formatBinanceRequestTarget omits non-symbol query parameters', () => {
    const context = extractBinanceRequestContext('/fapi/v1/klines?symbol=BTCUSDT&interval=15m&limit=50');

    assert.equal(formatBinanceRequestTarget(context), '/fapi/v1/klines?symbol=BTCUSDT');
    assert.equal(formatBinanceRequestTarget({ endpoint: '/fapi/v1/ticker/24hr' }), '/fapi/v1/ticker/24hr');
});

test('extractBinanceRequestContext captures endpoint and symbol without query noise', () => {
    const context = extractBinanceRequestContext('/fapi/v1/klines?symbol=BTCUSDT&interval=15m&limit=50');

    assert.deepEqual(context, {
        endpoint: '/fapi/v1/klines',
        symbol: 'BTCUSDT',
    });
});

test('sanitizeBinanceErrorMessage removes full Binance query strings from logs', () => {
    const sanitized = sanitizeBinanceErrorMessage(
        'https://fapi.binance.com/fapi/v1/klines?symbol=BTCUSDT&interval=15m&limit=50 -> HTTP 429'
    );

    assert.equal(sanitized, 'binance:/fapi/v1/klines?symbol=BTCUSDT -> HTTP 429');
    assert.equal(sanitized.includes('interval=15m'), false);
    assert.equal(sanitized.includes('limit=50'), false);
});

test('createBinanceFailureLogLimiter suppresses repeated endpoint failure logs', () => {
    const limiter = createBinanceFailureLogLimiter(2, 1000);

    assert.deepEqual(limiter.take('klines:ECONNRESET', 1000), { shouldLog: true, suppressedCount: 0 });
    assert.deepEqual(limiter.take('klines:ECONNRESET', 1100), { shouldLog: true, suppressedCount: 0 });
    assert.deepEqual(limiter.take('klines:ECONNRESET', 1200), { shouldLog: false, suppressedCount: 0 });
    assert.deepEqual(limiter.take('klines:ECONNRESET', 2101), { shouldLog: true, suppressedCount: 1 });
});

test('createBinanceFailureLogKey includes endpoint symbol and failure kind', () => {
    assert.equal(
        createBinanceFailureLogKey({ endpoint: '/fapi/v1/klines', symbol: 'BTCUSDT' }, 'ECONNRESET'),
        '/fapi/v1/klines:BTCUSDT:ECONNRESET'
    );
    assert.equal(
        createBinanceFailureLogKey({ endpoint: '/fapi/v1/ticker/24hr' }, 'FETCH_FAILED', 'retry'),
        'retry:/fapi/v1/ticker/24hr:all:FETCH_FAILED'
    );
});
