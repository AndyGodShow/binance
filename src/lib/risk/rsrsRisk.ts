/**
 * RSRS量化增强策略 - 风控逻辑
 * 特点：统计套利，均值回归
 */

import {
    RiskManagement,
    RiskCalculationParams,
    StopLoss,
    TakeProfit,
    TakeProfitTarget
} from './types';
import { calculateOptimalPosition } from './positionSizer';
import { roundPrice, roundPercentage } from './priceUtils';

export function calculateRSRSRisk(params: RiskCalculationParams): RiskManagement {
    const {
        entryPrice,
        direction,
        confidence,
        bollingerLower,
        bollingerUpper,
        accountBalance,
        riskPercentage = 1
    } = params;

    // ========== 止损逻辑 ==========
    // 基于布林带或固定3%，但有上限保护
    let stopLossPrice: number;
    let stopLossReason: string;

    if (direction === 'long') {
        const bollingerStop = bollingerLower || entryPrice * 0.97;
        const maxStopDistance = entryPrice * 0.04; // 🔥 最大止损4%

        // 如果布林带止损超过4%，使用固定3%
        if (bollingerLower && (entryPrice - bollingerLower) > maxStopDistance) {
            stopLossPrice = entryPrice * 0.97;
            stopLossReason = "布林带过宽，使用固定3%止损";
        } else {
            stopLossPrice = bollingerStop;
            stopLossReason = bollingerLower
                ? "跌破布林下轨（信号失效）"
                : "固定3%止损";
        }
    } else {
        const bollingerStop = bollingerUpper || entryPrice * 1.03;
        const maxStopDistance = entryPrice * 0.04;

        if (bollingerUpper && (bollingerUpper - entryPrice) > maxStopDistance) {
            stopLossPrice = entryPrice * 1.03;
            stopLossReason = "布林带过宽，使用固定3%止损";
        } else {
            stopLossPrice = bollingerStop;
            stopLossReason = bollingerUpper
                ? "涨破布林上轨（信号失效）"
                : "固定3%止损";
        }
    }

    const stopLossPercentage = Math.abs((stopLossPrice - entryPrice) / entryPrice) * 100;

    const stopLoss: StopLoss = {
        price: roundPrice(stopLossPrice),
        percentage: roundPercentage(stopLossPercentage),
        type: 'fixed',
        reason: stopLossReason
    };

    // ========== 止盈逻辑 ==========
    const targets: TakeProfitTarget[] = [];

    // RSRS是均值回归策略，目标是回归到均值附近
    // T1: 达到预期回归点（约2-3%）
    const tp1Distance = entryPrice * 0.025;
    const tp1Price = direction === 'long'
        ? entryPrice + tp1Distance
        : entryPrice - tp1Distance;

    targets.push({
        price: roundPrice(tp1Price),
        percentage: 2.5,
        closePercentage: 100,
        reason: "RSRS回归至均值附近"
    });

    // 盈亏比（统计策略，胜率更重要）
    const riskRewardRatio = 2.5 / stopLossPercentage;

    const takeProfit: TakeProfit = {
        targets,
        riskRewardRatio: Math.round(riskRewardRatio * 10) / 10
    };

    // ========== 仓位计算 ==========
    let strategyBonus = 0;

    // R²拟合度加成
    const rsrsR2 = params.rsrsR2 || 0;
    if (rsrsR2 > 0.8) {
        strategyBonus += 5; // 高拟合度
    }

    const positionSizing = calculateOptimalPosition({
        confidence,
        accountBalance,
        riskPercentage,
        entryPrice,
        stopLoss: stopLossPrice,
        strategyBonus,
        // RSRS历史数据（示例）
        winRate: 0.68,
        avgWin: 2.5,
        avgLoss: 3.0
    });

    // 统计策略，保守杠杆
    positionSizing.leverage = Math.min(positionSizing.leverage, 2);

    // ========== 风控指标 ==========
    const riskAmount = positionSizing.maxRiskAmount;
    const potentialProfit = riskAmount * riskRewardRatio;

    return {
        stopLoss,
        takeProfit,
        positionSizing,
        metrics: {
            entryPrice: roundPrice(entryPrice),
            riskAmount: Math.round(riskAmount * 100) / 100,
            potentialProfit: Math.round(potentialProfit * 100) / 100,
            winRate: 0.68,
            expectedValue: Math.round((potentialProfit * 0.68 - riskAmount * 0.32) * 100) / 100
        }
    };
}
