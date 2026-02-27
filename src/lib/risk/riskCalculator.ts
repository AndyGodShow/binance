/**
 * 风险管理核心计算器
 * 统一的风控接口
 */

import { RiskManagement, RiskCalculationParams } from './types';
import { calculateSqueezeRisk } from './squeezeRisk';
import { calculateBreakoutRisk } from './breakoutRisk';
import { calculateTrendRisk } from './trendRisk';
import { calculateInflowRisk } from './inflowRisk';
import { calculateRSRSRisk } from './rsrsRisk';
import { roundPrice, roundPercentage } from './priceUtils';

/**
 * 主风控计算函数 - 根据策略ID分发
 */
export function calculateRiskManagement(
    strategyId: string,
    params: RiskCalculationParams
): RiskManagement {
    switch (strategyId) {
        case 'strong-breakout':
            return calculateBreakoutRisk(params);

        case 'trend-confirmation':
            return calculateTrendRisk(params);

        case 'capital-inflow':
            return calculateInflowRisk(params);

        case 'rsrs':
            return calculateRSRSRisk(params);

        case 'volatility-squeeze':
            return calculateSqueezeRisk(params);

        default:
            // 降级为基础风控
            return calculateBasicRisk(params);
    }
}

/**
 * 基础风控逻辑（降级方案）
 */
function calculateBasicRisk(params: RiskCalculationParams): RiskManagement {
    const {
        entryPrice,
        direction,
        confidence,
        atr,
        accountBalance = 10000,
        riskPercentage = 1
    } = params;

    // 简单的 ATR 止损
    const atrValue = atr || entryPrice * 0.02; // 默认2%
    const stopLossPrice = direction === 'long'
        ? entryPrice - atrValue * 2.5
        : entryPrice + atrValue * 2.5;

    const stopLossPercentage = Math.abs((stopLossPrice - entryPrice) / entryPrice) * 100;

    // 简单的止盈目标
    const tp1Price = direction === 'long'
        ? entryPrice + atrValue * 3
        : entryPrice - atrValue * 3;

    const tp2Price = direction === 'long'
        ? entryPrice + atrValue * 5
        : entryPrice - atrValue * 5;

    const tp1Percentage = Math.abs((tp1Price - entryPrice) / entryPrice) * 100;
    const tp2Percentage = Math.abs((tp2Price - entryPrice) / entryPrice) * 100;

    // 简单的仓位计算
    const positionPercentage = confidence >= 85 ? 20 : confidence >= 75 ? 15 : 10;
    const positionValue = accountBalance * (positionPercentage / 100);
    const maxRiskAmount = positionValue * (stopLossPercentage / 100);

    return {
        stopLoss: {
            price: roundPrice(stopLossPrice),
            percentage: roundPercentage(stopLossPercentage),
            type: 'fixed',
            reason: '基于2.5倍ATR'
        },
        takeProfit: {
            targets: [
                {
                    price: roundPrice(tp1Price),
                    percentage: roundPercentage(tp1Percentage),
                    closePercentage: 50,
                    reason: '3倍ATR目标'
                },
                {
                    price: roundPrice(tp2Price),
                    percentage: roundPercentage(tp2Percentage),
                    closePercentage: 100,
                    reason: '5倍ATR目标'
                }
            ],
            riskRewardRatio: Math.round((tp1Percentage * 0.5 + tp2Percentage * 0.5) / stopLossPercentage * 10) / 10
        },
        positionSizing: {
            percentage: positionPercentage,
            leverage: 3,
            maxRiskAmount: Math.round(maxRiskAmount * 100) / 100,
            confidence,
            reasoning: '基础置信度映射'
        },
        metrics: {
            entryPrice,
            riskAmount: Math.round(maxRiskAmount * 100) / 100,
            potentialProfit: Math.round(maxRiskAmount * 2 * 100) / 100
        }
    };
}

// 导出所有风控函数
export * from './types';
export * from './positionSizer';
export * from './squeezeRisk';
export * from './breakoutRisk';
export * from './trendRisk';
export * from './inflowRisk';
export * from './rsrsRisk';
