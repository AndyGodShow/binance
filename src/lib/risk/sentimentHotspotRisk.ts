/**
 * 情绪热点策略 - 风控逻辑
 * 特点：只做多、题材/热度驱动，必须防止追高后热度衰减。
 */

import type {
    RiskManagement,
    RiskCalculationParams,
    StopLoss,
    TakeProfit,
    TakeProfitTarget,
} from './types.ts';
import { calculateOptimalPosition } from './positionSizer.ts';
import { atrPercentToPriceDistance, roundPercentage, roundPrice } from './priceUtils.ts';

function buildTarget(
    entryPrice: number,
    direction: 'long' | 'short',
    stopLossPercentage: number,
    multiplier: number,
    closePercentage: number,
    reason: string,
    moveStopToEntry = false,
): TakeProfitTarget {
    const targetDistancePercent = stopLossPercentage * multiplier;
    const price = direction === 'long'
        ? entryPrice * (1 + targetDistancePercent / 100)
        : entryPrice * (1 - targetDistancePercent / 100);

    return {
        price: roundPrice(price),
        percentage: roundPercentage(Math.abs((price - entryPrice) / entryPrice) * 100),
        closePercentage,
        reason,
        moveStopToEntry,
    };
}

export function calculateSentimentHotspotRisk(params: RiskCalculationParams): RiskManagement {
    const {
        entryPrice,
        direction,
        confidence,
        atr,
        keltnerLower,
        keltnerUpper,
        bollingerMid,
        accountBalance,
        riskPercentage = 0.8,
    } = params;

    const atrValue = atrPercentToPriceDistance(entryPrice, atr);
    const fallbackDistance = atrValue > 0 ? atrValue * 1.6 : entryPrice * 0.025;
    const rawStopLossPrice = direction === 'long'
        ? Math.max(
            keltnerLower && keltnerLower < entryPrice ? keltnerLower : -Infinity,
            bollingerMid && bollingerMid < entryPrice ? bollingerMid : -Infinity,
            entryPrice - fallbackDistance,
        )
        : Math.min(
            keltnerUpper && keltnerUpper > entryPrice ? keltnerUpper : Infinity,
            bollingerMid && bollingerMid > entryPrice ? bollingerMid : Infinity,
            entryPrice + fallbackDistance,
        );

    const cappedStopLossPrice = direction === 'long'
        ? Math.max(rawStopLossPrice, entryPrice * 0.96)
        : Math.min(rawStopLossPrice, entryPrice * 1.04);
    const stopLossPercentage = Math.abs((cappedStopLossPrice - entryPrice) / entryPrice) * 100;
    const capReason = rawStopLossPrice !== cappedStopLossPrice ? '，受4%热点回撤上限约束' : '';

    const stopLoss: StopLoss = {
        price: roundPrice(cappedStopLossPrice),
        percentage: roundPercentage(stopLossPercentage),
        type: 'dynamic',
        reason: `情绪热点启动区/通道结构失效${capReason}`,
    };

    const oiChangePercent = params.oiChangePercent ?? 0;
    const volumeChangePercent = params.volumeChangePercent ?? 0;
    const extensionMultiplier = oiChangePercent >= 16 && volumeChangePercent >= 20 ? 4.8 : 4.2;

    const targets: TakeProfitTarget[] = [
        buildTarget(entryPrice, direction, stopLoss.percentage, 1.4, 35, '热点启动首段兑现，触发后抬止损到保本', true),
        buildTarget(entryPrice, direction, stopLoss.percentage, 2.4, 35, 'OI和成交延续后的第二段兑现'),
        buildTarget(entryPrice, direction, stopLoss.percentage, extensionMultiplier, 30, '尾仓跟随热度扩散，防止过早卖飞'),
    ];

    const weightedTargetPercent = targets.reduce((sum, target) => (
        sum + target.percentage * (target.closePercentage / 100)
    ), 0);
    const riskRewardRatio = stopLoss.percentage > 0 ? weightedTargetPercent / stopLoss.percentage : 0;

    const takeProfit: TakeProfit = {
        targets,
        riskRewardRatio: Math.round(riskRewardRatio * 10) / 10,
    };

    let strategyBonus = 0;
    if (oiChangePercent >= 12) {
        strategyBonus += 3;
    }
    if (volumeChangePercent >= 20) {
        strategyBonus += 3;
    }

    const positionSizing = calculateOptimalPosition({
        confidence,
        accountBalance,
        riskPercentage,
        entryPrice,
        stopLoss: cappedStopLossPrice,
        strategyBonus,
        winRate: 0.5,
        avgWin: 4.2,
        avgLoss: 2.2,
    });
    positionSizing.leverage = Math.min(positionSizing.leverage, 2);

    const riskAmount = positionSizing.maxRiskAmount;
    const potentialProfit = riskAmount * riskRewardRatio;

    return {
        stopLoss,
        takeProfit,
        positionSizing,
        timeStop: {
            maxHoldBars: 4,
            profitThreshold: 2,
        },
        metrics: {
            entryPrice: roundPrice(entryPrice),
            riskAmount: Math.round(riskAmount * 100) / 100,
            potentialProfit: Math.round(potentialProfit * 100) / 100,
            winRate: 0.5,
            expectedValue: Math.round((potentialProfit * 0.5 - riskAmount * 0.5) * 100) / 100,
        },
    };
}
