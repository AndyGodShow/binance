/**
 * 风险管理系统 - 类型定义
 * "会买是徒弟，会卖才是师傅"
 */

// ==================== 止盈目标 ====================
export interface TakeProfitTarget {
    price: number;                 // 目标价格
    percentage: number;            // 利润百分比
    closePercentage: number;       // 平仓比例 (0-100)
    reason: string;                // 止盈依据
    moveStopToEntry?: boolean;     // 🔥 是否在达成此目标后移动止损到保本位
}

// ==================== 止损配置 ====================
export interface StopLoss {
    price: number;                 // 止损价格
    percentage: number;            // 止损百分比 (相对入场价)
    type: 'fixed' | 'trailing' | 'dynamic'; // 止损类型
    reason: string;                // 止损依据
}

// ==================== 止盈配置 ====================
export interface TakeProfit {
    targets: TakeProfitTarget[];   // 多级止盈
    riskRewardRatio: number;       // 盈亏比 (RR)
}

// ==================== 仓位管理 ====================
export interface PositionSizing {
    percentage: number;            // 建议仓位比例 (1-100%)
    leverage: number;              // 建议杠杆倍数
    maxRiskAmount: number;         // 最大风险金额 (USDT)
    confidence: number;            // 置信度 → 仓位映射
    reasoning: string;             // 仓位依据
}

// ==================== 风控指标 ====================
export interface RiskMetrics {
    entryPrice: number;            // 入场价格
    riskAmount: number;            // 单笔风险金额
    potentialProfit: number;       // 潜在盈利
    winRate?: number;              // 策略历史胜率
    expectedValue?: number;        // 期望值 (EV)
}

// ==================== 完整风险管理 ====================
export interface RiskManagement {
    stopLoss: StopLoss;
    takeProfit: TakeProfit;
    positionSizing: PositionSizing;
    metrics: RiskMetrics;
    timeStop?: {                   // 🔥 时间止损配置
        maxHoldBars: number;       // 最大持仓K线数
        profitThreshold: number;   // 利润阈值 (< 此值则平仓)
    };
}

// ==================== 风控计算参数 ====================
export interface RiskCalculationParams {
    entryPrice: number;
    direction: 'long' | 'short';
    confidence: number;

    // 策略特定参数
    atr?: number;
    keltnerMid?: number;
    keltnerUpper?: number;
    keltnerLower?: number;
    vah?: number;
    val?: number;
    poc?: number;
    bollingerLower?: number;
    bollingerUpper?: number;

    // 动态参数
    momentumColor?: 'cyan' | 'blue' | 'red' | 'yellow';
    cvdSlope?: number;
    fundingRateTrend?: 'up' | 'down' | 'stable';
    rsrsZScore?: number;
    squeezeDuration?: number;
    bandwidthPercentile?: number;
    adx?: number;
    oiChangePercent?: number;
    volumeChangePercent?: number;
    betaToBTC?: number;
    turnoverRatio?: number;
    rsrsR2?: number;

    // 账户参数
    accountBalance?: number;       // 账户余额
    riskPercentage?: number;       // 单笔风险比例 (默认1%)
}

// ==================== 策略风控函数类型 ====================
export type RiskCalculationFunction = (
    params: RiskCalculationParams
) => RiskManagement;
