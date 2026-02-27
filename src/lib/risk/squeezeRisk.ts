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
        keltnerUpper,
        keltnerLower,
        momentumColor,
        squeezeDuration = 0,
        bandwidthPercentile,
        adx,
        accountBalance,
        riskPercentage = 1
    } = params;

    // ========== 止损逻辑 ==========
    // 基于 KC 另一侧边缘（紧密止损）
    let stopLossPrice: number;
    let stopLossReason: string;

    if (direction === 'long') {
        stopLossPrice = keltnerLower || entryPrice * 0.985; // 后备：1.5%
        stopLossReason = keltnerLower
            ? "跌破KC下轨（突破失败）"
            : "固定1.5%止损";
    } else {
        stopLossPrice = keltnerUpper || entryPrice * 1.015;
        stopLossReason = keltnerUpper
            ? "涨破KC上轨（突破失败）"
            : "固定1.5%止损";
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

    // 目标1：动能减速（50%平仓）
    const isLongMomentumWeakening = direction === 'long' && momentumColor === 'blue';
    const isShortMomentumWeakening = direction === 'short' && momentumColor === 'yellow';

    if (isLongMomentumWeakening || isShortMomentumWeakening) {
        const tp1Price = direction === 'long'
            ? entryPrice * (1 + stopLossPercentage / 100 * 2) // 2倍止损距离
            : entryPrice * (1 - stopLossPercentage / 100 * 2);

        targets.push({
            price: roundPrice(tp1Price),
            percentage: roundPercentage(Math.abs((tp1Price - entryPrice) / entryPrice) * 100),
            closePercentage: 50,
            reason: "动能由加速转减速",
            moveStopToEntry: true
        });
    }

    // 目标2：基于挤压时长的预期利润
    const expectedProfitMultiplier = Math.min(5, 2 + squeezeDuration * 0.2); // 挤压越久，目标越高
    const tp2Price = direction === 'long'
        ? entryPrice * (1 + stopLossPercentage / 100 * expectedProfitMultiplier)
        : entryPrice * (1 - stopLossPercentage / 100 * expectedProfitMultiplier);

    targets.push({
        price: roundPrice(tp2Price),
        percentage: roundPercentage(Math.abs((tp2Price - entryPrice) / entryPrice) * 100),
        closePercentage: 100,
        reason: `达到${expectedProfitMultiplier.toFixed(1)}倍止损距离（蓄力${squeezeDuration}根）`
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

    if (squeezeDuration >= 15) {
        strategyBonus += 10; // 超长挤压
    } else if (squeezeDuration >= 10) {
        strategyBonus += 5;
    }

    // 严格挤压 + ADX 确认
    if (bandwidthPercentile && bandwidthPercentile < 10 && adx && adx > 20) {
        strategyBonus += 5;
    }

    const positionSizing = calculateOptimalPosition({
        confidence,
        accountBalance,
        riskPercentage,
        entryPrice,
        stopLoss: stopLossPrice,
        strategyBonus,
        // Squeeze 策略历史数据（示例）
        winRate: 0.65,
        avgWin: 5.5,
        avgLoss: 1.5
    });

    // 🔥 添加杠杆上限：Squeeze策略，高胜率，可用中等杠杆
    positionSizing.leverage = Math.min(positionSizing.leverage, 4);

    // ========== 风控指标 ==========
    const riskAmount = positionSizing.maxRiskAmount;
    const potentialProfit = riskAmount * riskRewardRatio;

    return {
        stopLoss,
        takeProfit,
        positionSizing,
        metrics: {
            entryPrice,
            riskAmount: Math.round(riskAmount * 100) / 100,
            potentialProfit: Math.round(potentialProfit * 100) / 100,
            winRate: 0.65,
            expectedValue: Math.round((potentialProfit * 0.65 - riskAmount * 0.35) * 100) / 100
        }
    };
}
