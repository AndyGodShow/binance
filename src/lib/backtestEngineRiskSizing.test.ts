import assert from 'node:assert/strict';
import test from 'node:test';

import type { KlineData } from '@/app/api/backtest/klines/route';
import { BacktestEngine } from './backtestEngine.ts';

function createKline(index: number, open: number, high: number, low: number, close: number): KlineData {
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
    };
}

test('BacktestEngine respects strategy risk position sizing percentage instead of always using full size', async () => {
    const signalKlines = Array.from({ length: 60 }, (_, index) => {
        if (index === 51) {
            return createKline(index, 100, 104, 99, 103);
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
        strategyName: 'Risk Sized Test',
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
                        price: 98,
                        percentage: 2,
                        type: 'fixed',
                        reason: 'test stop',
                    },
                    takeProfit: {
                        targets: [
                            {
                                price: 102,
                                percentage: 2,
                                closePercentage: 100,
                                reason: 'test target',
                            },
                        ],
                        riskRewardRatio: 1,
                    },
                    positionSizing: {
                        percentage: 25,
                        leverage: 1,
                        maxRiskAmount: 75,
                        confidence: 90,
                        reasoning: 'quarter size',
                    },
                    metrics: {
                        entryPrice: 100,
                        riskAmount: 75,
                        potentialProfit: 75,
                    },
                },
            };
        },
    });

    assert.equal(result.trades.length, 1);
    assert.equal(result.trades[0].size, 0.25);
});

test('BacktestEngine exits remaining wei-shen position on dynamic trailing stop after partial take profit', async () => {
    const signalKlines = [
        ...Array.from({ length: 50 }, (_, index) => createKline(index, 100, 101, 99, 100)),
        createKline(50, 100, 101, 99, 100),
        createKline(51, 100, 105, 99, 103),
        createKline(52, 103, 109, 102, 108),
        createKline(53, 108, 108.5, 105, 106),
        createKline(54, 106, 106.5, 104, 105),
    ];

    const engine = new BacktestEngine({
        initialCapital: 10_000,
        commission: 0,
        slippage: 0,
        useStrategyRiskManagement: true,
    });

    const signalBarTime = signalKlines[50].closeTime;
    const result = await engine.run({
        signalKlines,
        strategyName: 'Wei dynamic exit',
        symbol: 'BTCUSDT',
        signalInterval: '1h',
        strategyDetector: (ticker) => {
            if (ticker.closeTime !== signalBarTime) {
                return null;
            }

            return {
                signal: 'long',
                confidence: 92,
                risk: {
                    stopLoss: {
                        price: 96,
                        percentage: 4,
                        type: 'dynamic',
                        reason: 'initial stop',
                    },
                    takeProfit: {
                        targets: [
                            {
                                price: 104,
                                percentage: 4,
                                closePercentage: 0,
                                moveStopToEntry: true,
                                reason: '1R break even',
                            },
                            {
                                price: 108,
                                percentage: 8,
                                closePercentage: 50,
                                moveStopToEntry: true,
                                reason: '2R partial',
                            },
                        ],
                        riskRewardRatio: 2,
                    },
                    positionSizing: {
                        percentage: 50,
                        leverage: 1,
                        maxRiskAmount: 200,
                        confidence: 92,
                        reasoning: 'half size',
                    },
                    metrics: {
                        entryPrice: 100,
                        riskAmount: 200,
                        potentialProfit: 400,
                    },
                    dynamicExit: {
                        enabled: true,
                        timeframe: '1h',
                        emaPeriod: 2,
                        donchianLookback: 2,
                        activateAfterTargetIndex: 1,
                        invalidationPrice: 95,
                        reason: 'EMA2 / Donchian mid trailing',
                    },
                    timeStop: {
                        maxHoldBars: 20,
                        profitThreshold: 0.2,
                    },
                },
            };
        },
    });

    assert.ok(result.tradeLegs.some((trade) => trade.exitReason === 'take_profit' && Math.abs(trade.exitPrice - 108) < 0.001));
    assert.ok(result.tradeLegs.some((trade) => trade.exitReason === 'stop_loss' && trade.exitPrice > 104));
});

test('BacktestEngine honors invalidation price before the wider initial stop', async () => {
    const signalKlines = [
        ...Array.from({ length: 50 }, (_, index) => createKline(index, 100, 101, 99, 100)),
        createKline(50, 100, 101, 99, 100),
        createKline(51, 100, 101, 98.5, 99.2),
        createKline(52, 99.2, 100, 97, 98),
    ];

    const engine = new BacktestEngine({
        initialCapital: 10_000,
        commission: 0,
        slippage: 0,
        useStrategyRiskManagement: true,
    });

    const signalBarTime = signalKlines[50].closeTime;
    const result = await engine.run({
        signalKlines,
        strategyName: 'Wei invalidation exit',
        symbol: 'ETHUSDT',
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
                        price: 96,
                        percentage: 4,
                        type: 'dynamic',
                        reason: 'wide structure stop',
                    },
                    takeProfit: {
                        targets: [],
                        riskRewardRatio: 0,
                    },
                    positionSizing: {
                        percentage: 20,
                        leverage: 1,
                        maxRiskAmount: 80,
                        confidence: 90,
                        reasoning: 'test',
                    },
                    metrics: {
                        entryPrice: 100,
                        riskAmount: 80,
                        potentialProfit: 0,
                    },
                    dynamicExit: {
                        enabled: true,
                        timeframe: '1h',
                        emaPeriod: 2,
                        donchianLookback: 2,
                        activateAfterTargetIndex: 0,
                        invalidationPrice: 99,
                        reason: 'structure invalidation',
                    },
                },
            };
        },
    });

    assert.equal(result.tradeLegs[0]?.exitReason, 'signal');
    assert.ok(Math.abs((result.tradeLegs[0]?.exitPrice || 0) - 99) < 0.001);
});

test('BacktestEngine rejects pending execution when lower timeframe bars are missing', async () => {
    const signalKlines = Array.from({ length: 55 }, (_, index) =>
        createKline(index, 100, 101, 99, 100)
    );

    const engine = new BacktestEngine({
        initialCapital: 10_000,
        commission: 0,
        slippage: 0,
        useStrategyRiskManagement: true,
    });

    const signalBarTime = signalKlines[50].closeTime;
    await assert.rejects(
        () => engine.run({
            signalKlines,
            strategyName: 'Missing execution data',
            symbol: 'BTCUSDT',
            signalInterval: '1h',
            executionInterval: '15m',
            fetchExecutionKlines: async () => [],
            strategyDetector: (ticker) => {
                if (ticker.closeTime !== signalBarTime) {
                    return null;
                }

                return {
                    signal: 'long',
                    confidence: 90,
                    risk: {
                        stopLoss: {
                            price: 98,
                            percentage: 2,
                            type: 'fixed',
                            reason: 'test stop',
                        },
                        takeProfit: {
                            targets: [],
                            riskRewardRatio: 0,
                        },
                        positionSizing: {
                            percentage: 25,
                            leverage: 1,
                            maxRiskAmount: 75,
                            confidence: 90,
                            reasoning: 'quarter size',
                        },
                        metrics: {
                            entryPrice: 100,
                            riskAmount: 75,
                            potentialProfit: 0,
                        },
                    },
                };
            },
        }),
        /执行层K线缺失/
    );
});
