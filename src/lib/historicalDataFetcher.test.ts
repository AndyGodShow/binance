import assert from 'node:assert/strict';
import test from 'node:test';

import type { KlineData } from '../app/api/backtest/klines/route.ts';
import { HistoricalDataFetcher } from './historicalDataFetcher.ts';

function createBar(openTime: number, intervalMs: number): KlineData {
    return {
        openTime,
        open: '100',
        high: '101',
        low: '99',
        close: '100',
        volume: '10',
        closeTime: openTime + intervalMs - 1,
        quoteVolume: '1000',
        trades: 10,
        takerBuyVolume: '5',
        takerBuyQuoteVolume: '500',
    };
}

test('HistoricalDataFetcher paginates full aligned ranges instead of stopping on the first partial-looking chunk', async () => {
    const fetcher = new HistoricalDataFetcher({ baseUrl: 'http://example.test/api/backtest/klines' });
    const interval = '1h';
    const intervalMs = HistoricalDataFetcher.getIntervalMilliseconds(interval);
    const startTime = Date.UTC(2021, 0, 1, 0, 30);
    const alignedStart = Date.UTC(2021, 0, 1, 1, 0);
    const expectedBarCount = 2200;
    const endTime = alignedStart + (expectedBarCount * intervalMs) + (30 * 60 * 1000) - 1;
    const requests: Array<{ startTime: number; endTime: number }> = [];
    const realFetch = globalThis.fetch;

    globalThis.fetch = async (input: string | URL | Request) => {
        const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url);
        const chunkStart = Number.parseInt(url.searchParams.get('startTime') || '0', 10);
        const chunkEnd = Number.parseInt(url.searchParams.get('endTime') || '0', 10);
        requests.push({ startTime: chunkStart, endTime: chunkEnd });

        const bars: KlineData[] = [];
        for (let openTime = chunkStart; openTime + intervalMs - 1 <= chunkEnd; openTime += intervalMs) {
            bars.push(createBar(openTime, intervalMs));
        }

        return new Response(JSON.stringify({ data: bars }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
        });
    };

    try {
        const bars = await fetcher.fetchRangeData('BTCUSDT', interval, startTime, endTime, {
            includeAuxiliary: false,
        });

        assert.equal(bars.length, expectedBarCount);
        assert.equal(bars[0].openTime, alignedStart);
        assert.equal(requests.length, 2);
    } finally {
        globalThis.fetch = realFetch;
    }
});

test('HistoricalDataFetcher audit fails fast when long-window coverage is obviously truncated', () => {
    const interval = '1h';
    const intervalMs = HistoricalDataFetcher.getIntervalMilliseconds(interval);
    const startTime = Date.UTC(2021, 3, 20, 12, 21, 11, 990);
    const endTime = Date.UTC(2026, 3, 19, 12, 21, 11, 990);
    const bars = Array.from({ length: 1499 }, (_, index) =>
        createBar(Date.UTC(2021, 3, 20, 13, 0, 0, 0) + (index * intervalMs), intervalMs),
    );

    const audit = HistoricalDataFetcher.auditKlines({
        symbol: 'BTCUSDT',
        interval,
        requestedStartTime: startTime,
        requestedEndTime: endTime,
        klines: bars,
    });

    assert.equal(audit.backtestReady, false);
    assert.equal(audit.readiness, 'exploratory-only');
    assert.ok(audit.expectedBars > 40_000);
    assert.ok(audit.actualBars === 1499);
    assert.ok(audit.coveragePercent < 98);
});
