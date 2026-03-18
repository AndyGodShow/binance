/**
 * 强势突破策略 - 风控逻辑
 * 特点：追涨型，需要严格止损
 */

import {
    RiskManagement,
    RiskCalculationParams,
    StopLoss,
    TakeProfit,
    TakeProfitTarget
} from './types';
import { calculateOptimalPosition } from './positionSizer';
import { atrPercentToPriceDistance, roundPrice, roundPercentage } from './priceUtils';

export function calculateBreakoutRisk(params: RiskCalculationParams): RiskManagement {
    const {
        entryPrice,
        direction,
        confidence,
        atr,
        keltnerLower,
        keltnerUpper,
        accountBalance,
        riskPercentage = 1
    } = params;

    // ========== 止损逻辑 ==========
    // 基于 ATR 或 KC 下轨
    const atrValue = atrPercentToPriceDistance(entryPrice, atr); // atr 为百分比口径
    let stopLossPrice: number;
    let stopLossReason: string;

    if (direction === 'long') {
        // 做多：止损设在 (入场价 - 1.5×ATR) 或 KC下轨
        // 🔥 优化：追涨策略应快速止损，从2.5改为1.5
        const atrStopLoss = entryPrice - atrValue * 1.5;
        stopLossPrice = keltnerLower
            ? Math.max(atrStopLoss, keltnerLower)
            : atrStopLoss;
        stopLossReason = keltnerLower
            ? "1.5倍ATR或KC下轨（取较高者）"
            : "1.5倍ATR";
    } else {
        // 做空：止损设在 (入场价 + 1.5×ATR) 或 KC上轨
        const atrStopLoss = entryPrice + atrValue * 1.5;
        stopLossPrice = keltnerUpper
            ? Math.min(atrStopLoss, keltnerUpper)
            : atrStopLoss;
        stopLossReason = keltnerUpper
            ? "1.5倍ATR或KC上轨（取较低者）"
            : "1.5倍ATR";
    }

    const stopLossPercentage = Math.abs((stopLossPrice - entryPrice) / entryPrice) * 100;

    const stopLoss: StopLoss = {
        price: roundPrice(stopLossPrice),  // 🔥 动态精度
        percentage: roundPercentage(stopLossPercentage),
        type: 'fixed',
        reason: stopLossReason
    };

    // ========== 止盈逻辑 ==========
    // 阶梯式止盈：T1（50%）、T2（100%）
    const targets: TakeProfitTarget[] = [];

    // T1: 3倍ATR（部分获利）
    const tp1Distance = atrValue * 3;
    const tp1Price = direction === 'long'
        ? entryPrice + tp1Distance
        : entryPrice - tp1Distance;

    targets.push({
        price: roundPrice(tp1Price),  // 🔥 动态精度
        percentage: roundPercentage((tp1Distance / entryPrice) * 100),
        closePercentage: 50,
        reason: "达到3倍ATR，减仓保护利润"
    });

    // T2: 5倍ATR（全部平仓）
    const tp2Distance = atrValue * 5;
    const tp2Price = direction === 'long'
        ? entryPrice + tp2Distance
        : entryPrice - tp2Distance;

    targets.push({
        price: roundPrice(tp2Price),  // 🔥 动态精度
        percentage: roundPercentage((tp2Distance / entryPrice) * 100),
        closePercentage: 100,
        reason: "达到5倍ATR目标"
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
    // 追涨型策略，保守仓位
    let strategyBonus = 0;

    // OI集中度加成
    const oiChangePercent = params.oiChangePercent || 0;
    const volumeChangePercent = params.volumeChangePercent || 0;
    if (oiChangePercent > 10 && volumeChangePercent > 5) {
        strategyBonus += 5; // 大资金布局
    }

    const positionSizing = calculateOptimalPosition({
        confidence,
        accountBalance,
        riskPercentage,
        entryPrice,
        stopLoss: stopLossPrice,
        strategyBonus,
        // 强势突破历史数据（示例）
        winRate: 0.55,
        avgWin: 4.0,
        avgLoss: 2.5
    });

    // 追涨型策略，降低杠杆
    positionSizing.leverage = Math.min(positionSizing.leverage, 3);

    // ========== 风控指标 ==========
    const riskAmount = positionSizing.maxRiskAmount;
    const potentialProfit = riskAmount * riskRewardRatio;

    return {
        stopLoss,
        takeProfit,
        positionSizing,
        timeStop: {
            maxHoldBars: 5,
            profitThreshold: 1.0
        },
        metrics: {
            entryPrice,
            riskAmount: roundPercentage(riskAmount),
            potentialProfit: roundPercentage(potentialProfit),
            winRate: 0.55,
            expectedValue: Math.round((potentialProfit * 0.55 - riskAmount * 0.45) * 100) / 100
        }
    };
}
