import { KlineData } from '@/app/api/backtest/klines/route';
import { TickerData } from './types';
import { RiskManagement } from './risk/types';
import { TechnicalIndicators } from './technicalIndicators';

/**
 * 回测结果接口
 */
export interface BacktestResult {
    // 基本信息
    symbol: string;
    interval: string;
    strategyName: string;
    startTime: number;
    endTime: number;
    totalBars: number;

    // 交易统计
    totalTrades: number;
    winningTrades: number;
    losingTrades: number;
    winRate: number; // 胜率 (%)

    // 盈亏统计
    totalProfit: number; // 总盈亏 (%)
    totalProfitUSDT: number; // 总盈亏 (USDT)
    averageProfit: number; // 平均盈亏 (%)
    averageWin: number; // 平均盈利 (%)
    averageLoss: number; // 平均亏损 (%)
    largestWin: number; // 最大盈利 (%)
    largestLoss: number; // 最大亏损 (%)

    // 风险指标
    maxDrawdown: number; // 最大回撤 (%)
    sharpeRatio: number; // 夏普比率
    profitFactor: number; // 盈亏比
    sortinoRatio: number; // Sortino比率 (只考虑下行波动)
    calmarRatio: number; // Calmar比率 (收益/最大回撤)
    expectancy: number; // 期望值 (每笔交易的平均收益)
    recoveryFactor: number; // 恢复因子 (净利润/最大回撤)
    maxConsecutiveWins: number; // 最大连续盈利次数
    maxConsecutiveLosses: number; // 最大连续亏损次数
    currentStreak: { type: 'win' | 'loss'; count: number }; // 当前连续状态

    // 持仓统计
    averageHoldingTime: number; // 平均持仓时间(毫秒)
    maxHoldingTime: number; // 最大持仓时间(毫秒)
    minHoldingTime: number; // 最小持仓时间(毫秒)

    // 详细交易记录
    trades: Trade[];

    // 资金曲线
    equityCurve: EquityPoint[];
}

/**
 * 单次交易记录
 */
export interface Trade {
    entryTime: number;
    exitTime: number;
    entryPrice: number;
    exitPrice: number;
    direction: 'long' | 'short';
    size: number; // 仓位比例 (0-1)
    profit: number; // 盈亏 (%)
    profitUSDT: number; // 盈亏 (USDT)
    holdingTime: number; // 持仓时间(毫秒)
    exitReason: 'stop_loss' | 'take_profit' | 'signal' | 'end_of_data' | 'time_stop';
}

/**
 * 资金曲线点
 */
export interface EquityPoint {
    time: number;
    equity: number; // 权益 (%)
    drawdown: number; // 回撤 (%)
}

/**
 * 回测配置
 */
export interface BacktestConfig {
    initialCapital: number; // 初始资金
    commission: number; // 手续费 (%)
    slippage: number; // 滑点 (%)
    useStrategyRiskManagement?: boolean; // 是否使用策略自带的风控参数
}

/**
 * 策略返回结果
 */
export interface StrategyResult {
    signal: 'long' | 'short' | null;
    confidence: number;
    risk?: RiskManagement; // 策略携带的风控信息
}

/**
 * 策略检测函数类型
 */
export type StrategyDetector = (ticker: TickerData) => StrategyResult | null;

/**
 * 回测引擎类
 */
export class BacktestEngine {
    private config: BacktestConfig;

    constructor(config: Partial<BacktestConfig> = {}) {
        this.config = {
            initialCapital: config.initialCapital || 10000,
            commission: config.commission || 0.04,
            slippage: config.slippage || 0.05,
            useStrategyRiskManagement: config.useStrategyRiskManagement ?? true,
        };
    }

    /**
     * 运行回测
     */
    run(
        klines: KlineData[],
        strategyDetector: StrategyDetector,
        strategyName: string,
        symbol: string,
        interval: string
    ): BacktestResult {
        if (klines.length === 0) {
            throw new Error('K线数据为空');
        }

        const trades: Trade[] = [];
        const equityCurve: EquityPoint[] = [];

        let currentPosition: {
            direction: 'long' | 'short';
            entryPrice: number;
            entryTime: number;
            entryIndex: number;
            risk?: RiskManagement; // 存储开仓时的风控参数
            highestPrice: number;  // 持仓期间最高价 (用于跟踪止损)
            lowestPrice: number;   // 持仓期间最低价 (用于跟踪止损)
            remainingSize: number; // 剩余仓位 (0-1)
            hitTargetIndices: number[]; // 已触发的止盈目标索引
        } | null = null;

        let equity = 100; // 初始权益百分比
        let peakEquity = 100;
        let maxDrawdown = 0;

        const startIndex = Math.max(100, 0);

        // 遍历所有K线
        for (let i = startIndex; i < klines.length; i++) {
            const kline = klines[i];
            // 使用技术指标计算器生成完整的ticker数据
            const ticker = TechnicalIndicators.enrichTickerData(klines, i, symbol, interval);

            // 检查是否需要平仓
            if (currentPosition) {
                const currentClose = parseFloat(kline.close);
                const currentHigh = parseFloat(kline.high);
                const currentLow = parseFloat(kline.low);

                const entryPrice = currentPosition.entryPrice;
                const direction = currentPosition.direction;

                // 更新持仓期间的极值价格
                if (currentHigh > currentPosition.highestPrice) {
                    currentPosition.highestPrice = currentHigh;
                }
                if (currentLow < currentPosition.lowestPrice) {
                    currentPosition.lowestPrice = currentLow;
                }

                let shouldExit = false;
                let exitReason: Trade['exitReason'] = 'end_of_data';
                let exitPrice = currentClose; // 默认以收盘价平仓

                // 1. 优先使用策略自带的风控参数
                const strategyRisk = currentPosition.risk;

                if (this.config.useStrategyRiskManagement && strategyRisk) {
                    // --- 跟踪止损更新逻辑 ---
                    if (strategyRisk.stopLoss.type === 'trailing') {
                        if (direction === 'long') {
                            // 计算新的移动止损位：最高价 * (1 - 止损百分比)
                            // 注意：这里的 percentage 是相对于入场价的初始百分比用于计算动态距离，或者策略应该提供 trailingDistance，这里复用 stopLoss.percentage 作为回撤阈值
                            const trailingDistance = strategyRisk.stopLoss.percentage / 100;
                            const newStopLoss = currentPosition.highestPrice * (1 - trailingDistance);

                            // 止损只能上移
                            if (newStopLoss > strategyRisk.stopLoss.price) {
                                strategyRisk.stopLoss.price = newStopLoss;
                            }
                        } else {
                            // 做空：最低价 * (1 + 止损百分比)
                            const trailingDistance = strategyRisk.stopLoss.percentage / 100;
                            const newStopLoss = currentPosition.lowestPrice * (1 + trailingDistance);

                            // 止损只能下移
                            if (newStopLoss < strategyRisk.stopLoss.price) {
                                strategyRisk.stopLoss.price = newStopLoss;
                            }
                        }
                    }
                    // --- 策略止损逻辑 (Intra-bar High/Low 检测) ---
                    const stopLossPrice = strategyRisk.stopLoss.price;

                    if (direction === 'long') {
                        //做多：如果最低价跌破止损价
                        if (currentLow <= stopLossPrice) {
                            shouldExit = true;
                            exitReason = 'stop_loss';
                            // 模拟在止损价成交（考虑滑点）此时不应优于止损价，通常会有滑点
                            exitPrice = stopLossPrice;
                        }
                    } else {
                        //做空：如果最高价涨破止损价
                        if (currentHigh >= stopLossPrice) {
                            shouldExit = true;
                            exitReason = 'stop_loss';
                            exitPrice = stopLossPrice;
                        }
                    }

                    // --- 策略止盈 & 保本 & 分批平仓逻辑 ---
                    if (!shouldExit && strategyRisk.takeProfit && strategyRisk.takeProfit.targets.length > 0) {
                        strategyRisk.takeProfit.targets.forEach((target, index) => {
                            // 如果已经全仓由于其他原因退出，或者该目标已触发，跳过
                            if (shouldExit || currentPosition!.hitTargetIndices.includes(index)) return;

                            let isHit = false;
                            if (direction === 'long') {
                                if (currentHigh >= target.price) isHit = true;
                            } else {
                                if (currentLow <= target.price) isHit = true;
                            }

                            if (isHit) {
                                // 标记该目标已触发
                                currentPosition!.hitTargetIndices.push(index);

                                // 1. 保本逻辑
                                if (target.moveStopToEntry) {
                                    const breakEvenPrice = entryPrice;
                                    if (direction === 'long') {
                                        if (breakEvenPrice > strategyRisk.stopLoss.price) {
                                            strategyRisk.stopLoss.price = breakEvenPrice;
                                            strategyRisk.stopLoss.reason = "保本止损(T" + (index + 1) + "触发)";
                                        }
                                    } else {
                                        if (breakEvenPrice < strategyRisk.stopLoss.price) {
                                            strategyRisk.stopLoss.price = breakEvenPrice;
                                            strategyRisk.stopLoss.reason = "保本止损(T" + (index + 1) + "触发)";
                                        }
                                    }

                                    // 立即检查当前K线是否同时也触发了新的止损 (保本损)
                                    if (!shouldExit) {
                                        const currentNewStop = strategyRisk.stopLoss.price;
                                        if ((direction === 'long' && parseFloat(kline.low) <= currentNewStop) ||
                                            (direction === 'short' && parseFloat(kline.high) >= currentNewStop)) {
                                            shouldExit = true;
                                            exitReason = 'stop_loss';
                                            exitPrice = currentNewStop;
                                        }
                                    }
                                }

                                // 2. 分批平仓逻辑
                                const closeRatio = target.closePercentage / 100;
                                const exitSize = currentPosition!.remainingSize * closeRatio;

                                if (!shouldExit && exitSize > 0.0001) {
                                    // 记录一笔分批平仓交易
                                    // 重新计算该部分的盈亏
                                    let finalProfitPercent = 0;
                                    const tpPrice = target.price; // 假设在目标价成交
                                    if (direction === 'long') {
                                        finalProfitPercent = ((tpPrice - entryPrice) / entryPrice) * 100;
                                    } else {
                                        finalProfitPercent = ((entryPrice - tpPrice) / entryPrice) * 100;
                                    }

                                    // 扣除手续费和滑点
                                    finalProfitPercent -= (this.config.commission + this.config.slippage);

                                    const trade: Trade = {
                                        entryTime: currentPosition!.entryTime,
                                        exitTime: kline.closeTime,
                                        entryPrice: entryPrice,
                                        exitPrice: tpPrice,
                                        direction: direction,
                                        size: exitSize, // 记录仓位大小
                                        profit: finalProfitPercent,
                                        profitUSDT: (this.config.initialCapital * finalProfitPercent * exitSize) / 100,
                                        holdingTime: kline.closeTime - currentPosition!.entryTime,
                                        exitReason: 'take_profit',
                                    };
                                    trades.push(trade);

                                    // 更新资金权益
                                    equity += finalProfitPercent * exitSize;

                                    // 更新剩余仓位
                                    currentPosition!.remainingSize -= exitSize;
                                }

                                // 如果剩余仓位极小，视为全部平仓
                                if (currentPosition!.remainingSize <= 0.0001) {
                                    shouldExit = true;
                                    exitReason = 'take_profit';
                                    exitPrice = target.price;
                                }
                            }
                        });
                    }

                } else {
                    // --- 默认固定百分比逻辑（无策略风控时的兜底） ---
                    let profitPercent = 0;
                    if (direction === 'long') {
                        profitPercent = ((currentClose - entryPrice) / entryPrice) * 100;
                    } else {
                        profitPercent = ((entryPrice - currentClose) / entryPrice) * 100;
                    }

                    // 兜底止损 5%
                    const fallbackStopLoss = 5;
                    if (profitPercent <= -fallbackStopLoss) {
                        shouldExit = true;
                        exitReason = 'stop_loss';
                        exitPrice = currentClose;
                    }

                    // 兜底止盈 10%
                    const fallbackTakeProfit = 10;
                    if (profitPercent >= fallbackTakeProfit) {
                        shouldExit = true;
                        exitReason = 'take_profit';
                        exitPrice = currentClose;
                    }
                }

                // 检查反向信号 (始终生效)
                if (!shouldExit) {
                    const strategyResult = strategyDetector(ticker);
                    if (strategyResult && strategyResult.signal && strategyResult.signal !== direction) {
                        shouldExit = true;
                        exitReason = 'signal';
                        exitPrice = currentClose;
                    }
                }

                // 最后一根K线强制平仓
                if (!shouldExit && i === klines.length - 1) {
                    shouldExit = true;
                    exitReason = 'end_of_data';
                    exitPrice = currentClose;
                }

                // 执行最终平仓 (StopLoss / Signal / End / Remaining TP)
                if (shouldExit && currentPosition!.remainingSize > 0.0001) {
                    // 重新计算最终盈亏，基于确定的 exitPrice
                    let finalProfitPercent = 0;
                    if (direction === 'long') {
                        finalProfitPercent = ((exitPrice - entryPrice) / entryPrice) * 100;
                    } else {
                        finalProfitPercent = ((entryPrice - exitPrice) / entryPrice) * 100;
                    }

                    // 扣除手续费和滑点
                    const totalCost = this.config.commission + this.config.slippage;
                    finalProfitPercent -= totalCost;

                    const trade: Trade = {
                        entryTime: currentPosition!.entryTime,
                        exitTime: kline.closeTime,
                        entryPrice: entryPrice,
                        exitPrice: exitPrice,
                        direction: direction,
                        size: currentPosition!.remainingSize, // 使用剩余仓位
                        profit: finalProfitPercent,
                        profitUSDT: (this.config.initialCapital * finalProfitPercent * currentPosition!.remainingSize) / 100,
                        holdingTime: kline.closeTime - currentPosition!.entryTime,
                        exitReason, // 这里可能是 stop_loss, time_stop, signal, end_of_data
                    };

                    trades.push(trade);
                    equity += finalProfitPercent * currentPosition!.remainingSize;
                }

                if (shouldExit || (currentPosition && currentPosition.remainingSize <= 0.0001)) {
                    // ... 资金曲线更新保持不变 ...

                    // 更新最大回撤
                    if (equity > peakEquity) {
                        peakEquity = equity;
                    }
                    const drawdown = ((peakEquity - equity) / peakEquity) * 100;
                    if (drawdown > maxDrawdown) {
                        maxDrawdown = drawdown;
                    }

                    // 记录资金曲线
                    equityCurve.push({
                        time: kline.closeTime,
                        equity: equity,
                        drawdown: drawdown,
                    });

                    currentPosition = null;
                }
            }

            // 检查开仓信号
            if (!currentPosition) {
                const strategyResult = strategyDetector(ticker);
                if (strategyResult && strategyResult.signal) {
                    currentPosition = {
                        direction: strategyResult.signal,
                        entryPrice: parseFloat(kline.close),
                        entryTime: kline.closeTime,
                        entryIndex: i,
                        risk: strategyResult && strategyResult.risk ? JSON.parse(JSON.stringify(strategyResult.risk)) : undefined, // Deep Clone 防止引用污染
                        highestPrice: parseFloat(kline.high), // 初始化最高价
                        lowestPrice: parseFloat(kline.low),    // 初始化最低价
                        remainingSize: 1.0, // 初始仓位 100%
                        hitTargetIndices: [] // 初始化目标记录
                    };
                }
            }
        }

        // 计算统计指标
        return this.calculateMetrics(
            trades,
            equityCurve,
            maxDrawdown,
            symbol,
            interval,
            strategyName,
            klines[startIndex].openTime,
            klines[klines.length - 1].closeTime,
            klines.length - startIndex
        );
    }

    /**
     * 将K线数据转换为Ticker数据
     */
    private klineToTicker(kline: KlineData, symbol: string): TickerData {
        return {
            symbol,
            lastPrice: kline.close,
            priceChange: '0',
            priceChangePercent: '0',
            weightedAvgPrice: kline.close,
            prevClosePrice: kline.open,
            highPrice: kline.high,
            lowPrice: kline.low,
            volume: kline.volume,
            quoteVolume: kline.quoteVolume,
            openTime: kline.openTime,
            closeTime: kline.closeTime,
            fundingRate: '0',
            openInterest: '0',
            openInterestValue: '0',
        };
    }

    /**
     * 计算回测指标
     */
    private calculateMetrics(
        trades: Trade[],
        equityCurve: EquityPoint[],
        maxDrawdown: number,
        symbol: string,
        interval: string,
        strategyName: string,
        startTime: number,
        endTime: number,
        totalBars: number
    ): BacktestResult {
        const totalTrades = trades.length;
        const winningTrades = trades.filter(t => t.profit > 0).length;
        const losingTrades = trades.filter(t => t.profit < 0).length;
        const winRate = totalTrades > 0 ? (winningTrades / totalTrades) * 100 : 0;

        const totalProfit = trades.reduce((sum, t) => sum + (t.profit * (t.size || 1)), 0); // 加权总盈亏
        const totalProfitUSDT = trades.reduce((sum, t) => sum + t.profitUSDT, 0);
        const averageProfit = totalTrades > 0 ? totalProfit / totalTrades : 0; // 这变成了平均每笔(部分)交易对总账户的贡献百分比，可能有点小

        // 或者 averageProfit 保持为 "平均单次交易盈亏幅"，不加权?
        // 不，如果不加权，一个 1% 仓位的 100% 盈利会拉高平均值，误导性强。加权更合理。

        const wins = trades.filter(t => t.profit > 0);
        const losses = trades.filter(t => t.profit < 0);
        const averageWin = wins.length > 0 ? wins.reduce((sum, t) => sum + (t.profit * (t.size || 1)), 0) / wins.length : 0;
        const averageLoss = losses.length > 0 ? losses.reduce((sum, t) => sum + (t.profit * (t.size || 1)), 0) / losses.length : 0;

        // 最大盈利/亏损也应该看绝对贡献? 或者看原始幅度? 通常看原始幅度代表策略能力。
        // 但为了资金对齐，这里保持原始幅度可能更好用于观察“抓住多大行情”，而加权用于评估“赚了多少钱”。
        // 让我们只修改 totalProfit 和 averageWin/Loss 的*统计口径*为加权值，这样能反映对账户的真实影响。

        const largestWin = wins.length > 0 ? Math.max(...wins.map(t => t.profit)) : 0; // 保持原始幅度
        const largestLoss = losses.length > 0 ? Math.min(...losses.map(t => t.profit)) : 0; // 保持原始幅度

        const totalWin = wins.reduce((sum, t) => sum + (t.profit * (t.size || 1)), 0);
        const totalLoss = Math.abs(losses.reduce((sum, t) => sum + (t.profit * (t.size || 1)), 0));
        const profitFactor = totalLoss > 0 ? totalWin / totalLoss : 0;

        // 计算夏普比率（简化版本）
        const returns = trades.map(t => t.profit);
        const avgReturn = averageProfit;
        const variance = returns.reduce((sum, r) => sum + Math.pow(r - avgReturn, 2), 0) / (returns.length || 1);
        const stdDev = Math.sqrt(variance);
        const sharpeRatio = stdDev > 0 ? (avgReturn / stdDev) * Math.sqrt(252) : 0; // 年化

        // 持仓时间统计
        const holdingTimes = trades.map(t => t.holdingTime);
        const averageHoldingTime = holdingTimes.length > 0 ? holdingTimes.reduce((a, b) => a + b, 0) / holdingTimes.length : 0;
        const maxHoldingTime = holdingTimes.length > 0 ? Math.max(...holdingTimes) : 0;
        const minHoldingTime = holdingTimes.length > 0 ? Math.min(...holdingTimes) : 0;

        // 🔥 新增风险指标计算

        // 1. Sortino比率 (只考虑下行波动)
        const downsideReturns = returns.filter(r => r < 0);
        const downsideVariance = downsideReturns.length > 0
            ? downsideReturns.reduce((sum, r) => sum + r * r, 0) / downsideReturns.length
            : 0;
        const downsideDeviation = Math.sqrt(downsideVariance);
        const sortinoRatio = downsideDeviation > 0 ? (avgReturn / downsideDeviation) * Math.sqrt(252) : 0;

        // 2. Calmar比率 (年化收益 / 最大回撤)
        const tradingDays = Math.max(1, (endTime - startTime) / (24 * 60 * 60 * 1000));
        const annualizedReturn = totalProfit * (252 / tradingDays);
        const calmarRatio = maxDrawdown > 0 ? annualizedReturn / maxDrawdown : 0;

        // 3. 期望值 (每笔交易的平均收益，考虑胜率)
        const expectancy = totalTrades > 0
            ? (winRate / 100) * averageWin + ((100 - winRate) / 100) * averageLoss
            : 0;

        // 4. 恢复因子 (净利润 / 最大回撤)
        const recoveryFactor = maxDrawdown > 0 ? totalProfit / maxDrawdown : 0;

        // 5. 最大连续盈利/亏损次数
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
            strategyName,
            startTime,
            endTime,
            totalBars,
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
            equityCurve,
        };
    }
}
