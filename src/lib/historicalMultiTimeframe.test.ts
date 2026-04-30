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

test('buildHistoricalTickerOverrides attaches wei-shen strategy context using BTC multi-timeframe data', async () => {
    const startTime = Date.UTC(2025, 0, 1);
    const baseKlines = Array.from({ length: 120 }, (_, index) =>
        createKline(startTime + ((index + 1) * 60 * 60 * 1000), 100 + index)
    );
    const btc1h = Array.from({ length: 120 }, (_, index) =>
        createKline(startTime + ((index + 1) * 60 * 60 * 1000), 200 + index)
    );
    const btc4h = Array.from({ length: 120 }, (_, index) =>
        createKline(startTime + ((index + 1) * 4 * 60 * 60 * 1000), 300 + index)
    );
    const btc1d = Array.from({ length: 40 }, (_, index) =>
        createKline(startTime + ((index + 1) * 24 * 60 * 60 * 1000), 400 + index)
    );

    const calls: Array<{ symbol: string; interval: string }> = [];
    const overrides = await buildHistoricalTickerOverrides({
        strategyId: 'wei-shen-ledger',
        symbol: 'ETHUSDT',
        startTime,
        endTime: baseKlines[baseKlines.length - 1].closeTime,
        baseInterval: '1h',
        baseKlines,
        fetchRangeData: async (symbol, interval) => {
            calls.push({ symbol, interval });

            if (symbol === 'BTCUSDT' && interval === '1h') {
                return btc1h;
            }

            if (symbol === 'BTCUSDT' && interval === '4h') {
                return btc4h;
            }

            if (symbol === 'BTCUSDT' && interval === '1d') {
                return btc1d;
            }

            return baseKlines;
        },
    });

    const sample = overrides.get(baseKlines[baseKlines.length - 1].closeTime) as Record<string, unknown> | undefined;
    assert.ok(sample);
    assert.ok(calls.some((call) => call.symbol === 'BTCUSDT' && call.interval === '1h'));
    assert.ok(calls.some((call) => call.symbol === 'BTCUSDT' && call.interval === '4h'));
    assert.ok(calls.some((call) => call.symbol === 'BTCUSDT' && call.interval === '1d'));
    assert.ok('strategyContexts' in sample);
});

test('buildHistoricalTickerOverrides attaches sentiment hotspot context from historical auxiliary data', async () => {
    const startTime = Date.UTC(2025, 0, 1);
    const baseKlines = Array.from({ length: 80 }, (_, index) => {
        const close = index < 55 ? 100 + index * 0.1 : 105 + (index - 55) * 0.8;
        const kline = createKline(startTime + ((index + 1) * 60 * 60 * 1000), close, close * 1.01);
        return {
            ...kline,
            quoteVolume: index < 72 ? '8000000' : '76000000',
            openInterestValue: String(index < 48 ? 5_000_000 + index * 10_000 : 5_500_000 + (index - 48) * 80_000),
            fundingRate: index < 70 ? '0.00003' : '-0.00036',
        };
    });
    const dailyKlines = Array.from({ length: 12 }, (_, index) => ({
        ...createKline(startTime + ((index + 1) * 24 * 60 * 60 * 1000), 100 + index),
        quoteVolume: index < 11 ? '18000000' : '72000000',
    }));

    const overrides = await buildHistoricalTickerOverrides({
        strategyId: 'sentiment-hotspot',
        symbol: 'SAGAUSDT',
        startTime,
        endTime: baseKlines[baseKlines.length - 1].closeTime,
        baseInterval: '1h',
        baseKlines,
        fetchRangeData: async (_symbol, interval) => {
            if (interval === '1d') {
                return dailyKlines;
            }

            return baseKlines;
        },
    });

    const sample = overrides.get(baseKlines[baseKlines.length - 1].closeTime);
    const sentimentHotspot = sample?.strategyContexts?.sentimentHotspot;

    assert.ok(sentimentHotspot);
    assert.equal(sentimentHotspot.hasVolSurge, true);
    assert.equal(sentimentHotspot.hasSquare, true);
    assert.equal(sentimentHotspot.oiRising, true);
    assert.ok(sentimentHotspot.oiChangePct >= 8);
    assert.ok(Math.abs(sentimentHotspot.fundingRatePct - (-0.036)) < 0.000001);
});
