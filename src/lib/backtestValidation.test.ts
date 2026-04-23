import test from 'node:test';
import assert from 'node:assert/strict';

import { shouldDeferBacktestValidationFailure } from './backtestValidation.ts';

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
