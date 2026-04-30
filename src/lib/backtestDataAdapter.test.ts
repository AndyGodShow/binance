import assert from 'node:assert/strict';
import test from 'node:test';

import type { KlineData } from '@/app/api/backtest/klines/route';
import { BacktestEngine } from './backtestEngine.ts';
import { adaptKlinesToBacktestDataSlice } from './backtestDataAdapter.ts';

function createKline(
    index: number,
    open: number,
    high: number,
    low: number,
    close: number,
    overrides: Partial<KlineData> = {},
): KlineData {
    const openTime = index * 60 * 60 * 1000;
    const closeTime = openTime + (60 * 60 * 1000) - 1;

    return {
        openTime,
        open: String(open),
        high: String(high),
        low: String(low),
        close: String(close),
        volume: '100',
        closeTime,
        quoteVolume: '10000',
        trades: 10,
        takerBuyVolume: '50',
        takerBuyQuoteVolume: '5000',
        ...overrides,
    };
}

test('adaptKlinesToBacktestDataSlice converts OHLCV into MarketBar values', () => {
    const slice = adaptKlinesToBacktestDataSlice([
        createKline(1, 100, 110, 90, 105, { volume: '123.45' }),
    ]);

    assert.deepEqual(slice.bars, [
        {
            time: (2 * 60 * 60 * 1000) - 1,
            open: 100,
            high: 110,
            low: 90,
            close: 105,
            volume: 123.45,
        },
    ]);
});

test('adaptKlinesToBacktestDataSlice records a warning when funding is missing', () => {
    const slice = adaptKlinesToBacktestDataSlice([
        createKline(1, 100, 110, 90, 105),
    ]);

    assert.equal(slice.funding.length, 0);
    assert.ok(slice.dataQuality.warnings.some((warning) => warning.code === 'missing-funding'));
});

test('adaptKlinesToBacktestDataSlice records a warning when open interest is missing', () => {
    const slice = adaptKlinesToBacktestDataSlice([
        createKline(1, 100, 110, 90, 105, { fundingRate: '0.0001' }),
    ]);

    assert.equal(slice.openInterest.length, 0);
    assert.ok(slice.dataQuality.warnings.some((warning) => warning.code === 'missing-open-interest'));
});

test('adaptKlinesToBacktestDataSlice converts funding and open interest auxiliary points', () => {
    const slice = adaptKlinesToBacktestDataSlice([
        createKline(1, 100, 110, 90, 105, {
            fundingRate: '0.0001',
            fundingRateSource: 'exact',
            openInterest: '2500',
            openInterestValue: '262500',
            openInterestSource: 'forward-fill',
        }),
    ]);

    assert.deepEqual(slice.funding, [
        {
            time: (2 * 60 * 60 * 1000) - 1,
            rate: 0.0001,
            source: 'exact',
            quality: 'exact',
        },
    ]);
    assert.deepEqual(slice.openInterest, [
        {
            time: (2 * 60 * 60 * 1000) - 1,
            openInterest: 2500,
            openInterestValue: 262500,
            source: 'forward-fill',
            quality: 'forward-fill',
        },
    ]);
});

test('BacktestEngine preserves existing no-funding result after adapter introduction', async () => {
    const signalKlines = Array.from({ length: 53 }, (_, index) => {
        if (index === 52) {
            return createKline(index, 105, 106, 104, 105);
        }

        return createKline(index, 100, 101, 99, 100);
    });

    const engine = new BacktestEngine({
        initialCapital: 10_000,
        commission: 0,
        slippage: 0,
        useStrategyRiskManagement: true,
    });

    const signalBarTime = signalKlines[50].closeTime;
    const result = await engine.run({
        signalKlines,
        strategyName: 'Adapter regression',
        symbol: 'BTCUSDT',
        signalInterval: '1h',
        strategyDetector: (ticker) => {
            if (ticker.closeTime !== signalBarTime) {
                return null;
            }

            return {
                signal: 'long',
                confidence: 90,
                risk: {
                    stopLoss: {
                        price: 95,
                        percentage: 5,
                        type: 'fixed',
                        reason: 'test stop',
                    },
                    takeProfit: {
                        targets: [],
                        riskRewardRatio: 0,
                    },
                    positionSizing: {
                        percentage: 25,
                        leverage: 4,
                        maxRiskAmount: 500,
                        confidence: 90,
                        reasoning: 'quarter margin, 4x notional',
                    },
                    metrics: {
                        entryPrice: 100,
                        riskAmount: 500,
                        potentialProfit: 500,
                    },
                },
            };
        },
    });

    assert.equal(result.totalTrades, 1);
    assert.equal(result.trades[0].exitReason, 'end_of_data');
    assert.equal(result.trades[0].profitUSDT, 500);
    assert.equal(result.totalProfitUSDT, 500);
});
