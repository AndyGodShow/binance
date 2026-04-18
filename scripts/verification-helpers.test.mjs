import test from 'node:test';
import assert from 'node:assert/strict';

import {
    buildApiSmokeEndpoints,
    createRunSummary,
    validatePayload,
} from './verification-helpers.mjs';

test('buildApiSmokeEndpoints creates conservative route coverage with deterministic query params', () => {
    const endpoints = buildApiSmokeEndpoints({
        symbol: 'ethusdt',
        keyword: 'pepe',
        now: Date.UTC(2026, 3, 17, 8, 0, 0),
    });

    assert.deepEqual(
        endpoints.map((endpoint) => endpoint.name),
        [
            'market',
            'market-light',
            'market-multiframe',
            'oi-all',
            'oi-multiframe',
            'longshort',
            'macro',
            'rsrs',
            'onchain-dashboard',
            'backtest-klines',
            'data-download-coverage',
        ]
    );

    const multiframe = endpoints.find((endpoint) => endpoint.name === 'market-multiframe');
    assert.equal(multiframe?.path, '/api/market/multiframe?symbols=ETHUSDT');

    const backtest = endpoints.find((endpoint) => endpoint.name === 'backtest-klines');
    assert.match(backtest?.path ?? '', /symbol=ETHUSDT/);
    assert.match(backtest?.path ?? '', /includeAuxiliary=false/);
});

test('validatePayload accepts expected API response shapes', () => {
    assert.doesNotThrow(() => validatePayload({ name: 'market', expect: 'array' }, [{ symbol: 'BTCUSDT' }]));
    assert.doesNotThrow(() => validatePayload({ name: 'oi-all', expect: 'object' }, { BTCUSDT: '100' }));
    assert.doesNotThrow(() => validatePayload({ name: 'backtest-klines', expect: 'backtest' }, { data: [{}], count: 1 }));
});

test('validatePayload rejects empty or mismatched API response shapes', () => {
    assert.throws(() => validatePayload({ name: 'market', expect: 'array' }, []), /expected non-empty array/);
    assert.throws(() => validatePayload({ name: 'oi-all', expect: 'object' }, null), /expected object/);
    assert.throws(() => validatePayload({ name: 'backtest-klines', expect: 'backtest' }, { data: [] }), /expected non-empty backtest data/);
});

test('createRunSummary reports pass counts and latency stats', () => {
    const summary = createRunSummary([
        { ok: true, durationMs: 100 },
        { ok: true, durationMs: 300 },
        { ok: false, durationMs: 200 },
    ]);

    assert.equal(summary.total, 3);
    assert.equal(summary.passed, 2);
    assert.equal(summary.failed, 1);
    assert.equal(summary.averageDurationMs, 200);
    assert.equal(summary.maxDurationMs, 300);
});
