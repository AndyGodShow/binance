import test from 'node:test';
import assert from 'node:assert/strict';

import {
    buildApiSmokeEndpoints,
    compareEndpointToBaseline,
    createRunSummary,
    createEndpointBaseline,
    validatePayload,
    validateCrossEndpointConsistency,
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
            'market-health',
            'market-light',
            'market-multiframe',
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
    assert.doesNotThrow(() => validatePayload({ name: 'backtest-klines', expect: 'backtest' }, { data: [{}], count: 1 }));
    assert.doesNotThrow(() => validatePayload({ name: 'market-health', expect: 'market-health', minSymbols: 500, allowedNotReadyReasons: ['redis-not-configured'] }, {
        service: 'market', ready: false, serving: true, reason: 'redis-not-configured', dataQuality: 'lightweight', buildState: 'blocked', symbolCount: 660,
    }));
});

test('validatePayload rejects empty or mismatched API response shapes', () => {
    assert.throws(() => validatePayload({ name: 'market', expect: 'array' }, []), /expected non-empty array/);
    assert.throws(() => validatePayload({ name: 'backtest-klines', expect: 'backtest' }, { data: [] }), /expected non-empty backtest data/);
    assert.throws(() => validatePayload({ name: 'market-health', expect: 'market-health' }, { ready: true }), /valid market health payload/);
    assert.throws(() => validatePayload({ name: 'market-health', expect: 'market-health', minSymbols: 500 }, {
        service: 'market', ready: false, serving: false, dataQuality: 'unavailable', buildState: 'building', symbolCount: 0,
    }), /expected serving market data/);
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

test('createEndpointBaseline and compareEndpointToBaseline keep endpoint key signatures stable', () => {
    const endpoint = { name: 'market-light', expect: 'array' };
    const payload = [
        { symbol: 'BTCUSDT', lastPrice: '100', markPrice: '100', fundingRate: '0.01' },
        { symbol: 'ETHUSDT', lastPrice: '200', markPrice: '199', fundingRate: '0.02' },
    ];

    const baseline = createEndpointBaseline(endpoint, payload, { symbol: 'BTCUSDT' });
    const stableIssues = compareEndpointToBaseline(endpoint, baseline, payload, { symbol: 'BTCUSDT' });
    const driftIssues = compareEndpointToBaseline(
        endpoint,
        baseline,
        [{ symbol: 'BTCUSDT', lastPrice: '100', fundingRate: '0.01' }],
        { symbol: 'BTCUSDT' },
    );

    assert.deepEqual(stableIssues, []);
    assert.match(driftIssues[0], /sample keys changed/);
});

test('validateCrossEndpointConsistency verifies shared symbol contracts', () => {
    const issues = validateCrossEndpointConsistency({
        market: [{ symbol: 'BTCUSDT', lastPrice: '100', markPrice: '101', fundingRate: '0.01' }],
        'market-light': [{ symbol: 'BTCUSDT', lastPrice: '100', markPrice: '101', fundingRate: '0.01' }],
        'market-multiframe': {
            BTCUSDT: { o15m: 100, o1h: 99, o4h: 95 },
        },
        'oi-multiframe': {
            BTCUSDT: { currentValue: 12345 },
        },
        rsrs: {
            BTCUSDT: {
                beta: 1.1,
                r2: 0.8,
                rsrsFinal: 0.7,
                dynamicLongThreshold: 0.9,
                dynamicShortThreshold: -0.9,
                method: 'shared-core',
            },
        },
        'backtest-klines': {
            data: [
                { openTime: 1 },
                { openTime: 2 },
                { openTime: 3 },
            ],
        },
    }, { symbol: 'BTCUSDT' });

    assert.deepEqual(issues, []);
});

test('validateCrossEndpointConsistency reports missing symbols and malformed numeric fields', () => {
    const issues = validateCrossEndpointConsistency({
        market: [],
        'market-light': [{ symbol: 'BTCUSDT', lastPrice: '100', markPrice: '101', fundingRate: 1 }],
        'market-multiframe': {
            BTCUSDT: { o15m: 100, o1h: 'oops', o4h: 95 },
        },
        rsrs: {
            BTCUSDT: {
                beta: 'oops',
                r2: 0.8,
                rsrsFinal: 0.7,
                dynamicLongThreshold: 0.9,
                dynamicShortThreshold: -0.9,
                method: '',
            },
        },
        'backtest-klines': {
            data: [
                { openTime: 2 },
                { openTime: 1 },
            ],
        },
    }, { symbol: 'BTCUSDT' });

    assert.ok(issues.some((issue) => issue.includes('market payload missing BTCUSDT')));
    assert.ok(issues.some((issue) => issue.includes('market-light.BTCUSDT.fundingRate is not a string')));
    assert.ok(issues.some((issue) => issue.includes('market-multiframe.BTCUSDT is missing required open anchors')));
    assert.ok(issues.some((issue) => issue.includes('rsrs.BTCUSDT.beta is not numeric')));
    assert.ok(issues.some((issue) => issue.includes('backtest-klines data is not strictly increasing')));
});
