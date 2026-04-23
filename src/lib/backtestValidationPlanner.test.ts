import test from 'node:test';
import assert from 'node:assert/strict';

import {
    buildBacktestValidationStageRequest,
    estimateValidationBarCount,
} from './backtestValidationPlanner.ts';

test('estimateValidationBarCount reflects the requested interval span', () => {
    const startTime = Date.UTC(2026, 0, 1, 0, 0, 0);
    const endTime = startTime + (60 * 60 * 1000 * 23);

    assert.equal(estimateValidationBarCount(startTime, endTime, '1h'), 24);
    assert.equal(estimateValidationBarCount(startTime, endTime, '15m'), 93);
});

test('buildBacktestValidationStageRequest avoids always requesting the 1500-bar ceiling', () => {
    const startTime = Date.UTC(2026, 0, 1, 0, 0, 0);
    const endTime = startTime + (60 * 60 * 1000 * 23);

    const request = buildBacktestValidationStageRequest({
        symbol: 'BTCUSDT',
        interval: '1h',
        startTime,
        endTime,
    });

    assert.equal(request.limit, 24);
    assert.match(request.url, /limit=24/);
    assert.match(request.url, /includeAuxiliary=false/);
});

test('buildBacktestValidationStageRequest still caps large windows at 1500 bars', () => {
    const startTime = Date.UTC(2026, 0, 1, 0, 0, 0);
    const endTime = startTime + (60 * 1000 * 2200);

    const request = buildBacktestValidationStageRequest({
        symbol: 'BTCUSDT',
        interval: '1m',
        startTime,
        endTime,
    });

    assert.equal(request.limit, 1500);
});
