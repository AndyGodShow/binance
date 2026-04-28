import assert from 'node:assert/strict';
import test from 'node:test';

import { buildExecutionIntervalFallbackCandidates } from './backtestExecutionResolution.ts';

test('buildExecutionIntervalFallbackCandidates preserves fine-to-coarse executable fallback order', () => {
    assert.deepEqual(
        buildExecutionIntervalFallbackCandidates({
            preferredExecutionInterval: '1m',
            signalInterval: '1h',
        }),
        ['1m', '5m', '15m', '1h'],
    );
});

test('buildExecutionIntervalFallbackCandidates does not try finer intervals than the selected execution interval', () => {
    assert.deepEqual(
        buildExecutionIntervalFallbackCandidates({
            preferredExecutionInterval: '5m',
            signalInterval: '1h',
        }),
        ['5m', '15m', '1h'],
    );
});

test('buildExecutionIntervalFallbackCandidates keeps same-interval execution pinned to the signal interval', () => {
    assert.deepEqual(
        buildExecutionIntervalFallbackCandidates({
            preferredExecutionInterval: '1h',
            signalInterval: '1h',
        }),
        ['1h'],
    );
});
