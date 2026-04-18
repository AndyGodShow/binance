import test from 'node:test';
import assert from 'node:assert/strict';

import type { KlineData } from '@/app/api/backtest/klines/route';
import { buildHistoricalTickerOverrides } from './historicalMultiTimeframe.ts';

function createKline(closeTime: number, close: number, high: number = close): KlineData {
    const openTime = closeTime - (60 * 60 * 1000) + 1;

    return {
        openTime,
        open: String(close),
        high: String(high),
        low: String(close),
        close: String(close),
        volume: '100',
        closeTime,
        quoteVolume: '1000',
        trades: 10,
        takerBuyVolume: '50',
        takerBuyQuoteVolume: '500',
    };
}

test('buildHistoricalTickerOverrides skips failed auxiliary interval fetches', async () => {
    const startTime = Date.UTC(2025, 0, 1);
    const baseKlines = Array.from({ length: 80 }, (_, index) =>
        createKline(startTime + ((index + 1) * 60 * 60 * 1000), 100 + index)
    );

    const overrides = await buildHistoricalTickerOverrides({
        strategyId: 'strong-breakout',
        symbol: 'TESTUSDT',
        startTime,
        endTime: baseKlines[baseKlines.length - 1].closeTime,
        baseInterval: '1h',
        baseKlines,
        fetchRangeData: async (_symbol, interval) => {
            if (interval === '5m') {
                throw new Error('5m source unavailable');
            }

            return baseKlines;
        },
    });

    assert.equal(overrides.size, baseKlines.length);

    const sample = overrides.get(baseKlines[baseKlines.length - 1].closeTime);
    assert.ok(sample);
    assert.equal(typeof sample?.change15m, 'number');
});
