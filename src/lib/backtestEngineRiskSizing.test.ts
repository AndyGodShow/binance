import assert from 'node:assert/strict';
import test from 'node:test';

import type { KlineData } from '@/app/api/backtest/klines/route';
import { BacktestEngine } from './backtestEngine.ts';

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

test('BacktestEngine ignores repeated same-direction signals while a position is open', async () => {
    const signalKlines = Array.from({ length: 55 }, (_, index) => createKline(index, 100, 102, 99, 101));
    const signalTimes = new Set([
        signalKlines[50].closeTime,
        signalKlines[51].closeTime,
        signalKlines[52].closeTime,
    ]);

    const engine = new BacktestEngine({
        initialCapital: 10_000,
        commission: 0,
        slippage: 0,
        useStrategyRiskManagement: false,
    });

    const result = await engine.run({
        signalKlines,
        strategyName: 'Repeated long signals',
        symbol: 'BTCUSDT',
        signalInterval: '1h',
        strategyDetector: (ticker) => ({
            signal: signalTimes.has(ticker.closeTime) ? 'long' : null,
            confidence: 90,
        }),
    });

    assert.equal(result.trades.length, 1);
    assert.equal(result.trades[0].direction, 'long');
    assert.equal(result.trades[0].entryTime, signalKlines[51].openTime);
    assert.equal(result.trades[0].exitReason, 'end_of_data');
});

test('BacktestEngine reverses an opposite signal by closing and opening at the next execution open', async () => {
    const signalKlines = Array.from({ length: 55 }, (_, index) => {
        if (index === 52) {
            return createKline(index, 105, 106, 100, 101);
        }

        return createKline(index, 100, 105, 99, 104);
    });

    const longSignalTime = signalKlines[50].closeTime;
    const shortSignalTime = signalKlines[51].closeTime;
    const engine = new BacktestEngine({
        initialCapital: 10_000,
        commission: 0,
        slippage: 0,
        useStrategyRiskManagement: false,
    });

    const result = await engine.run({
        signalKlines,
        strategyName: 'Opposite signal reversal',
        symbol: 'BTCUSDT',
        signalInterval: '1h',
        strategyDetector: (ticker) => {
            if (ticker.closeTime === longSignalTime) {
                return { signal: 'long', confidence: 90 };
            }
            if (ticker.closeTime === shortSignalTime) {
                return { signal: 'short', confidence: 90 };
            }

            return null;
        },
    });

    assert.equal(result.trades.length, 2);
    assert.equal(result.trades[0].direction, 'long');
    assert.equal(result.trades[0].exitReason, 'signal');
    assert.equal(result.trades[0].exitTime, signalKlines[52].openTime);
    assert.equal(result.trades[0].exitPrice, 105);
    assert.equal(result.trades[1].direction, 'short');
    assert.equal(result.trades[1].entryTime, signalKlines[52].openTime);
    assert.equal(result.trades[1].entryPrice, 105);
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

test('BacktestEngine records auditable quantity, margin, fee, slippage, funding, and pnl fields', async () => {
    const signalKlines = Array.from({ length: 54 }, (_, index) => {
        if (index === 52) {
            return {
                ...createKline(index, 110, 111, 109, 110),
                fundingRate: '0.001',
            };
        }

        return createKline(index, 100, 101, 99, 100);
    });

    const engine = new BacktestEngine({
        initialCapital: 10_000,
        commission: 0.04,
        slippage: 0.05,
        useStrategyRiskManagement: true,
    });

    const signalBarTime = signalKlines[50].closeTime;
    const result = await engine.run({
        signalKlines,
        strategyName: 'Auditable settlement',
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
                        price: 90,
                        percentage: 10,
                        type: 'fixed',
                        reason: 'test stop',
                    },
                    takeProfit: {
                        targets: [
                            {
                                price: 110,
                                percentage: 10,
                                closePercentage: 100,
                                reason: 'test target',
                            },
                        ],
                        riskRewardRatio: 1,
                    },
                    positionSizing: {
                        percentage: 50,
                        leverage: 2,
                        maxRiskAmount: 500,
                        confidence: 90,
                        reasoning: 'half margin, 2x notional',
                    },
                    metrics: {
                        entryPrice: 100,
                        riskAmount: 500,
                        potentialProfit: 1000,
                    },
                },
            };
        },
    });

    assert.equal(result.trades.length, 1);
    const trade = result.trades[0] as typeof result.trades[number] & {
        qty?: number;
        margin?: number;
        notional?: number;
        fee?: number;
        slippageCost?: number;
        funding?: number;
        pnl?: number;
        pnlPct?: number;
    };

    assert.equal(trade.margin, 5_000);
    assert.equal(trade.notional, 10_000);
    assert.equal(trade.qty, 100);
    assert.ok(typeof trade.fee === 'number' && trade.fee > 0);
    assert.ok(typeof trade.slippageCost === 'number' && trade.slippageCost > 0);
    assert.ok(typeof trade.funding === 'number' && trade.funding < 0);
    assert.ok(typeof trade.pnl === 'number' && trade.pnl > 0);
    assert.ok(typeof trade.pnlPct === 'number' && trade.pnlPct > 0);
});

test('BacktestEngine includes funding cashflow in realized pnl for long positions', async () => {
    const signalKlines = Array.from({ length: 54 }, (_, index) => {
        if (index === 52) {
            return {
                ...createKline(index, 110, 111, 99, 110),
                fundingRate: '0.001',
            };
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
        strategyName: 'Funding settlement',
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
                        price: 90,
                        percentage: 10,
                        type: 'fixed',
                        reason: 'test stop',
                    },
                    takeProfit: {
                        targets: [
                            {
                                price: 110,
                                percentage: 10,
                                closePercentage: 100,
                                reason: 'test target',
                            },
                        ],
                        riskRewardRatio: 1,
                    },
                    positionSizing: {
                        percentage: 50,
                        leverage: 2,
                        maxRiskAmount: 500,
                        confidence: 90,
                        reasoning: 'half margin, 2x notional',
                    },
                    metrics: {
                        entryPrice: 100,
                        riskAmount: 500,
                        potentialProfit: 1000,
                    },
                },
            };
        },
    });

    const trade = result.trades[0] as typeof result.trades[number] & {
        funding?: number;
        pnl?: number;
        pnlPct?: number;
    };

    assert.equal(trade.funding, -10);
    assert.ok(Math.abs((trade.pnl ?? 0) - 990) < 0.000001);
    assert.ok(Math.abs((trade.pnlPct ?? 0) - 19.8) < 0.000001);
    assert.ok(Math.abs(result.totalProfitUSDT - 990) < 0.000001);
});

test('BacktestEngine charges funding only on exact funding timestamps', async () => {
    const signalKlines = Array.from({ length: 56 }, (_, index) => {
        if (index >= 51 && index <= 53) {
            return createKline(index, 100, 101, 99, 100, {
                fundingRate: '0.001',
                fundingRateSource: index === 52 ? 'exact' : 'forward-fill',
            });
        }
        if (index === 54) {
            return createKline(index, 110, 111, 99, 110, {
                fundingRate: '0.001',
                fundingRateSource: 'forward-fill',
            });
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
        strategyName: 'Exact funding only',
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
                        price: 90,
                        percentage: 10,
                        type: 'fixed',
                        reason: 'test stop',
                    },
                    takeProfit: {
                        targets: [
                            {
                                price: 110,
                                percentage: 10,
                                closePercentage: 100,
                                reason: 'test target',
                            },
                        ],
                        riskRewardRatio: 1,
                    },
                    positionSizing: {
                        percentage: 50,
                        leverage: 2,
                        maxRiskAmount: 500,
                        confidence: 90,
                        reasoning: 'half margin, 2x notional',
                    },
                    metrics: {
                        entryPrice: 100,
                        riskAmount: 500,
                        potentialProfit: 1000,
                    },
                },
            };
        },
    });

    assert.equal(result.trades[0]?.funding, -10);
    assert.ok(Math.abs(result.totalProfitUSDT - 990) < 0.000001);
});

test('BacktestEngine does not tighten a trailing stop from the same execution bar high', async () => {
    const signalKlines = Array.from({ length: 55 }, (_, index) => {
        if (index === 51) {
            return createKline(index, 100, 120, 108, 110);
        }
        if (index === 52) {
            return createKline(index, 110, 111, 89, 90);
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
        strategyName: 'Trailing stop path guard',
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
                        price: 90,
                        percentage: 10,
                        type: 'trailing',
                        reason: 'trailing stop',
                    },
                    takeProfit: {
                        targets: [],
                        riskRewardRatio: 0,
                    },
                    positionSizing: {
                        percentage: 100,
                        leverage: 1,
                        maxRiskAmount: 1000,
                        confidence: 90,
                        reasoning: 'full size',
                    },
                    metrics: {
                        entryPrice: 100,
                        riskAmount: 1000,
                        potentialProfit: 0,
                    },
                },
            };
        },
    });

    assert.equal(result.trades[0]?.exitReason, 'stop_loss');
    assert.equal(result.trades[0]?.exitPrice, 108);
    assert.equal(result.trades[0]?.exitTime, signalKlines[52].closeTime);
});

test('BacktestEngine uses leverage to derive quantity and capital usage', async () => {
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
        strategyName: 'Leverage sizing',
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

    const trade = result.trades[0] as typeof result.trades[number] & {
        qty?: number;
        margin?: number;
        notional?: number;
        pnl?: number;
        pnlPct?: number;
    };

    assert.equal(trade.exitReason, 'end_of_data');
    assert.equal(trade.margin, 2_500);
    assert.equal(trade.notional, 10_000);
    assert.equal(trade.qty, 100);
    assert.equal(trade.pnl, 500);
    assert.equal(trade.pnlPct, 20);
});

test('BacktestEngine force-settles open positions at simulation end with exitReason end_of_data', async () => {
    const signalKlines = Array.from({ length: 53 }, (_, index) => {
        if (index === 52) {
            return createKline(index, 103, 104, 102, 103);
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
        strategyName: 'End of data settlement',
        symbol: 'SOLUSDT',
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
                        price: 90,
                        percentage: 10,
                        type: 'fixed',
                        reason: 'wide stop',
                    },
                    takeProfit: {
                        targets: [],
                        riskRewardRatio: 0,
                    },
                    positionSizing: {
                        percentage: 100,
                        leverage: 1,
                        maxRiskAmount: 1000,
                        confidence: 90,
                        reasoning: 'full spot-like margin',
                    },
                    metrics: {
                        entryPrice: 100,
                        riskAmount: 1000,
                        potentialProfit: 300,
                    },
                },
            };
        },
    });

    assert.equal(result.trades.length, 1);
    assert.equal(result.trades[0].exitReason, 'end_of_data');
    assert.equal(result.trades[0].exitTime, signalKlines[52].closeTime);
    assert.equal(result.trades[0].exitPrice, 103);
});
