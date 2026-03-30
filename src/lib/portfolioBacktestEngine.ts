import { BacktestResult, EquityPoint, Trade } from './backtestEngine';

export interface PortfolioBacktestConfig {
    initialCapital: number;
    maxConcurrentPositions: number;
    positionSizePercent: number;
}

export interface PortfolioBacktestResult {
    initialCapital: number;
    finalCapital: number;
    totalProfit: number;
    totalProfitUSDT: number;
    totalTrades: number;
    executedTrades: number;
    skippedTrades: number;
    activeSymbols: number;
    maxConcurrentPositionsUsed: number;
    winningTrades: number;
    losingTrades: number;
    winRate: number;
    averageProfit: number;
    averageWin: number;
    averageLoss: number;
    largestWin: number;
    largestLoss: number;
    maxDrawdown: number;
    sharpeRatio: number;
    profitFactor: number;
    sortinoRatio: number;
    calmarRatio: number;
    expectancy: number;
    recoveryFactor: number;
    maxConsecutiveWins: number;
    maxConsecutiveLosses: number;
    averageHoldingTime: number;
    maxHoldingTime: number;
    minHoldingTime: number;
    equityCurve: EquityPoint[];
    trades: Trade[];
}

interface CandidateTrade extends Trade {
    symbol: string;
    equityCurve: EquityPoint[];
    entryBaselineEquity: number;
}

interface ActivePosition {
    trade: CandidateTrade;
    allocatedCapital: number;
}

function findEquityAtOrBefore(curve: EquityPoint[], timestamp: number): number | null {
    if (curve.length === 0) {
        return null;
    }

    let left = 0;
    let right = curve.length - 1;
    let result = -1;

    while (left <= right) {
        const mid = Math.floor((left + right) / 2);
        if (curve[mid].time <= timestamp) {
            result = mid;
            left = mid + 1;
        } else {
            right = mid - 1;
        }
    }

    return result >= 0 ? curve[result].equity : null;
}

function interpolateEquity(curve: EquityPoint[], timestamp: number): number | null {
    if (curve.length === 0) {
        return null;
    }

    if (timestamp <= curve[0].time) {
        return curve[0].equity;
    }

    const lastPoint = curve[curve.length - 1];
    if (timestamp >= lastPoint.time) {
        return lastPoint.equity;
    }

    let left = 0;
    let right = curve.length - 1;

    while (left <= right) {
        const mid = Math.floor((left + right) / 2);
        const point = curve[mid];

        if (point.time === timestamp) {
            return point.equity;
        }

        if (point.time < timestamp) {
            left = mid + 1;
        } else {
            right = mid - 1;
        }
    }

    const prevPoint = curve[Math.max(0, right)];
    const nextPoint = curve[Math.min(curve.length - 1, left)];
    if (!prevPoint || !nextPoint || nextPoint.time === prevPoint.time) {
        return prevPoint?.equity ?? nextPoint?.equity ?? null;
    }

    const progress = (timestamp - prevPoint.time) / (nextPoint.time - prevPoint.time);
    return prevPoint.equity + (nextPoint.equity - prevPoint.equity) * progress;
}

function getMarkedPositionValue(position: ActivePosition, timestamp: number): number {
    if (timestamp <= position.trade.entryTime) {
        return position.allocatedCapital;
    }

    const sampleTime = Math.min(timestamp, position.trade.exitTime);
    const sampledEquity = interpolateEquity(position.trade.equityCurve, sampleTime);
    const baselineEquity = position.trade.entryBaselineEquity;

    if (
        sampledEquity !== null &&
        Number.isFinite(sampledEquity) &&
        Number.isFinite(baselineEquity) &&
        baselineEquity > 0
    ) {
        return position.allocatedCapital * (sampledEquity / baselineEquity);
    }

    const duration = Math.max(1, position.trade.exitTime - position.trade.entryTime);
    const elapsed = Math.max(0, Math.min(sampleTime - position.trade.entryTime, duration));
    const progress = elapsed / duration;
    return position.allocatedCapital * (1 + (position.trade.profit * progress) / 100);
}

function computeMetrics(
    executedTrades: Trade[],
    equityCurve: EquityPoint[],
    initialCapital: number,
    finalCapital: number,
    maxDrawdown: number
) {
    const totalTrades = executedTrades.length;
    const winningTrades = executedTrades.filter((trade) => trade.profit > 0).length;
    const losingTrades = executedTrades.filter((trade) => trade.profit < 0).length;
    const winRate = totalTrades > 0 ? (winningTrades / totalTrades) * 100 : 0;

    const totalProfitUSDT = finalCapital - initialCapital;
    const totalProfit = initialCapital > 0 ? (totalProfitUSDT / initialCapital) * 100 : 0;

    const averageProfit = totalTrades > 0
        ? executedTrades.reduce((sum, trade) => sum + trade.profit, 0) / totalTrades
        : 0;
    const wins = executedTrades.filter((trade) => trade.profit > 0);
    const losses = executedTrades.filter((trade) => trade.profit < 0);
    const averageWin = wins.length > 0 ? wins.reduce((sum, trade) => sum + trade.profit, 0) / wins.length : 0;
    const averageLoss = losses.length > 0 ? losses.reduce((sum, trade) => sum + trade.profit, 0) / losses.length : 0;
    const largestWin = wins.length > 0 ? Math.max(...wins.map((trade) => trade.profit)) : 0;
    const largestLoss = losses.length > 0 ? Math.min(...losses.map((trade) => trade.profit)) : 0;

    const totalWin = wins.reduce((sum, trade) => sum + trade.profitUSDT, 0);
    const totalLoss = Math.abs(losses.reduce((sum, trade) => sum + trade.profitUSDT, 0));
    const profitFactor = totalLoss > 0
        ? totalWin / totalLoss
        : totalWin > 0
            ? Number.POSITIVE_INFINITY
            : 0;

    const yearMs = 365.25 * 24 * 60 * 60 * 1000;
    const durationMs = Math.max(1, (equityCurve[equityCurve.length - 1]?.time ?? 0) - (equityCurve[0]?.time ?? 0));
    const equityReturns = equityCurve
        .slice(1)
        .map((point, index) => {
            const previous = equityCurve[index]?.equity ?? 100;
            return previous > 0 ? (point.equity - previous) / previous : 0;
        })
        .filter((value) => Number.isFinite(value));
    const avgReturn = equityReturns.length > 0
        ? equityReturns.reduce((sum, value) => sum + value, 0) / equityReturns.length
        : 0;
    const variance = equityReturns.length > 0
        ? equityReturns.reduce((sum, value) => sum + Math.pow(value - avgReturn, 2), 0) / equityReturns.length
        : 0;
    const stdDev = Math.sqrt(variance);
    const observationsPerYear = equityReturns.length > 1
        ? (equityReturns.length / durationMs) * yearMs
        : 0;
    const sharpeRatio = stdDev > 0 && observationsPerYear > 0
        ? (avgReturn / stdDev) * Math.sqrt(observationsPerYear)
        : 0;

    const downsideReturns = equityReturns.filter((value) => value < 0);
    const downsideVariance = downsideReturns.length > 0
        ? downsideReturns.reduce((sum, value) => sum + value * value, 0) / downsideReturns.length
        : 0;
    const downsideDeviation = Math.sqrt(downsideVariance);
    const sortinoRatio = downsideDeviation > 0 && observationsPerYear > 0
        ? (avgReturn / downsideDeviation) * Math.sqrt(observationsPerYear)
        : 0;

    const startTime = equityCurve[0]?.time ?? 0;
    const endTime = equityCurve[equityCurve.length - 1]?.time ?? startTime;
    const annualizedReturn = initialCapital > 0 && finalCapital > 0
        ? Math.pow(finalCapital / initialCapital, yearMs / Math.max(1, endTime - startTime)) - 1
        : -1;
    const calmarRatio = maxDrawdown > 0 ? annualizedReturn / (maxDrawdown / 100) : 0;
    const expectancy = totalTrades > 0
        ? (winRate / 100) * averageWin + ((100 - winRate) / 100) * averageLoss
        : 0;
    const recoveryFactor = maxDrawdown > 0 ? totalProfit / maxDrawdown : 0;

    let maxConsecutiveWins = 0;
    let maxConsecutiveLosses = 0;
    let winStreak = 0;
    let lossStreak = 0;

    executedTrades.forEach((trade) => {
        if (trade.profit > 0) {
            winStreak += 1;
            lossStreak = 0;
            maxConsecutiveWins = Math.max(maxConsecutiveWins, winStreak);
        } else if (trade.profit < 0) {
            lossStreak += 1;
            winStreak = 0;
            maxConsecutiveLosses = Math.max(maxConsecutiveLosses, lossStreak);
        }
    });

    const holdingTimes = executedTrades.map((trade) => trade.holdingTime);
    const averageHoldingTime = holdingTimes.length > 0
        ? holdingTimes.reduce((sum, value) => sum + value, 0) / holdingTimes.length
        : 0;
    const maxHoldingTime = holdingTimes.length > 0 ? Math.max(...holdingTimes) : 0;
    const minHoldingTime = holdingTimes.length > 0 ? Math.min(...holdingTimes) : 0;

    return {
        totalProfit,
        totalProfitUSDT,
        totalTrades,
        winningTrades,
        losingTrades,
        winRate,
        averageProfit,
        averageWin,
        averageLoss,
        largestWin,
        largestLoss,
        sharpeRatio,
        profitFactor,
        sortinoRatio,
        calmarRatio,
        expectancy,
        recoveryFactor,
        maxConsecutiveWins,
        maxConsecutiveLosses,
        averageHoldingTime,
        maxHoldingTime,
        minHoldingTime,
    };
}

export function runPortfolioBacktest(
    runs: Array<{ symbol: string; result: BacktestResult }>,
    config: PortfolioBacktestConfig
): PortfolioBacktestResult {
    const candidateTrades: CandidateTrade[] = runs
        .flatMap((run) =>
            run.result.trades.map((trade) => ({
                ...trade,
                symbol: trade.symbol || run.symbol,
                equityCurve: run.result.equityCurve,
                entryBaselineEquity: findEquityAtOrBefore(run.result.equityCurve, trade.entryTime) ?? 100,
            }))
        )
        .sort((a, b) => {
            if (a.entryTime !== b.entryTime) return a.entryTime - b.entryTime;
            if (a.exitTime !== b.exitTime) return a.exitTime - b.exitTime;
            return a.symbol.localeCompare(b.symbol);
        });

    let cash = config.initialCapital;
    let peakEquity = config.initialCapital;
    let maxDrawdown = 0;
    let skippedTrades = 0;
    let maxConcurrentPositionsUsed = 0;

    const activePositions: ActivePosition[] = [];
    const executedTrades: Trade[] = [];
    const tradedSymbols = new Set<string>();
    const equityCurve: EquityPoint[] = [];

    const pushEquityPoint = (time: number) => {
        const equity = cash + activePositions.reduce((sum, position) => sum + getMarkedPositionValue(position, time), 0);
        peakEquity = Math.max(peakEquity, equity);
        const drawdown = peakEquity > 0 ? ((peakEquity - equity) / peakEquity) * 100 : 0;
        maxDrawdown = Math.max(maxDrawdown, drawdown);

        equityCurve.push({
            time,
            equity: config.initialCapital > 0 ? (equity / config.initialCapital) * 100 : 0,
            drawdown,
        });
    };

    const settlePositionsUpTo = (timestamp: number) => {
        activePositions.sort((a, b) => a.trade.exitTime - b.trade.exitTime);

        let index = 0;
        while (index < activePositions.length) {
            const position = activePositions[index];
            if (position.trade.exitTime > timestamp) {
                index += 1;
                continue;
            }

            activePositions.splice(index, 1);
            const realizedProfitUSDT = position.allocatedCapital * (position.trade.profit / 100);
            cash += position.allocatedCapital + realizedProfitUSDT;
            executedTrades.push({
                ...position.trade,
                profitUSDT: realizedProfitUSDT,
                size: position.allocatedCapital / config.initialCapital,
            });
            pushEquityPoint(position.trade.exitTime);
        }
    };

    candidateTrades.forEach((trade) => {
        settlePositionsUpTo(trade.entryTime);

        const hasOpenSymbol = activePositions.some((position) => position.trade.symbol === trade.symbol);
        if (hasOpenSymbol || activePositions.length >= config.maxConcurrentPositions) {
            skippedTrades += 1;
            return;
        }

        const totalEquity = cash + activePositions.reduce((sum, position) => sum + position.allocatedCapital, 0);
        const targetAllocation = totalEquity * (config.positionSizePercent / 100);
        const allocatedCapital = Math.min(cash, targetAllocation);

        if (allocatedCapital <= 0) {
            skippedTrades += 1;
            return;
        }

        cash -= allocatedCapital;
        activePositions.push({
            trade,
            allocatedCapital,
        });
        maxConcurrentPositionsUsed = Math.max(maxConcurrentPositionsUsed, activePositions.length);
        tradedSymbols.add(trade.symbol);
        pushEquityPoint(trade.entryTime);
    });

    settlePositionsUpTo(Number.POSITIVE_INFINITY);

    if (equityCurve.length === 0) {
        pushEquityPoint(Date.now());
    }

    const finalCapital = cash;
    const metrics = computeMetrics(executedTrades, equityCurve, config.initialCapital, finalCapital, maxDrawdown);

    return {
        initialCapital: config.initialCapital,
        finalCapital,
        totalProfit: metrics.totalProfit,
        totalProfitUSDT: metrics.totalProfitUSDT,
        totalTrades: candidateTrades.length,
        executedTrades: executedTrades.length,
        skippedTrades,
        activeSymbols: tradedSymbols.size,
        maxConcurrentPositionsUsed,
        winningTrades: metrics.winningTrades,
        losingTrades: metrics.losingTrades,
        winRate: metrics.winRate,
        averageProfit: metrics.averageProfit,
        averageWin: metrics.averageWin,
        averageLoss: metrics.averageLoss,
        largestWin: metrics.largestWin,
        largestLoss: metrics.largestLoss,
        maxDrawdown,
        sharpeRatio: metrics.sharpeRatio,
        profitFactor: metrics.profitFactor,
        sortinoRatio: metrics.sortinoRatio,
        calmarRatio: metrics.calmarRatio,
        expectancy: metrics.expectancy,
        recoveryFactor: metrics.recoveryFactor,
        maxConsecutiveWins: metrics.maxConsecutiveWins,
        maxConsecutiveLosses: metrics.maxConsecutiveLosses,
        averageHoldingTime: metrics.averageHoldingTime,
        maxHoldingTime: metrics.maxHoldingTime,
        minHoldingTime: metrics.minHoldingTime,
        equityCurve,
        trades: executedTrades,
    };
}
