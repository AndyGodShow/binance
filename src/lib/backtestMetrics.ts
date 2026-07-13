import type { BacktestResult, EquityPoint, Trade } from './backtestEngineTypes.ts';

function getIntervalMs(interval: string): number | null {
    const match = interval.match(/^(\d+)(m|h|d|w)$/);
    if (!match) return null;
    const value = Number.parseInt(match[1], 10);
    const multipliers = { m: 60_000, h: 3_600_000, d: 86_400_000, w: 604_800_000 };
    return value * multipliers[match[2] as keyof typeof multipliers];
}

export function calculateBacktestMetrics(
    initialCapital: number,
    trades: Trade[],
    tradeLegs: Trade[],
    equityCurve: EquityPoint[],
    maxDrawdown: number,
    symbol: string,
    interval: string,
    executionInterval: string,
    strategyName: string,
    startTime: number,
    endTime: number,
    totalBars: number,
    executionBarsProcessed: number
): BacktestResult {
    const totalTrades = trades.length;
    const winningTrades = trades.filter(t => t.profit > 0).length;
    const losingTrades = trades.filter(t => t.profit < 0).length;
    const winRate = totalTrades > 0 ? (winningTrades / totalTrades) * 100 : 0;

    const endingEquity = equityCurve[equityCurve.length - 1]?.equity ?? 100;
    const totalProfit = endingEquity - 100;
    const totalProfitUSDT = initialCapital * (totalProfit / 100);
    const averageProfit = totalTrades > 0
        ? trades.reduce((sum, trade) => sum + trade.profit, 0) / totalTrades
        : 0;

    const wins = trades.filter(t => t.profit > 0);
    const losses = trades.filter(t => t.profit < 0);
    const averageWin = wins.length > 0 ? wins.reduce((sum, t) => sum + t.profit, 0) / wins.length : 0;
    const averageLoss = losses.length > 0 ? losses.reduce((sum, t) => sum + t.profit, 0) / losses.length : 0;

    const largestWin = wins.length > 0 ? Math.max(...wins.map(t => t.profit)) : 0;
    const largestLoss = losses.length > 0 ? Math.min(...losses.map(t => t.profit)) : 0;

    const totalWin = wins.reduce((sum, t) => sum + t.profitUSDT, 0);
    const totalLoss = Math.abs(losses.reduce((sum, t) => sum + t.profitUSDT, 0));
    const profitFactor = totalLoss > 0
        ? totalWin / totalLoss
        : totalWin > 0
            ? Number.POSITIVE_INFINITY
            : 0;

    const intervalMs = getIntervalMs(interval);
    const yearMs = 365.25 * 24 * 60 * 60 * 1000;
    const barsPerYear = intervalMs ? yearMs / intervalMs : 365.25;
    const equityReturns = equityCurve.slice(1)
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
    const sharpeRatio = stdDev > 0 ? (avgReturn / stdDev) * Math.sqrt(barsPerYear) : 0;

    // 持仓时间统计
    const holdingTimes = trades.map(t => t.holdingTime);
    const averageHoldingTime = holdingTimes.length > 0 ? holdingTimes.reduce((a, b) => a + b, 0) / holdingTimes.length : 0;
    const maxHoldingTime = holdingTimes.length > 0 ? Math.max(...holdingTimes) : 0;
    const minHoldingTime = holdingTimes.length > 0 ? Math.min(...holdingTimes) : 0;

    // 🔥 新增风险指标计算

    // 1. Sortino比率 (只考虑下行波动)
    const downsideReturns = equityReturns.filter(r => r < 0);
    const downsideVariance = downsideReturns.length > 0
        ? downsideReturns.reduce((sum, value) => sum + Math.pow(value, 2), 0) / downsideReturns.length
        : 0;
    const downsideDeviation = Math.sqrt(downsideVariance);
    const sortinoRatio = downsideDeviation > 0 ? (avgReturn / downsideDeviation) * Math.sqrt(barsPerYear) : 0;

    const durationMs = Math.max(1, endTime - startTime);
    const annualizedReturn = endingEquity > 0
        ? Math.pow(endingEquity / 100, yearMs / durationMs) - 1
        : -1;
    const maxDrawdownDecimal = maxDrawdown / 100;
    const calmarRatio = maxDrawdownDecimal > 0 ? annualizedReturn / maxDrawdownDecimal : 0;

    const expectancy = totalTrades > 0
        ? (winRate / 100) * averageWin + ((100 - winRate) / 100) * averageLoss
        : 0;

    const recoveryFactor = maxDrawdown > 0 ? totalProfit / maxDrawdown : 0;

    let maxConsecutiveWins = 0;
    let maxConsecutiveLosses = 0;
    let currentStreak = { type: 'win' as 'win' | 'loss', count: 0 };
    let tempWinStreak = 0;
    let tempLossStreak = 0;

    trades.forEach(trade => {
        if (trade.profit > 0) {
            tempWinStreak++;
            tempLossStreak = 0;
            if (tempWinStreak > maxConsecutiveWins) {
                maxConsecutiveWins = tempWinStreak;
            }
        } else if (trade.profit < 0) {
            tempLossStreak++;
            tempWinStreak = 0;
            if (tempLossStreak > maxConsecutiveLosses) {
                maxConsecutiveLosses = tempLossStreak;
            }
        }
    });

    // 记录当前连续状态
    if (trades.length > 0) {
        const lastTrade = trades[trades.length - 1];
        if (lastTrade.profit > 0) {
            currentStreak = { type: 'win', count: tempWinStreak };
        } else {
            currentStreak = { type: 'loss', count: tempLossStreak };
        }
    }

    return {
        symbol,
        interval,
        executionInterval,
        strategyName,
        startTime,
        endTime,
        totalBars,
        executionBarsProcessed,
        totalTrades,
        winningTrades,
        losingTrades,
        winRate,
        totalProfit,
        totalProfitUSDT,
        averageProfit,
        averageWin,
        averageLoss,
        largestWin,
        largestLoss,
        maxDrawdown,
        sharpeRatio,
        profitFactor,
        sortinoRatio,
        calmarRatio,
        expectancy,
        recoveryFactor,
        maxConsecutiveWins,
        maxConsecutiveLosses,
        currentStreak,
        averageHoldingTime,
        maxHoldingTime,
        minHoldingTime,
        trades,
        tradeLegs,
        equityCurve,
    };
}
