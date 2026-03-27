/**
 * 波动率挤压策略 - 风控逻辑
 * 特点：狙击型入场，极高盈亏比
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

export function calculateSqueezeRisk(params: RiskCalculationParams): RiskManagement {
    const {
        entryPrice,
        direction,
        confidence,
        atr,
        keltnerUpper,
        keltnerLower,
        squeezeDuration = 0,
        bandwidthPercentile,
        adx,
        accountBalance,
        riskPercentage = 1
    } = params;

    // ========== 止损逻辑 ==========
    // 高质量版本：优先使用 KC 另一侧，超限则退回 ATR 后备。
    let stopLossPrice: number;
    let stopLossReason: string;
    const atrDistance = atr && atr > 0 ? entryPrice * (atr / 100) * 1.5 : 0;

    if (direction === 'long') {
        stopLossPrice = keltnerLower || (atrDistance > 0 ? entryPrice - atrDistance : entryPrice * 0.985);
        stopLossReason = keltnerLower
            ? "跌回KC下轨下方（突破失效）"
            : atrDistance > 0
                ? "1.5ATR 后备止损"
                : "固定1.5%止损";
    } else {
        stopLossPrice = keltnerUpper || (atrDistance > 0 ? entryPrice + atrDistance : entryPrice * 1.015);
        stopLossReason = keltnerUpper
            ? "涨回KC上轨上方（突破失效）"
            : atrDistance > 0
                ? "1.5ATR 后备止损"
                : "固定1.5%止损";
    }

    let stopLossPercentage = Math.abs((stopLossPrice - entryPrice) / entryPrice) * 100;
    if (stopLossPercentage > 2.5) {
        stopLossPrice = direction === 'long'
            ? entryPrice * (1 - 0.025)
            : entryPrice * (1 + 0.025);
        stopLossPercentage = 2.5;
        stopLossReason += "（受2.5%上限约束）";
    }

    const stopLoss: StopLoss = {
        price: roundPrice(stopLossPrice),
        percentage: roundPercentage(stopLossPercentage),
        type: 'fixed',
        reason: stopLossReason
    };

    // ========== 止盈逻辑 ==========
    const targets: TakeProfitTarget[] = [];

    const tp1Price = direction === 'long'
        ? entryPrice * (1 + stopLossPercentage / 100 * 2.0)
        : entryPrice * (1 - stopLossPercentage / 100 * 2.0);

    targets.push({
        price: roundPrice(tp1Price),
        percentage: roundPercentage(Math.abs((tp1Price - entryPrice) / entryPrice) * 100),
        closePercentage: 40,
        reason: "首段突破兑现 2.0R",
        moveStopToEntry: true
    });

    const tp2Multiplier = 3.5;
    const tp2Price = direction === 'long'
        ? entryPrice * (1 + stopLossPercentage / 100 * tp2Multiplier)
        : entryPrice * (1 - stopLossPercentage / 100 * tp2Multiplier);
    targets.push({
        price: roundPrice(tp2Price),
        percentage: roundPercentage(Math.abs((tp2Price - entryPrice) / entryPrice) * 100),
        closePercentage: 30,
        reason: `趋势延续目标 ${tp2Multiplier.toFixed(1)}R（蓄力${squeezeDuration}根）`
    });

    const tp3Multiplier = 5.0;
    const tp3Price = direction === 'long'
        ? entryPrice * (1 + stopLossPercentage / 100 * tp3Multiplier)
        : entryPrice * (1 - stopLossPercentage / 100 * tp3Multiplier);
    targets.push({
        price: roundPrice(tp3Price),
        percentage: roundPercentage(Math.abs((tp3Price - entryPrice) / entryPrice) * 100),
        closePercentage: 30,
        reason: "尾仓趋势跟随目标 5.0R"
    });

    // 计算盈亏比
    const avgTpPercentage = targets.reduce((sum, t) =>
        sum + t.percentage * (t.closePercentage / 100), 0
    );
    const riskRewardRatio = avgTpPercentage / stopLossPercentage;

    const takeProfit: TakeProfit = {
        targets,
        riskRewardRatio: Math.round(riskRewardRatio * 10) / 10
    };

    // ========== 仓位计算 ==========
    // 基于挤压时长
    let strategyBonus = 0;

    if (squeezeDuration >= 16) {
        strategyBonus += 6;
    } else if (squeezeDuration >= 12) {
        strategyBonus += 4;
    } else if (squeezeDuration >= 10) {
        strategyBonus += 2;
    }

    if (confidence >= 90) {
        strategyBonus += 5;
    }

    // 严格挤压 + ADX 确认
    if (bandwidthPercentile && bandwidthPercentile < 8 && adx && adx >= 25) {
        strategyBonus += 4;
    }

    const positionSizing = calculateOptimalPosition({
        confidence,
        accountBalance,
        riskPercentage,
        entryPrice,
        stopLoss: stopLossPrice,
        strategyBonus,
        winRate: 0.58,
        avgWin: 4.8,
        avgLoss: 1.7
    });

    // 高质量首段启动，依然以保守杠杆为主
    positionSizing.leverage = Math.min(positionSizing.leverage, 3);

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
            winRate: 0.58,
            expectedValue: Math.round((potentialProfit * 0.58 - riskAmount * 0.42) * 100) / 100
        },
        timeStop: {
            maxHoldBars: 10,
            profitThreshold: 0.8
        }
    };
}
