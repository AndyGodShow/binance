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
}

interface ActivePosition {
    trade: CandidateTrade;
    allocatedCapital: number;
}

function computeMetrics(
    executedTrades: Trade[],
    equityCurve: EquityPoint[],
    initialCapital: number,
    maxDrawdown: number
) {
    const totalTrades = executedTrades.length;
    const winningTrades = executedTrades.filter((trade) => trade.profit > 0).length;
    const losingTrades = executedTrades.filter((trade) => trade.profit < 0).length;
    const winRate = totalTrades > 0 ? (winningTrades / totalTrades) * 100 : 0;

    const totalProfitUSDT = executedTrades.reduce((sum, trade) => sum + trade.profitUSDT, 0);
    const totalProfit = initialCapital > 0 ? (totalProfitUSDT / initialCapital) * 100 : 0;

    const averageProfit = totalTrades > 0 ? totalProfit / totalTrades : 0;
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

    const returns = executedTrades.map((trade) => trade.profit);
    const avgReturn = totalTrades > 0 ? returns.reduce((sum, value) => sum + value, 0) / totalTrades : 0;
    const variance = totalTrades > 0
        ? returns.reduce((sum, value) => sum + Math.pow(value - avgReturn, 2), 0) / totalTrades
        : 0;
    const stdDev = Math.sqrt(variance);
    const sharpeRatio = stdDev > 0 ? (avgReturn / stdDev) * Math.sqrt(252) : 0;

    const downsideReturns = returns.filter((value) => value < 0);
    const downsideVariance = downsideReturns.length > 0
        ? downsideReturns.reduce((sum, value) => sum + value * value, 0) / downsideReturns.length
        : 0;
    const downsideDeviation = Math.sqrt(downsideVariance);
    const sortinoRatio = downsideDeviation > 0 ? (avgReturn / downsideDeviation) * Math.sqrt(252) : 0;

    const startTime = equityCurve[0]?.time ?? 0;
    const endTime = equityCurve[equityCurve.length - 1]?.time ?? startTime;
    const tradingDays = Math.max(1, (endTime - startTime) / (24 * 60 * 60 * 1000));
    const annualizedReturn = totalProfit * (252 / tradingDays);
    const calmarRatio = maxDrawdown > 0 ? annualizedReturn / maxDrawdown : 0;
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
        const equity = cash + activePositions.reduce((sum, position) => sum + position.allocatedCapital, 0);
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

    const metrics = computeMetrics(executedTrades, equityCurve, config.initialCapital, maxDrawdown);
    const finalCapital = cash;

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
