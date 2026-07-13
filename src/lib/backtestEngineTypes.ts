import type { MarketBar } from './backtestDataAdapter.ts';
import type { RiskManagement } from './risk/types.ts';

export interface BacktestResult {
    // 基本信息
    symbol: string;
    interval: string;
    executionInterval: string;
    strategyName: string;
    startTime: number;
    endTime: number;
    totalBars: number;
    executionBarsProcessed: number;

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
    profitFactor: number; // 盈亏比，无亏损单时为 Infinity
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
    tradeLegs: Trade[];

    // 资金曲线
    equityCurve: EquityPoint[];
}

/**
 * 单次交易记录
 */
export interface Trade {
    symbol?: string;
    entryTime: number;
    exitTime: number;
    entryPrice: number;
    exitPrice: number;
    direction: 'long' | 'short';
    size: number; // 仓位比例 (0-1)
    profit: number; // 盈亏 (%)
    profitUSDT: number; // 盈亏 (USDT)
    qty?: number;
    margin?: number;
    notional?: number;
    fee?: number;
    slippageCost?: number;
    funding?: number;
    pnl?: number;
    pnlPct?: number;
    holdingTime: number; // 持仓时间(毫秒)
    exitReason: 'stop_loss' | 'take_profit' | 'signal' | 'end_of_data' | 'time_stop';
    strategyRiskPct?: number;
    plannedPositionPct?: number;
    stopLossPct?: number;
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

export interface TradeSettlement {
    capitalReturned: number;
    profitUSDT: number;
}

export interface BacktestPosition {
    direction: 'long' | 'short';
    entryPrice: number;
    entryTime: number;
    entryCapital: number;
    margin: number;
    notional: number;
    qty: number;
    leverage: number;
    accruedFunding: number;
    signalEntryTime: number;
    entryIndex: number;
    risk?: RiskManagement;
    highestPrice: number;
    lowestPrice: number;
    initialSize: number;
    remainingSize: number;
    hitTargetIndices: number[];
    executionHistory: MarketBar[];
}

export interface PendingBacktestEntry {
    direction: 'long' | 'short';
    signalTime: number;
    risk?: RiskManagement;
}
