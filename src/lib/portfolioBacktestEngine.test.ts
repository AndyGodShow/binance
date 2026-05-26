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

function createBacktestResultWithEquityCurve(
    symbol: string,
    trades: Trade[],
    equityCurve: BacktestResult['equityCurve'],
): BacktestResult {
    return {
        ...createBacktestResult(symbol, trades),
        equityCurve,
    };
}

function createBacktestResultWithLegs(symbol: string, trades: Trade[], tradeLegs: Trade[]): BacktestResult {
    return {
        ...createBacktestResult(symbol, trades),
        tradeLegs,
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

test('runPortfolioBacktest blocks entries above maxConcurrentPositions and reports skip reason', () => {
    const start = Date.UTC(2025, 1, 1);
    const runs = [
        { symbol: 'BTCUSDT', result: createBacktestResult('BTCUSDT', [createTrade('BTCUSDT', start, start + (3 * HOUR_MS), 5, 0.5)]) },
        { symbol: 'ETHUSDT', result: createBacktestResult('ETHUSDT', [createTrade('ETHUSDT', start + HOUR_MS, start + (2 * HOUR_MS), 4, 0.5)]) },
    ];

    const result = runPortfolioBacktest(runs, {
        initialCapital: 10_000,
        maxConcurrentPositions: 1,
        positionSizePercent: 50,
    });

    assert.equal(result.executedTrades, 1);
    assert.equal(result.skippedTrades, 1);
    assert.deepEqual(result.trades.map((trade) => trade.symbol), ['BTCUSDT']);
    assert.equal(result.diagnostics?.skipReasons.maxConcurrentPositions, 1);
});

test('runPortfolioBacktest skips a same-symbol entry while the symbol is already open', () => {
    const start = Date.UTC(2025, 1, 2);
    const trades = [
        createTrade('BTCUSDT', start, start + (3 * HOUR_MS), 5, 0.4),
        createTrade('BTCUSDT', start + HOUR_MS, start + (2 * HOUR_MS), 7, 0.4),
    ];

    const result = runPortfolioBacktest([
        { symbol: 'BTCUSDT', result: createBacktestResult('BTCUSDT', trades) },
    ], {
        initialCapital: 10_000,
        maxConcurrentPositions: 3,
        positionSizePercent: 40,
    });

    assert.equal(result.executedTrades, 1);
    assert.equal(result.skippedTrades, 1);
    assert.deepEqual(result.trades.map((trade) => trade.entryTime), [start]);
    assert.equal(result.diagnostics?.skipReasons.sameSymbolOpen, 1);
});

test('runPortfolioBacktest excludes skipped trades from portfolio trades, equity curve, and metrics', () => {
    const start = Date.UTC(2025, 1, 3);
    const runs = [
        { symbol: 'BTCUSDT', result: createBacktestResult('BTCUSDT', [createTrade('BTCUSDT', start, start + (3 * HOUR_MS), 10, 1)]) },
        { symbol: 'ETHUSDT', result: createBacktestResult('ETHUSDT', [createTrade('ETHUSDT', start + HOUR_MS, start + (2 * HOUR_MS), -80, 1)]) },
    ];

    const result = runPortfolioBacktest(runs, {
        initialCapital: 10_000,
        maxConcurrentPositions: 1,
        positionSizePercent: 100,
    });

    assert.equal(result.executedTrades, 1);
    assert.equal(result.skippedTrades, 1);
    assert.equal(result.finalCapital, 11_000);
    assert.equal(result.totalProfitUSDT, 1_000);
    assert.equal(result.losingTrades, 0);
    assert.deepEqual(result.trades.map((trade) => trade.symbol), ['BTCUSDT']);
    assert.ok(result.equityCurve.every((point) => point.equity >= 100));
});

test('runPortfolioBacktest does not let skipped wei-shen losses trigger cooldown', () => {
    const start = Date.UTC(2025, 1, 4);
    const runs = [
        { symbol: 'BTCUSDT', result: createBacktestResult('BTCUSDT', [createTrade('BTCUSDT', start, start + (3 * HOUR_MS), 2, 0.5, 0.5)]) },
        { symbol: 'XRPUSDT', result: createBacktestResult('XRPUSDT', [createTrade('XRPUSDT', start + HOUR_MS, start + (2 * HOUR_MS), -5, 0.5, 0.5)]) },
        { symbol: 'ADAUSDT', result: createBacktestResult('ADAUSDT', [createTrade('ADAUSDT', start + (4 * HOUR_MS), start + (5 * HOUR_MS), 4, 0.5, 0.5)]) },
    ];

    const result = runPortfolioBacktest(runs, {
        initialCapital: 10_000,
        maxConcurrentPositions: 1,
        positionSizePercent: 50,
        strategyId: 'wei-shen-ledger',
        parameterOverrides: {
            'wei-shen-ledger': {
                risk: {
                    maxConsecutiveLossesBeforeCooldown: 1,
                },
            },
        },
    });

    assert.equal(result.executedTrades, 2);
    assert.equal(result.skippedTrades, 1);
    assert.deepEqual(result.trades.map((trade) => trade.symbol), ['BTCUSDT', 'ADAUSDT']);
    assert.equal(result.diagnostics?.skipReasons.maxConcurrentPositions, 1);
    assert.equal(result.diagnostics?.skipReasons.weiShenCooldown ?? 0, 0);
});

test('runPortfolioBacktest stops new entries after global max drawdown breach', () => {
    const start = Date.UTC(2025, 1, 5);
    const runs = [
        { symbol: 'BTCUSDT', result: createBacktestResult('BTCUSDT', [createTrade('BTCUSDT', start, start + HOUR_MS, -10, 1)]) },
        { symbol: 'ETHUSDT', result: createBacktestResult('ETHUSDT', [createTrade('ETHUSDT', start + (2 * HOUR_MS), start + (3 * HOUR_MS), 20, 1)]) },
    ];

    const result = runPortfolioBacktest(runs, {
        initialCapital: 10_000,
        maxConcurrentPositions: 2,
        positionSizePercent: 100,
        maxDrawdownPct: 5,
    } as Parameters<typeof runPortfolioBacktest>[1] & { maxDrawdownPct: number });

    assert.equal(result.executedTrades, 1);
    assert.equal(result.skippedTrades, 1);
    assert.deepEqual(result.trades.map((trade) => trade.symbol), ['BTCUSDT']);
    assert.equal(result.diagnostics?.skipReasons.maxDrawdown, 1);
});

test('runPortfolioBacktest uses stable ordering for same-timestamp candidates', () => {
    const start = Date.UTC(2025, 1, 6);
    const runs = [
        { symbol: 'SOLUSDT', result: createBacktestResult('SOLUSDT', [createTrade('SOLUSDT', start, start + HOUR_MS, 3, 0.25)]) },
        { symbol: 'ADAUSDT', result: createBacktestResult('ADAUSDT', [createTrade('ADAUSDT', start, start + HOUR_MS, 3, 0.25)]) },
        { symbol: 'BTCUSDT', result: createBacktestResult('BTCUSDT', [createTrade('BTCUSDT', start, start + HOUR_MS, 3, 0.25)]) },
    ];

    const result = runPortfolioBacktest(runs, {
        initialCapital: 10_000,
        maxConcurrentPositions: 3,
        positionSizePercent: 25,
    });

    assert.deepEqual(result.trades.map((trade) => trade.symbol), ['ADAUSDT', 'BTCUSDT', 'SOLUSDT']);
});

test('runPortfolioBacktest recalculates profitUSDT, size, and finalCapital from actual allocated capital', () => {
    const start = Date.UTC(2025, 1, 7);
    const runs = [
        { symbol: 'BTCUSDT', result: createBacktestResult('BTCUSDT', [createTrade('BTCUSDT', start, start + HOUR_MS, 10, 0.8)]) },
        { symbol: 'ETHUSDT', result: createBacktestResult('ETHUSDT', [createTrade('ETHUSDT', start, start + HOUR_MS, 20, 0.8)]) },
    ];

    const result = runPortfolioBacktest(runs, {
        initialCapital: 10_000,
        maxConcurrentPositions: 2,
        positionSizePercent: 80,
    });

    assert.equal(result.executedTrades, 2);
    assert.equal(result.trades[0]?.symbol, 'BTCUSDT');
    assert.equal(result.trades[0]?.profitUSDT, 800);
    assert.equal(result.trades[0]?.size, 0.8);
    assert.equal(result.trades[1]?.symbol, 'ETHUSDT');
    assert.equal(result.trades[1]?.profitUSDT, 400);
    assert.equal(result.trades[1]?.size, 0.2);
    assert.equal(result.finalCapital, 11_200);
});

test('runPortfolioBacktest samples open positions between trade boundaries for drawdown', () => {
    const start = Date.UTC(2025, 1, 8);
    const mid = start + HOUR_MS;
    const exit = start + (2 * HOUR_MS);
    const trade = createTrade('BTCUSDT', start, exit, 0, 1);

    const result = runPortfolioBacktest([
        {
            symbol: 'BTCUSDT',
            result: createBacktestResultWithEquityCurve('BTCUSDT', [trade], [
                { time: start, equity: 100, drawdown: 0 },
                { time: mid, equity: 80, drawdown: 20 },
                { time: exit, equity: 100, drawdown: 0 },
            ]),
        },
    ], {
        initialCapital: 10_000,
        maxConcurrentPositions: 1,
        positionSizePercent: 100,
    });

    assert.equal(result.finalCapital, 10_000);
    assert.equal(result.maxDrawdown, 20);
    assert.ok(result.equityCurve.some((point) => point.time === mid && point.equity === 80));
});

test('runPortfolioBacktest releases partial exit capital before later entries', () => {
    const start = Date.UTC(2025, 1, 9);
    const partialExit = start + HOUR_MS;
    const nextEntry = start + (2 * HOUR_MS);
    const finalExit = start + (4 * HOUR_MS);
    const btcAggregate = createTrade('BTCUSDT', start, finalExit, 5, 1);
    const btcFirstLeg = createTrade('BTCUSDT', start, partialExit, 10, 0.5);
    const btcFinalLeg = createTrade('BTCUSDT', start, finalExit, 0, 0.5);
    const ethTrade = createTrade('ETHUSDT', nextEntry, nextEntry + HOUR_MS, 4, 1);

    const result = runPortfolioBacktest([
        {
            symbol: 'BTCUSDT',
            result: createBacktestResultWithLegs('BTCUSDT', [btcAggregate], [btcFirstLeg, btcFinalLeg]),
        },
        {
            symbol: 'ETHUSDT',
            result: createBacktestResult('ETHUSDT', [ethTrade]),
        },
    ], {
        initialCapital: 10_000,
        maxConcurrentPositions: 2,
        positionSizePercent: 100,
    });

    assert.equal(result.executedTrades, 2);
    assert.equal(result.skippedTrades, 0);
    assert.deepEqual(result.trades.map((trade) => trade.symbol), ['ETHUSDT', 'BTCUSDT']);
    assert.equal(result.finalCapital, 10_720);
});

test('runPortfolioBacktest does not expose internal candidate fields on output trades', () => {
    const start = Date.UTC(2025, 1, 10);
    const trade = createTrade('BTCUSDT', start, start + HOUR_MS, 3, 0.5);

    const result = runPortfolioBacktest([
        { symbol: 'BTCUSDT', result: createBacktestResult('BTCUSDT', [trade]) },
    ], {
        initialCapital: 10_000,
        maxConcurrentPositions: 1,
        positionSizePercent: 50,
    });

    assert.equal(Object.hasOwn(result.trades[0], 'equityCurve'), false);
    assert.equal(Object.hasOwn(result.trades[0], 'entryBaselineEquity'), false);
    assert.equal(Object.hasOwn(result.trades[0], 'settlementLegs'), false);
});
