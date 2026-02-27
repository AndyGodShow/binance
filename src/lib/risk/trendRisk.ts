/**
 * 趋势确认策略 - 风控逻辑
 * 特点：跟随型，趋势延续性强
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

export function calculateTrendRisk(params: RiskCalculationParams): RiskManagement {
    const {
        entryPrice,
        direction,
        confidence,
        atr,
        keltnerMid,
        keltnerUpper,
        keltnerLower,
        fundingRateTrend,
        accountBalance,
        riskPercentage = 1,
        bandwidthPercentile // 🔥 修复：添加解构
    } = params;

    // ========== 止损逻辑 ==========
    // 基于 KC 中轨（趋势反转的关键位置）
    // 动态波动率适应 (Regime Adaptation)
    let volatilityMultiplier = 1.0;
    let volatilityReason = "";

    if (bandwidthPercentile !== undefined) {
        if (bandwidthPercentile > 80) {
            volatilityMultiplier = 1.2; // 高波动，放宽止损防止插针
            volatilityReason = " (高波动宽止损)";
        } else if (bandwidthPercentile < 20) {
            volatilityMultiplier = 0.8; // 低波动，收紧止损
            volatilityReason = " (低波动紧止损)";
        }
    }

    const atrValue = (atr || entryPrice * 0.02) * volatilityMultiplier;
    let stopLossPrice: number;
    let stopLossReason: string;

    if (direction === 'long') {
        // 做多：止损设在 KC中轨 - 1.5×ATR (动态调整后)
        const kcStopLoss = keltnerMid
            ? keltnerMid - atrValue * 1.5
            : entryPrice - atrValue * 2;
        stopLossPrice = kcStopLoss;
        stopLossReason = (keltnerMid
            ? "价格回到KC中轨以下"
            : "2倍ATR") + volatilityReason;
    } else {
        // 做空：止损设在 KC中轨 + 1.5×ATR
        const kcStopLoss = keltnerMid
            ? keltnerMid + atrValue * 1.5
            : entryPrice + atrValue * 2;
        stopLossPrice = kcStopLoss;
        stopLossReason = (keltnerMid
            ? "价格回到KC中轨以上"
            : "2倍ATR") + volatilityReason;
    }

    const stopLossPercentage = Math.abs((stopLossPrice - entryPrice) / entryPrice) * 100;

    const stopLoss: StopLoss = {
        price: roundPrice(stopLossPrice),  // 🔥 动态精度
        percentage: roundPercentage(stopLossPercentage),
        type: 'trailing',
        reason: stopLossReason
    };

    // ========== 止盈逻辑 ==========
    const targets: TakeProfitTarget[] = [];

    // T1: 初步利润保护（6%）
    // 🔥 优化：从4%提升到6%，减少过早减仓，让利润奔跑
    const tp1Distance = entryPrice * 0.06;
    const tp1Price = direction === 'long'
        ? entryPrice + tp1Distance
        : entryPrice - tp1Distance;

    targets.push({
        price: roundPrice(tp1Price),  // 🔥 动态精度
        percentage: 6.0,
        closePercentage: 20, // 🔥 优化：从30%降到20%
        reason: "初步利润保护"
    });

    // T2: 跟随趋势，动态止盈
    // 如果有资金费率反转信号，作为止盈触发
    const tp2Distance = atrValue * 4;
    const tp2Price = direction === 'long'
        ? entryPrice + tp2Distance
        : entryPrice - tp2Distance;

    const tp2Reason = fundingRateTrend &&
        ((direction === 'long' && fundingRateTrend === 'down') ||
            (direction === 'short' && fundingRateTrend === 'up'))
        ? "资金费率趋势反转"
        : `达到4倍ATR目标`;

    targets.push({
        price: roundPrice(tp2Price),  // 🔥 动态精度
        percentage: roundPercentage((tp2Distance / entryPrice) * 100),
        closePercentage: 100,
        reason: tp2Reason
    });

    // 盈亏比
    const avgTpPercentage = targets.reduce((sum, t) =>
        sum + t.percentage * (t.closePercentage / 100), 0
    );
    const riskRewardRatio = avgTpPercentage / stopLossPercentage;

    const takeProfit: TakeProfit = {
        targets,
        riskRewardRatio: Math.round(riskRewardRatio * 10) / 10
    };

    // ========== 仓位计算 ==========
    let strategyBonus = 0;

    // Beta系数加成（独立于BTC的强势）
    const betaToBTC = params.betaToBTC || 1.0;
    if (betaToBTC > 1.2) {
        strategyBonus += 5; // 强于大盘
    }

    const positionSizing = calculateOptimalPosition({
        confidence,
        accountBalance,
        riskPercentage,
        entryPrice,
        stopLoss: stopLossPrice,
        strategyBonus,
        // 趋势确认历史数据（示例）
        winRate: 0.62,
        avgWin: 4.5,
        avgLoss: 2.0
    });

    // 趋势策略，可适度提高杠杆
    positionSizing.leverage = Math.min(positionSizing.leverage, 5);

    // ========== 风控指标 ==========
    const riskAmount = positionSizing.maxRiskAmount;
    const potentialProfit = riskAmount * riskRewardRatio;

    return {
        stopLoss,
        takeProfit,
        positionSizing,
        timeStop: { // 🔥 添加时间止损
            maxHoldBars: 10, // 趋势策略持有时间可以更长
            profitThreshold: 1.5 // 如果10根K线还没赚1.5%，平仓
        },
        metrics: {
            entryPrice,
            riskAmount: Math.round(riskAmount * 100) / 100,
            potentialProfit: Math.round(potentialProfit * 100) / 100,
            winRate: 0.62,
            expectedValue: Math.round((potentialProfit * 0.62 - riskAmount * 0.38) * 100) / 100
        }
    };
}
