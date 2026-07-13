import test from 'node:test';
import assert from 'node:assert/strict';

import * as backtestValidationModule from './backtestValidation.ts';

const {
    shouldDeferBacktestValidationFailure,
} = backtestValidationModule;

type ProbeClassification = {
    status: 'passed' | 'failed' | 'deferred';
    reason?: string;
};

type ClassifyBacktestValidationProbe = (input:
    | {
        kind: 'response';
        httpStatus: number;
        ok: boolean;
        payload: unknown;
    }
    | {
        kind: 'network-error';
        reason?: string;
    }
) => ProbeClassification;

type LatestRunGuard = {
    begin: () => number;
    isCurrent: (token: number) => boolean;
};

const classifyBacktestValidationProbe = (
    backtestValidationModule as Record<string, unknown>
).classifyBacktestValidationProbe as ClassifyBacktestValidationProbe;

const createLatestRunGuard = (
    backtestValidationModule as Record<string, unknown>
).createLatestRunGuard as () => LatestRunGuard;

test('shouldDeferBacktestValidationFailure defers explicit retryable upstream failures', () => {
    assert.equal(
        shouldDeferBacktestValidationFailure(503, { retryable: true }),
        true,
    );
    assert.equal(
        shouldDeferBacktestValidationFailure(429, null),
        true,
    );
});

test('shouldDeferBacktestValidationFailure keeps non-retryable validation failures blocking', () => {
    assert.equal(
        shouldDeferBacktestValidationFailure(500, { retryable: false }),
        false,
    );
    assert.equal(
        shouldDeferBacktestValidationFailure(404, null),
        false,
    );
    assert.equal(
        shouldDeferBacktestValidationFailure(200, { retryable: true }),
        false,
    );
});

test('classifyBacktestValidationProbe passes a successful response containing market data', () => {
    assert.deepEqual(
        classifyBacktestValidationProbe({
            kind: 'response',
            httpStatus: 200,
            ok: true,
            payload: { data: [[1, '100', '101', '99', '100.5']] },
        }),
        { status: 'passed' },
    );
});

test('classifyBacktestValidationProbe fails a successful but empty response', () => {
    const result = classifyBacktestValidationProbe({
        kind: 'response',
        httpStatus: 200,
        ok: true,
        payload: { data: [] },
    });

    assert.equal(result.status, 'failed');
    assert.match(result.reason ?? '', /没有可用|empty/i);
});

test('classifyBacktestValidationProbe defers rate limits and unavailable upstreams', () => {
    for (const httpStatus of [429, 503]) {
        assert.equal(
            classifyBacktestValidationProbe({
                kind: 'response',
                httpStatus,
                ok: false,
                payload: null,
            }).status,
            'deferred',
        );
    }
});

test('classifyBacktestValidationProbe defers retryable 5xx responses but fails terminal 5xx responses', () => {
    assert.equal(
        classifyBacktestValidationProbe({
            kind: 'response',
            httpStatus: 502,
            ok: false,
            payload: { retryable: true },
        }).status,
        'deferred',
    );
    assert.equal(
        classifyBacktestValidationProbe({
            kind: 'response',
            httpStatus: 500,
            ok: false,
            payload: { retryable: false },
        }).status,
        'failed',
    );
});

test('classifyBacktestValidationProbe defers a final network failure', () => {
    assert.deepEqual(
        classifyBacktestValidationProbe({
            kind: 'network-error',
            reason: 'request timed out after retries',
        }),
        {
            status: 'deferred',
            reason: 'request timed out after retries',
        },
    );
});

test('createLatestRunGuard prevents an older run from overwriting the latest run', () => {
    const guard = createLatestRunGuard();
    const olderRun = guard.begin();
    const latestRun = guard.begin();

    assert.equal(guard.isCurrent(olderRun), false);
    assert.equal(guard.isCurrent(latestRun), true);
});
