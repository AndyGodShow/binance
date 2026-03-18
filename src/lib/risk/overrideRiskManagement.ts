import { TickerData } from '@/lib/types';
import { roundPercentage, roundPrice } from './priceUtils';
import { getStrategyRiskConfig, StrategyRiskConfig } from './riskConfig';
import { RiskManagement, StopLoss, TakeProfitTarget } from './types';

interface RiskOverrideParams {
    strategyId: string;
    baseRisk: RiskManagement;
    overrideConfig?: Partial<StrategyRiskConfig> | StrategyRiskConfig | null;
    ticker: TickerData;
    direction: 'long' | 'short';
}

function isFiniteNumber(value: unknown): value is number {
    return typeof value === 'number' && Number.isFinite(value);
}

function priceFromPercentage(
    entryPrice: number,
    direction: 'long' | 'short',
    percentage: number,
    kind: 'stop' | 'target'
): number {
    const ratio = percentage / 100;

    if (direction === 'long') {
        return kind === 'stop'
            ? entryPrice * (1 - ratio)
            : entryPrice * (1 + ratio);
    }

    return kind === 'stop'
        ? entryPrice * (1 + ratio)
        : entryPrice * (1 - ratio);
}

function getIndicatorStopPrice(
    entryPrice: number,
    direction: 'long' | 'short',
    ticker: TickerData
): number | null {
    const longCandidates = [ticker.keltnerLower, ticker.bollingerLower, ticker.val, ticker.poc]
        .filter(isFiniteNumber)
        .filter((value) => value < entryPrice);
    const shortCandidates = [ticker.keltnerUpper, ticker.bollingerUpper, ticker.vah, ticker.poc]
        .filter(isFiniteNumber)
        .filter((value) => value > entryPrice);

    if (direction === 'long') {
        return longCandidates.length > 0 ? Math.max(...longCandidates) : null;
    }

    return shortCandidates.length > 0 ? Math.min(...shortCandidates) : null;
}

function buildTargetPrice(
    target: StrategyRiskConfig['takeProfit']['targets'][number],
    entryPrice: number,
    direction: 'long' | 'short',
    ticker: TickerData,
    stopLossPrice: number,
    fallbackTarget?: TakeProfitTarget
): number {
    const atrPercent = Number(ticker.atr || 0);
    const stopLossPercent = Math.abs((stopLossPrice - entryPrice) / entryPrice) * 100;

    if (isFiniteNumber(target.fixedPercentage) && target.fixedPercentage > 0) {
        return priceFromPercentage(entryPrice, direction, target.fixedPercentage, 'target');
    }

    if (isFiniteNumber(target.atrMultiplier) && target.atrMultiplier > 0 && atrPercent > 0) {
        return priceFromPercentage(entryPrice, direction, atrPercent * target.atrMultiplier, 'target');
    }

    if (isFiniteNumber(target.stopMultiplier) && target.stopMultiplier > 0 && stopLossPercent > 0) {
        return priceFromPercentage(entryPrice, direction, stopLossPercent * target.stopMultiplier, 'target');
    }

    if (fallbackTarget) {
        return fallbackTarget.price;
    }

    return priceFromPercentage(entryPrice, direction, 2, 'target');
}

export function applyRiskConfigOverrides({
    strategyId,
    baseRisk,
    overrideConfig,
    ticker,
    direction,
}: RiskOverrideParams): RiskManagement {
    const config = getStrategyRiskConfig(strategyId, overrideConfig || undefined);
    const entryPrice = Number(ticker.lastPrice);

    if (!Number.isFinite(entryPrice) || entryPrice <= 0) {
        return baseRisk;
    }

    const atrPercent = Number(ticker.atr || 0);
    let stopLossPrice = baseRisk.stopLoss.price;
    let stopLossReason = baseRisk.stopLoss.reason;
    let stopLossType: StopLoss['type'] = baseRisk.stopLoss.type;

    if (
        config.stopLoss.type === 'fixed' &&
        isFiniteNumber(config.stopLoss.fixedPercentage) &&
        config.stopLoss.fixedPercentage > 0
    ) {
        stopLossPrice = priceFromPercentage(entryPrice, direction, config.stopLoss.fixedPercentage, 'stop');
        stopLossReason = `面板固定止损 ${config.stopLoss.fixedPercentage}%`;
        stopLossType = 'fixed';
    } else if (
        (config.stopLoss.type === 'atr' || config.stopLoss.type === 'trailing') &&
        isFiniteNumber(config.stopLoss.atrMultiplier) &&
        config.stopLoss.atrMultiplier > 0 &&
        atrPercent > 0
    ) {
        stopLossPrice = priceFromPercentage(entryPrice, direction, atrPercent * config.stopLoss.atrMultiplier, 'stop');
        stopLossReason = `面板 ATR × ${config.stopLoss.atrMultiplier}`;
        stopLossType = config.stopLoss.type === 'trailing' ? 'trailing' : 'dynamic';
    } else if (config.stopLoss.type === 'indicator') {
        const indicatorStop = getIndicatorStopPrice(entryPrice, direction, ticker);
        if (indicatorStop !== null) {
            stopLossPrice = indicatorStop;
            stopLossReason = '面板技术指标止损';
            stopLossType = 'dynamic';
        }
    }

    let stopLossPercent = Math.abs((stopLossPrice - entryPrice) / entryPrice) * 100;
    if (
        isFiniteNumber(config.stopLoss.maxPercentage) &&
        config.stopLoss.maxPercentage > 0 &&
        stopLossPercent > config.stopLoss.maxPercentage
    ) {
        stopLossPrice = priceFromPercentage(entryPrice, direction, config.stopLoss.maxPercentage, 'stop');
        stopLossPercent = config.stopLoss.maxPercentage;
        stopLossReason = `${stopLossReason}（受上限约束）`;
    }

    const stopLoss: StopLoss = {
        price: roundPrice(stopLossPrice),
        percentage: roundPercentage(stopLossPercent),
        type: stopLossType,
        reason: stopLossReason,
    };

    const fallbackTargets = baseRisk.takeProfit.targets;
    const takeProfitTargets = config.takeProfit.targets.map((target, index) => {
        const fallbackTarget = fallbackTargets[Math.min(index, fallbackTargets.length - 1)];
        const targetPrice = buildTargetPrice(target, entryPrice, direction, ticker, stopLoss.price, fallbackTarget);
        const percentage = Math.abs((targetPrice - entryPrice) / entryPrice) * 100;

        return {
            price: roundPrice(targetPrice),
            percentage: roundPercentage(percentage),
            closePercentage: target.closePercentage,
            reason: target.fixedPercentage
                ? `面板固定止盈 ${target.fixedPercentage}%`
                : target.atrMultiplier
                    ? `面板 ATR × ${target.atrMultiplier}`
                    : target.stopMultiplier
                        ? `面板止损倍数 × ${target.stopMultiplier}`
                        : fallbackTarget?.reason || '面板止盈',
            moveStopToEntry: target.moveStopToEntry,
        };
    });

    const weightedTargetPercent = takeProfitTargets.reduce((sum, target) => {
        return sum + target.percentage * (target.closePercentage / 100);
    }, 0);

    return {
        ...baseRisk,
        stopLoss,
        takeProfit: {
            targets: takeProfitTargets,
            riskRewardRatio: stopLoss.percentage > 0
                ? roundPercentage(weightedTargetPercent / stopLoss.percentage)
                : baseRisk.takeProfit.riskRewardRatio,
        },
        positionSizing: {
            ...baseRisk.positionSizing,
            leverage: Math.min(baseRisk.positionSizing.leverage, config.maxLeverage),
        },
        timeStop: config.timeStop
            ? {
                maxHoldBars: config.timeStop.maxBars,
                profitThreshold: config.timeStop.profitThreshold,
            }
            : baseRisk.timeStop,
        metrics: {
            ...baseRisk.metrics,
            entryPrice,
        },
    };
}
