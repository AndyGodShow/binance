import type { RiskCalculationParams, RiskManagement } from './types.ts';
import { atrPercentToPriceDistance, roundPercentage, roundPrice } from './priceUtils.ts';

function clamp(value: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, value));
}

export function calculateWeiShenRisk(params: RiskCalculationParams): RiskManagement {
    const {
        entryPrice,
        direction,
        confidence,
        atr,
        accountBalance = 10000,
        riskPercentage = 0.6,
    } = params;

    const atrDistance = atrPercentToPriceDistance(entryPrice, atr, 1.6);
    const minStopDistance = entryPrice * 0.012;
    const maxStopDistance = entryPrice * 0.04;
    const stopDistance = clamp(atrDistance * 2.2, minStopDistance, maxStopDistance);
    const stopLossPrice = direction === 'long'
        ? entryPrice - stopDistance
        : entryPrice + stopDistance;
    const stopLossPercentage = Math.abs((stopLossPrice - entryPrice) / entryPrice) * 100;

    const firstTargetDistance = stopDistance * 1.6;
    const secondTargetDistance = stopDistance * 3.2;
    const tp1Price = direction === 'long'
        ? entryPrice + firstTargetDistance
        : entryPrice - firstTargetDistance;
    const tp2Price = direction === 'long'
        ? entryPrice + secondTargetDistance
        : entryPrice - secondTargetDistance;
    const tp1Percentage = Math.abs((tp1Price - entryPrice) / entryPrice) * 100;
    const tp2Percentage = Math.abs((tp2Price - entryPrice) / entryPrice) * 100;

    const maxRiskAmount = accountBalance * (riskPercentage / 100);
    const positionPercentage = confidence >= 88 ? 12 : confidence >= 84 ? 9 : 6;
    const leverage = confidence >= 88 ? 3 : 2;

    return {
        stopLoss: {
            price: roundPrice(stopLossPrice, entryPrice),
            percentage: roundPercentage(stopLossPercentage),
            type: 'fixed',
            reason: '魏神策略账本低胜率高赔率：2.2×ATR止损并限制最大4%',
        },
        takeProfit: {
            targets: [
                {
                    price: roundPrice(tp1Price, entryPrice),
                    percentage: roundPercentage(tp1Percentage),
                    closePercentage: 50,
                    moveStopToEntry: true,
                    reason: '1.6R先落袋，降低低胜率路径波动',
                },
                {
                    price: roundPrice(tp2Price, entryPrice),
                    percentage: roundPercentage(tp2Percentage),
                    closePercentage: 100,
                    reason: '3.2R保留账本大波段尾部收益',
                },
            ],
            riskRewardRatio: 2.4,
        },
        positionSizing: {
            percentage: positionPercentage,
            leverage,
            maxRiskAmount: Math.round(maxRiskAmount * 100) / 100,
            confidence,
            reasoning: '魏神策略账本低胜率高赔率：小仓位、长尾赔率、亏损后靠风控限制',
        },
        metrics: {
            entryPrice,
            riskAmount: Math.round(maxRiskAmount * 100) / 100,
            potentialProfit: Math.round(maxRiskAmount * 2.4 * 100) / 100,
        },
        timeStop: {
            maxHoldBars: 36,
            profitThreshold: 0.6,
        },
    };
}
