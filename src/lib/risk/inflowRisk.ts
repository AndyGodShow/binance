/**
 * 资金流入策略 - 风控逻辑
 * 特点：量价配合，短线爆发
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

export function calculateInflowRisk(params: RiskCalculationParams): RiskManagement {
    const {
        entryPrice,
        direction,
        confidence,
        atr,
        vah,
        val,
        poc,
        cvdSlope,
        accountBalance,
        riskPercentage = 1
    } = params;

    // ========== 止损逻辑 ==========
    // 基于 Volume Profile (POC/VAL)
    const atrValue = atrPercentToPriceDistance(entryPrice, atr);
    let stopLossPrice: number;
    let stopLossReason: string;

    if (direction === 'long') {
        // 做多：止损设在 POC 或 VAL（取较低的支撑位）
        if (poc && val) {
            stopLossPrice = Math.min(poc, val); // 🔥 修复：取较低的支撑
            stopLossReason = "跌破成交密集区POC/VAL";
        } else {
            stopLossPrice = entryPrice - atrValue * 2;
            stopLossReason = "2倍ATR";
        }
    } else {
        // 做空：止损设在 POC 或 VAH（取较高的阻力位）
        if (poc && vah) {
            stopLossPrice = Math.max(poc, vah); // 🔥 修复：取较高的阻力
            stopLossReason = "突破成交密集区POC/VAH";
        } else {
            stopLossPrice = entryPrice + atrValue * 2;
            stopLossReason = "2倍ATR";
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

    // T1: 突破VAH后延伸（短线快速获利）
    if (vah && poc) {
        const vahExtension = (vah - poc) * 0.5;
        const tp1Price = direction === 'long'
            ? entryPrice + vahExtension
            : entryPrice - vahExtension;

        targets.push({
            price: roundPrice(tp1Price),
            percentage: roundPercentage((vahExtension / entryPrice) * 100),
            closePercentage: 50,
            reason: "突破VAH后延伸50%"
        });
    } else {
        // 降级为ATR
        const tp1Price = direction === 'long'
            ? entryPrice + atrValue * 2.5
            : entryPrice - atrValue * 2.5;

        targets.push({
            price: roundPrice(tp1Price),
            percentage: roundPercentage((atrValue * 2.5 / entryPrice) * 100),
            closePercentage: 50,
            reason: "2.5倍ATR目标"
        });
    }

    // T2: CVD衰减止盈（买盘力量衰竭）
    const tp2Distance = atrValue * 3.5;
    const tp2Price = direction === 'long'
        ? entryPrice + tp2Distance
        : entryPrice - tp2Distance;

    const tp2Reason = cvdSlope !== undefined && cvdSlope < 0
        ? "买盘力量衰竭"
        : "达到3.5倍ATR目标";

    targets.push({
        price: roundPrice(tp2Price),
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

    // 高换手率加成
    const turnoverRatio = params.turnoverRatio || 0;
    if (turnoverRatio > 3.5) {
        strategyBonus += 5; // 新资金识别
    }

    const positionSizing = calculateOptimalPosition({
        confidence,
        accountBalance,
        riskPercentage,
        entryPrice,
        stopLoss: stopLossPrice,
        strategyBonus,
        // 资金流入历史数据（示例）
        winRate: 0.58,
        avgWin: 3.5,
        avgLoss: 2.0
    });

    // 短线策略，中等杠杆
    positionSizing.leverage = Math.min(positionSizing.leverage, 3);

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
            winRate: 0.58,
            expectedValue: Math.round((potentialProfit * 0.58 - riskAmount * 0.42) * 100) / 100
        }
    };
}
