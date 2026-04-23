import assert from 'node:assert/strict';
import test from 'node:test';

import type { HistoricalRangeFetchResult } from './historicalDataFetcher.ts';
import { runBacktestHistoryPreflight } from './backtestHistoryPreflight.ts';

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
