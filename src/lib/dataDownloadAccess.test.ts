import test from 'node:test';
import assert from 'node:assert/strict';

import {
    authorizeDataDownloadRequest,
    validateDataDownloadRequest,
} from './dataDownloadAccess.ts';

test('authorizeDataDownloadRequest allows local development without a token', () => {
    assert.deepEqual(
        authorizeDataDownloadRequest(null, {
            nodeEnv: 'development',
            token: '',
        }),
        { ok: true }
    );
});

test('authorizeDataDownloadRequest rejects production requests when token is not configured', () => {
    assert.deepEqual(
        authorizeDataDownloadRequest(null, {
            nodeEnv: 'production',
            token: '',
        }),
        {
            ok: false,
            status: 503,
            error: 'DATA_DOWNLOAD_TOKEN is required in production',
        }
    );
});

test('authorizeDataDownloadRequest requires a matching bearer token when configured', () => {
    assert.deepEqual(
        authorizeDataDownloadRequest('Bearer wrong-token', {
            nodeEnv: 'development',
            token: 'expected-token',
        }),
        {
            ok: false,
            status: 401,
            error: 'Unauthorized',
        }
    );

    assert.deepEqual(
        authorizeDataDownloadRequest('Bearer expected-token', {
            nodeEnv: 'development',
            token: 'expected-token',
        }),
        { ok: true }
    );
});

test('validateDataDownloadRequest normalizes valid payloads', () => {
    assert.deepEqual(
        validateDataDownloadRequest({
            symbol: 'btcusdt',
            type: 'metrics',
            startDate: '2025-01-01',
            endDate: '2025-01-31',
        }),
        {
            ok: true,
            value: {
                symbol: 'BTCUSDT',
                type: 'metrics',
                startDate: '2025-01-01',
                endDate: '2025-01-31',
            },
        }
    );
});

test('validateDataDownloadRequest rejects invalid symbols and oversized ranges', () => {
    assert.deepEqual(
        validateDataDownloadRequest({
            symbol: '../BTCUSDT',
            type: 'metrics',
            startDate: '2025-01-01',
            endDate: '2025-01-31',
        }),
        {
            ok: false,
            error: 'Invalid symbol',
        }
    );

    assert.deepEqual(
        validateDataDownloadRequest({
            symbol: 'BTCUSDT',
            type: 'metrics',
            startDate: '2024-01-01',
            endDate: '2025-06-01',
        }),
        {
            ok: false,
            error: 'Date range exceeds 366 days',
        }
    );
});
