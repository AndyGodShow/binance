import assert from 'node:assert/strict';
import test from 'node:test';

import type { HistoricalRangeFetchResult } from './historicalDataFetcher.ts';
import {
    resolveExecutableBacktestRange,
    runBacktestHistoryPreflight,
} from './backtestHistoryPreflight.ts';

test('runBacktestHistoryPreflight rejects formal backtests when any key timeframe misses the 98% threshold', async () => {
    const fakeFetcher = {
        async fetchRangeDataWithAudit(_symbol: string, interval: string): Promise<HistoricalRangeFetchResult> {
            const bad = interval === '15m';
            return {
                klines: [],
                audit: {
                    symbol: 'BTCUSDT',
                    interval,
                    requestedStartTime: 0,
                    requestedEndTime: 1,
                    expectedStartTime: 0,
                    expectedEndTime: 1,
                    actualStartTime: bad ? null : 0,
                    actualEndTime: bad ? null : 1,
                    actualBars: bad ? 1499 : 100,
                    expectedBars: bad ? 43800 : 100,
                    coverageRatio: bad ? 1499 / 43800 : 1,
                    coveragePercent: bad ? (1499 / 43800) * 100 : 100,
                    gapCount: 0,
                    missingBars: 0,
                    maxGapBars: 0,
                    hasGaps: false,
                    readiness: bad ? 'exploratory-only' : 'ready',
                    backtestReady: !bad,
                    reasons: bad ? ['覆盖率仅 3.42%，低于正式回测阈值 98%。'] : [],
                },
            };
        },
    };

    const report = await runBacktestHistoryPreflight({
        dataFetcher: fakeFetcher as never,
        strategyId: 'wei-shen-ledger',
        symbol: 'BTCUSDT',
        startTime: 0,
        endTime: 1,
        signalInterval: '1h',
        executionInterval: '15m',
    });

    assert.equal(report.passed, false);
    assert.ok(report.reasons.some((reason) => reason.includes('15m')));
});

test('resolveExecutableBacktestRange shrinks an incomplete request to the common available window', () => {
    const report = {
        strategyId: 'strong-breakout',
        symbol: 'NEWUSDT',
        requestedStartTime: 0,
        requestedEndTime: 2000,
        passed: false,
        reasons: [],
        intervals: [
            {
                role: 'signal',
                symbol: 'NEWUSDT',
                interval: '1h',
                requestedStartTime: 0,
                requestedEndTime: 2000,
                expectedStartTime: 0,
                expectedEndTime: 2000,
                actualStartTime: 300,
                actualEndTime: 1900,
                actualBars: 20,
                expectedBars: 30,
                coverageRatio: 20 / 30,
                coveragePercent: (20 / 30) * 100,
                gapCount: 0,
                missingBars: 0,
                maxGapBars: 0,
                hasGaps: false,
                readiness: 'exploratory-only' as const,
                backtestReady: false,
                reasons: ['实际起点晚于请求起点'],
            },
            {
                role: 'execution',
                symbol: 'NEWUSDT',
                interval: '15m',
                requestedStartTime: 0,
                requestedEndTime: 2000,
                expectedStartTime: 0,
                expectedEndTime: 2000,
                actualStartTime: 500,
                actualEndTime: 1800,
                actualBars: 50,
                expectedBars: 80,
                coverageRatio: 50 / 80,
                coveragePercent: (50 / 80) * 100,
                gapCount: 0,
                missingBars: 0,
                maxGapBars: 0,
                hasGaps: false,
                readiness: 'exploratory-only' as const,
                backtestReady: false,
                reasons: ['实际起点晚于请求起点'],
            },
        ],
    };

    assert.deepEqual(resolveExecutableBacktestRange(report), {
        startTime: 500,
        endTime: 1800,
        degraded: true,
        reason: '历史数据不完整，已自动收缩到各关键周期共同可用区间。',
    });
});

test('resolveExecutableBacktestRange can still run when optional confirmation history is unavailable', () => {
    const report = {
        strategyId: 'strong-breakout',
        symbol: 'NEWUSDT',
        requestedStartTime: 0,
        requestedEndTime: 2000,
        passed: false,
        reasons: [],
        intervals: [
            {
                role: 'signal',
                symbol: 'NEWUSDT',
                interval: '1h',
                requestedStartTime: 0,
                requestedEndTime: 2000,
                expectedStartTime: 0,
                expectedEndTime: 2000,
                actualStartTime: 300,
                actualEndTime: 1900,
                actualBars: 20,
                expectedBars: 30,
                coverageRatio: 20 / 30,
                coveragePercent: (20 / 30) * 100,
                gapCount: 0,
                missingBars: 0,
                maxGapBars: 0,
                hasGaps: false,
                readiness: 'exploratory-only' as const,
                backtestReady: false,
                reasons: ['实际起点晚于请求起点'],
            },
            {
                role: 'confirm-5m',
                symbol: 'NEWUSDT',
                interval: '5m',
                requestedStartTime: 0,
                requestedEndTime: 2000,
                expectedStartTime: 0,
                expectedEndTime: 2000,
                actualStartTime: null,
                actualEndTime: null,
                actualBars: 0,
                expectedBars: 80,
                coverageRatio: 0,
                coveragePercent: 0,
                gapCount: 0,
                missingBars: 0,
                maxGapBars: 0,
                hasGaps: false,
                readiness: 'not-ready' as const,
                backtestReady: false,
                reasons: ['没有返回任何历史 K 线。'],
            },
        ],
    };

    assert.deepEqual(resolveExecutableBacktestRange(report), {
        startTime: 300,
        endTime: 1900,
        degraded: true,
        reason: '历史数据不完整，已自动收缩到各关键周期共同可用区间。',
    });
});
