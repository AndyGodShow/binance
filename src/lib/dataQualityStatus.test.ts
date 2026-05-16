import test from 'node:test';
import assert from 'node:assert/strict';

import {
    buildOpenInterestAllPayload,
    buildQualityHeaders,
    extractSymbolValueMap,
    summarizeTimedPayloadQuality,
} from './dataQualityStatus.ts';

test('buildOpenInterestAllPayload preserves symbol map compatibility on live data', () => {
    const payload = buildOpenInterestAllPayload({
        data: { BTCUSDT: '100', ETHUSDT: '200' },
        dataQuality: 'enriched',
        buildState: 'ready',
        dataSource: 'live',
        updatedAt: 123,
    });

    assert.equal(payload.BTCUSDT, '100');
    assert.equal(payload.ETHUSDT, '200');
    assert.equal(payload.dataQuality, 'enriched');
    assert.equal(payload.buildState, 'ready');
    assert.equal(payload.isFallback, false);
});

test('buildOpenInterestAllPayload marks empty failures as unavailable fallback', () => {
    const payload = buildOpenInterestAllPayload({
        data: {},
        dataQuality: 'unavailable',
        buildState: 'failed',
        dataSource: 'empty-fallback',
        errorKind: 'upstream_error',
        isFallback: true,
        updatedAt: 123,
    });

    assert.equal(Object.keys(extractSymbolValueMap(payload)).length, 0);
    assert.equal(payload.dataQuality, 'unavailable');
    assert.equal(payload.buildState, 'failed');
    assert.equal(payload.errorKind, 'upstream_error');
    assert.equal(payload.isFallback, true);
    assert.equal(payload.sourceStatus?.openInterest.status, 'failed');
});

test('extractSymbolValueMap ignores quality metadata', () => {
    const payload = buildOpenInterestAllPayload({
        data: { BTCUSDT: '100' },
        dataQuality: 'stale',
        buildState: 'stale',
        dataSource: 'stale-memory-cache',
        isStale: true,
        updatedAt: 123,
    });

    assert.deepEqual(extractSymbolValueMap(payload), { BTCUSDT: '100' });
});

test('buildQualityHeaders exposes consistent response headers', () => {
    const headers = buildQualityHeaders({
        dataQuality: 'stale',
        buildState: 'stale',
        dataSource: 'stale-memory-cache',
        cacheAgeSeconds: 42,
        isStale: true,
    });

    assert.equal(headers['X-Data-Quality'], 'stale');
    assert.equal(headers['X-Build-State'], 'stale');
    assert.equal(headers['X-Data-Source'], 'stale-memory-cache');
    assert.equal(headers['X-Cache-Age-Seconds'], '42');
    assert.equal(headers['X-Is-Stale'], '1');
});

test('summarizeTimedPayloadQuality reads degraded state from headers or body', () => {
    const fromHeader = summarizeTimedPayloadQuality({
        dataQuality: 'lightweight',
        buildState: 'building',
        dataSource: 'light-fallback',
    });
    const fromBody = summarizeTimedPayloadQuality({
        body: {
            dataQuality: 'unavailable',
            buildState: 'failed',
            isFallback: true,
            errorKind: 'timeout',
        },
    });

    assert.equal(fromHeader.isDegraded, true);
    assert.equal(fromHeader.message, '市场数据为轻量模式，部分策略字段暂不可用');
    assert.equal(fromBody.isUnavailable, true);
    assert.equal(fromBody.errorKind, 'timeout');
});

test('summarizeTimedPayloadQuality does not treat legacy payloads without metadata as degraded', () => {
    const legacy = summarizeTimedPayloadQuality({
        body: {
            BTCUSDT: '100',
            ETHUSDT: '200',
        },
    });

    assert.equal(legacy.dataQuality, 'unavailable');
    assert.equal(legacy.buildState, 'idle');
    assert.equal(legacy.isDegraded, false);
    assert.equal(legacy.message, undefined);
});
