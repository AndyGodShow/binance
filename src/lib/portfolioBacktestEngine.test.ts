import assert from 'node:assert/strict';
import test from 'node:test';

import type { BacktestResult, Trade } from './backtestEngine.ts';
import { runPortfolioBacktest } from './portfolioBacktestEngine.ts';

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

function createTrade(
    symbol: string,
    entryTime: number,
    exitTime: number,
    profit: number,
    size: number,
    strategyRiskPct: number = 0.6,
): Trade {
    return {
        symbol,
        entryTime,
        exitTime,
        entryPrice: 100,
        exitPrice: 100 * (1 + profit / 100),
        direction: 'long',
        size,
        profit,
        profitUSDT: profit,
        holdingTime: exitTime - entryTime,
        exitReason: profit >= 0 ? 'take_profit' : 'stop_loss',
        strategyRiskPct,
        plannedPositionPct: size * 100,
        stopLossPct: 3,
    };
}

function createBacktestResult(symbol: string, trades: Trade[]): BacktestResult {
    const firstTime = trades[0]?.entryTime ?? 0;
    const lastTime = trades[trades.length - 1]?.exitTime ?? firstTime;
    let runningEquity = 100;
    const equityCurve = trades.flatMap((trade) => {
        const startPoint = { time: trade.entryTime, equity: runningEquity, drawdown: 0 };
        runningEquity += trade.profit;
        const endPoint = { time: trade.exitTime, equity: runningEquity, drawdown: Math.max(0, 100 - runningEquity) };
        return [startPoint, endPoint];
    });

    return {
        symbol,
        interval: '1h',
        executionInterval: '15m',
        strategyName: '魏神策略',
        startTime: firstTime,
        endTime: lastTime,
        totalBars: 0,
        executionBarsProcessed: 0,
        totalTrades: trades.length,
        winningTrades: trades.filter((trade) => trade.profit > 0).length,
        losingTrades: trades.filter((trade) => trade.profit < 0).length,
        winRate: 0,
        totalProfit: trades.reduce((sum, trade) => sum + trade.profit, 0),
        totalProfitUSDT: trades.reduce((sum, trade) => sum + trade.profitUSDT, 0),
        averageProfit: 0,
        averageWin: 0,
        averageLoss: 0,
        largestWin: 0,
        largestLoss: 0,
        maxDrawdown: 0,
        sharpeRatio: 0,
        profitFactor: 0,
        sortinoRatio: 0,
        calmarRatio: 0,
        expectancy: 0,
        recoveryFactor: 0,
        maxConsecutiveWins: 0,
        maxConsecutiveLosses: 0,
        currentStreak: { type: 'loss', count: 0 },
        averageHoldingTime: 0,
        maxHoldingTime: 0,
        minHoldingTime: 0,
        trades,
        tradeLegs: trades,
        equityCurve: equityCurve.length > 0 ? equityCurve : [{ time: firstTime, equity: 100, drawdown: 0 }, { time: lastTime, equity: 100, drawdown: 0 }],
    };
}

test('runPortfolioBacktest applies wei-shen core cluster limits to BTC/ETH/SOL overlap', () => {
    const entryTime = Date.UTC(2025, 0, 1);
    const exitTime = entryTime + HOUR_MS;
    const runs = [
        { symbol: 'BTCUSDT', result: createBacktestResult('BTCUSDT', [createTrade('BTCUSDT', entryTime, exitTime, 5, 0.25, 0.75)]) },
        { symbol: 'ETHUSDT', result: createBacktestResult('ETHUSDT', [createTrade('ETHUSDT', entryTime, exitTime, 4, 0.25, 0.8)]) },
        { symbol: 'SOLUSDT', result: createBacktestResult('SOLUSDT', [createTrade('SOLUSDT', entryTime, exitTime, 6, 0.25, 0.5)]) },
    ];

    const result = runPortfolioBacktest(runs, {
        initialCapital: 10_000,
        maxConcurrentPositions: 3,
        positionSizePercent: 25,
        strategyId: 'wei-shen-ledger',
    });

    assert.equal(result.executedTrades, 2);
    assert.equal(result.skippedTrades, 1);
    assert.deepEqual(result.trades.map((trade) => trade.symbol), ['BTCUSDT', 'SOLUSDT']);
});

test('runPortfolioBacktest enforces wei-shen cooldown after three consecutive losses', () => {
    const start = Date.UTC(2025, 0, 1);
    const trades = [
        createTrade('XRPUSDT', start, start + HOUR_MS, -2, 0.18, 0.35),
        createTrade('XRPUSDT', start + DAY_MS, start + DAY_MS + HOUR_MS, -2, 0.18, 0.35),
        createTrade('XRPUSDT', start + (2 * DAY_MS), start + (2 * DAY_MS) + HOUR_MS, -2, 0.18, 0.35),
        createTrade('XRPUSDT', start + (2 * DAY_MS) + (12 * HOUR_MS), start + (2 * DAY_MS) + (13 * HOUR_MS), 5, 0.18, 0.35),
    ];

    const result = runPortfolioBacktest([
        { symbol: 'XRPUSDT', result: createBacktestResult('XRPUSDT', trades) },
    ], {
        initialCapital: 10_000,
        maxConcurrentPositions: 3,
        positionSizePercent: 18,
        strategyId: 'wei-shen-ledger',
    });

    assert.equal(result.executedTrades, 3);
    assert.equal(result.skippedTrades, 1);
});

test('runPortfolioBacktest stops opening new wei-shen trades after daily drawdown breach', () => {
    const start = Date.UTC(2025, 0, 1, 0, 0);
    const trades = [
        createTrade('BTCUSDT', start, start + HOUR_MS, -10, 0.25, 0.75),
        createTrade('ETHUSDT', start + (2 * HOUR_MS), start + (3 * HOUR_MS), 4, 0.2, 0.5),
    ];

    const result = runPortfolioBacktest([
        { symbol: 'BTCUSDT', result: createBacktestResult('BTCUSDT', [trades[0]]) },
        { symbol: 'ETHUSDT', result: createBacktestResult('ETHUSDT', [trades[1]]) },
    ], {
        initialCapital: 10_000,
        maxConcurrentPositions: 3,
        positionSizePercent: 25,
        strategyId: 'wei-shen-ledger',
    });

    assert.equal(result.executedTrades, 1);
    assert.equal(result.skippedTrades, 1);
});

test('runPortfolioBacktest reads actual signal risk instead of proxy allocation risk for wei-shen cluster caps', () => {
    const entryTime = Date.UTC(2025, 0, 2);
    const exitTime = entryTime + HOUR_MS;
    const runs = [
        { symbol: 'BTCUSDT', result: createBacktestResult('BTCUSDT', [createTrade('BTCUSDT', entryTime, exitTime, 2, 0.05, 0.8)]) },
        { symbol: 'ETHUSDT', result: createBacktestResult('ETHUSDT', [createTrade('ETHUSDT', entryTime, exitTime, 2, 0.05, 0.8)]) },
    ];

    const result = runPortfolioBacktest(runs, {
        initialCapital: 10_000,
        maxConcurrentPositions: 3,
        positionSizePercent: 5,
        strategyId: 'wei-shen-ledger',
    });

    assert.equal(result.executedTrades, 1);
    assert.equal(result.skippedTrades, 1);
    assert.equal(result.trades[0]?.symbol, 'BTCUSDT');
});

test('runPortfolioBacktest applies wei-shen parameter overrides to portfolio cooldown rules', () => {
    const start = Date.UTC(2025, 0, 1);
    const trades = [
        createTrade('XRPUSDT', start, start + HOUR_MS, -2, 0.18, 0.35),
        createTrade('XRPUSDT', start + DAY_MS, start + DAY_MS + HOUR_MS, 5, 0.18, 0.35),
    ];

    const result = runPortfolioBacktest([
        { symbol: 'XRPUSDT', result: createBacktestResult('XRPUSDT', trades) },
    ], {
        initialCapital: 10_000,
        maxConcurrentPositions: 3,
        positionSizePercent: 18,
        strategyId: 'wei-shen-ledger',
        parameterOverrides: {
            'wei-shen-ledger': {
                risk: {
                    maxConsecutiveLossesBeforeCooldown: 1,
                },
            },
        },
    });

    assert.equal(result.executedTrades, 1);
    assert.equal(result.skippedTrades, 1);
});
