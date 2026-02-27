/**
 * 仓位管理算法
 * 基于 Kelly 公式和风险固定法
 */

import { PositionSizing, RiskCalculationParams } from './types';

/**
 * Kelly 公式优化版 - 计算最优仓位
 * 
 * @param winRate 胜率 (0-1)
 * @param avgWin 平均盈利百分比
 * @param avgLoss 平均亏损百分比
 * @param confidence 策略置信度 (0-100)
 * @returns 建议仓位百分比
 */
export function calculateKellyPosition(
    winRate: number,
    avgWin: number,
    avgLoss: number,
    confidence: number
): number {
    // Kelly = (p × b - q) / b
    // p = 胜率, q = 败率, b = 盈亏比

    const p = winRate;
    const q = 1 - p;
    const b = avgWin / avgLoss;

    const kellyPercentage = (p * b - q) / b;

    // 保守调整：使用半凯利（避免过度杠杆）
    const halfKelly = kellyPercentage * 0.5;

    // 置信度调整
    const confidenceMultiplier = confidence / 100;

    const finalPosition = halfKelly * confidenceMultiplier;

    // 限制在 5%-35% 之间
    return Math.max(5, Math.min(35, finalPosition * 100));
}

/**
 * 风险金额固定法 - 基于止损距离计算仓位
 * 
 * @param accountBalance 账户余额
 * @param riskPercentage 单笔风险比例 (1-2%)
 * @param entryPrice 入场价格
 * @param stopLoss 止损价格
 * @returns 建议仓位百分比
 */
export function calculatePositionByRisk(
    accountBalance: number,
    riskPercentage: number,
    entryPrice: number,
    stopLoss: number
): number {
    const riskAmount = accountBalance * (riskPercentage / 100);
    const priceRisk = Math.abs(entryPrice - stopLoss) / entryPrice;

    // 仓位百分比 = 风险金额 / (账户余额 × 单价风险)
    const positionPercentage = (riskAmount / accountBalance) / priceRisk * 100;

    // 限制在 5%-50% 之间
    return Math.max(5, Math.min(50, positionPercentage));
}

/**
 * 基于置信度的简单映射
 */
export function calculatePositionByConfidence(confidence: number): number {
    if (confidence >= 90) return 30;
    if (confidence >= 85) return 25;
    if (confidence >= 80) return 20;
    if (confidence >= 75) return 15;
    return 10;
}

/**
 * 综合仓位计算 - 结合多种方法
 */
export function calculateOptimalPosition(params: {
    confidence: number;
    accountBalance?: number;
    riskPercentage?: number;
    entryPrice: number;
    stopLoss: number;
    winRate?: number;
    avgWin?: number;
    avgLoss?: number;
    strategyBonus?: number; // 策略特定加成
}): PositionSizing {
    let basePosition: number;
    let reasoning: string;

    // 优先使用风险固定法（如果有账户余额）
    if (params.accountBalance && params.riskPercentage) {
        basePosition = calculatePositionByRisk(
            params.accountBalance,
            params.riskPercentage,
            params.entryPrice,
            params.stopLoss
        );
        reasoning = `风险固定法 (账户${params.riskPercentage}%风险)`;
    }
    // 次优使用 Kelly 公式（如果有历史数据）
    else if (params.winRate && params.avgWin && params.avgLoss) {
        basePosition = calculateKellyPosition(
            params.winRate,
            params.avgWin,
            params.avgLoss,
            params.confidence
        );
        reasoning = `Kelly公式 (胜率${(params.winRate * 100).toFixed(0)}%)`;
    }
    // 降级为置信度映射
    else {
        basePosition = calculatePositionByConfidence(params.confidence);
        reasoning = `置信度映射`;
    }

    // 应用策略特定加成
    if (params.strategyBonus) {
        basePosition = Math.min(35, basePosition + params.strategyBonus);
        reasoning += ` + 策略加成${params.strategyBonus}%`;
    }

    // 计算最大风险金额
    const accountBalance = params.accountBalance || 10000; // 默认值
    const positionValue = accountBalance * (basePosition / 100);
    const riskPerPrice = Math.abs(params.entryPrice - params.stopLoss) / params.entryPrice;
    const maxRiskAmount = positionValue * riskPerPrice;

    // 根据仓位大小推荐杠杆
    let recommendedLeverage: number;
    if (basePosition <= 10) {
        recommendedLeverage = 5; // 小仓位可用高杠杆
    } else if (basePosition <= 20) {
        recommendedLeverage = 3;
    } else {
        recommendedLeverage = 2; // 大仓位低杠杆
    }

    return {
        percentage: Math.round(basePosition * 10) / 10, // 保留1位小数
        leverage: recommendedLeverage,
        maxRiskAmount: Math.round(maxRiskAmount * 100) / 100,
        confidence: params.confidence,
        reasoning
    };
}
