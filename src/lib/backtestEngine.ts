import type { KlineData } from '../app/api/backtest/klines/route.ts';
import type { TickerData } from './types.ts';
import type { RiskManagement } from './risk/types.ts';
import { TechnicalIndicators } from './technicalIndicators.ts';
import { BacktestExecutionProvider } from './backtestExecutionProvider.ts';
import {
    adaptKlinesToBacktestDataSlice,
    type FundingPoint,
    type MarketBar,
} from './backtestDataAdapter.ts';
import { calculateBacktestMetrics } from './backtestMetrics.ts';

/**
 * 回测结果接口
 */
export type {
    BacktestConfig,
    BacktestResult,
    EquityPoint,
    Trade,
} from './backtestEngineTypes.ts';
import type {
    BacktestConfig,
    BacktestPosition,
    BacktestResult,
    EquityPoint,
    PendingBacktestEntry,
    StrategyResult,
    Trade,
    TradeSettlement,
} from './backtestEngineTypes.ts';



import {
    isMoreProtectiveStop,
    computeDynamicTrailStop,
} from './backtestExecutionMath.ts';



export interface BacktestRunInput {
    signalKlines: KlineData[];
    strategyDetector: StrategyDetector;
    strategyName: string;
    symbol: string;
    signalInterval: string;
    executionInterval?: string;
    simulationEndTime?: number;
    fetchExecutionKlines?: (startTime: number, endTime: number) => Promise<KlineData[]>;
}

/**
 * 策略检测函数类型
 */
type StrategyDetector = (ticker: TickerData) => StrategyResult | null;

/**
 * 回测引擎类
 */
export class BacktestEngine {
    private config: BacktestConfig;

    constructor(config: Partial<BacktestConfig> = {}) {
        this.config = {
            initialCapital: config.initialCapital ?? 10000,
            commission: config.commission ?? 0.04,
            slippage: config.slippage ?? 0.05,
            useStrategyRiskManagement: config.useStrategyRiskManagement ?? true,
        };
    }

    private runWithMockedNow<T>(timestamp: number, task: () => T): T {
        const realDateNow = Date.now;
        Date.now = () => timestamp;
        try {
            return task();
        } finally {
            Date.now = realDateNow;
        }
    }

    private calculateProfitPercent(
        entryPrice: number,
        exitPrice: number,
        direction: 'long' | 'short'
    ): number {
        if (direction === 'long') {
            return ((exitPrice - entryPrice) / entryPrice) * 100;
        }
        return ((entryPrice - exitPrice) / entryPrice) * 100;
    }

    private calculateMarkToMarketEquity(
        cash: number,
        currentPosition: {
            direction: 'long' | 'short';
            entryPrice: number;
            entryCapital: number;
            margin: number;
            qty: number;
            initialSize: number;
            remainingSize: number;
        } | null,
        currentPrice: number
    ): number {
        if (!currentPosition || currentPosition.remainingSize <= 0.0001) {
            return cash;
        }

        const remainingRatio = currentPosition.initialSize > 0
            ? currentPosition.remainingSize / currentPosition.initialSize
            : 0;
        const remainingQty = currentPosition.qty * remainingRatio;
        const marginValue = currentPosition.margin * remainingRatio;
        const pricePnl = currentPosition.direction === 'long'
            ? (currentPrice - currentPosition.entryPrice) * remainingQty
            : (currentPosition.entryPrice - currentPrice) * remainingQty;
        const exitNotional = Math.abs(currentPrice * remainingQty);
        const estimatedExitCosts = exitNotional * ((this.config.commission + this.config.slippage) / 100);
        const positionValue = marginValue + pricePnl - estimatedExitCosts;

        return cash + positionValue;
    }

    private calculateFundingCashflow(position: BacktestPosition, fundingRate: number): number {
        if (!Number.isFinite(fundingRate) || fundingRate === 0 || position.remainingSize <= 0.0001) {
            return 0;
        }

        const remainingRatio = position.initialSize > 0
            ? position.remainingSize / position.initialSize
            : 0;
        const notional = position.notional * remainingRatio;
        const directionalMultiplier = position.direction === 'long' ? -1 : 1;
        return directionalMultiplier * notional * fundingRate;
    }

    private cloneRiskForEntry(
        risk: RiskManagement | undefined,
        entryPrice: number,
        direction: 'long' | 'short'
    ): RiskManagement | undefined {
        if (!risk) {
            return undefined;
        }

        const cloned = JSON.parse(JSON.stringify(risk)) as RiskManagement;
        cloned.metrics.entryPrice = entryPrice;

        const stopLossDistance = cloned.stopLoss.percentage / 100;
        cloned.stopLoss.price = direction === 'long'
            ? entryPrice * (1 - stopLossDistance)
            : entryPrice * (1 + stopLossDistance);

        cloned.takeProfit.targets = cloned.takeProfit.targets.map((target) => {
            const targetDistance = target.percentage / 100;
            return {
                ...target,
                price: direction === 'long'
                    ? entryPrice * (1 + targetDistance)
                    : entryPrice * (1 - targetDistance),
            };
        });

        if (
            cloned.dynamicExit &&
            cloned.dynamicExit.invalidationPrice &&
            risk.metrics.entryPrice > 0
        ) {
            const invalidationRatio = cloned.dynamicExit.invalidationPrice / risk.metrics.entryPrice;
            cloned.dynamicExit.invalidationPrice = entryPrice * invalidationRatio;
        }

        return cloned;
    }

    private recordTrade(
        trades: Trade[],
        position: BacktestPosition,
        symbol: string,
        exitTime: number,
        exitPrice: number,
        size: number,
        exitReason: Trade['exitReason']
    ): TradeSettlement {
        const normalizedSize = Math.min(size, position.remainingSize);
        const sizeRatio = position.initialSize > 0 ? normalizedSize / position.initialSize : 0;
        const margin = position.margin * sizeRatio;
        const qty = position.qty * sizeRatio;
        const entryNotional = Math.abs(position.entryPrice * qty);
        const exitNotional = Math.abs(exitPrice * qty);
        const notional = entryNotional;
        const pricePnl = position.direction === 'long'
            ? (exitPrice - position.entryPrice) * qty
            : (position.entryPrice - exitPrice) * qty;
        const fee = (entryNotional + exitNotional) * (this.config.commission / 100);
        const slippageCost = (entryNotional + exitNotional) * (this.config.slippage / 100);
        const funding = position.accruedFunding * sizeRatio;
        const pnl = pricePnl + funding - fee - slippageCost;
        const finalProfitPercent = margin > 0 ? (pnl / margin) * 100 : 0;
        const profitUSDT = pnl;

        trades.push({
            symbol,
            entryTime: position.entryTime,
            exitTime,
            entryPrice: position.entryPrice,
            exitPrice,
            direction: position.direction,
            size: normalizedSize,
            profit: finalProfitPercent,
            profitUSDT,
            qty,
            margin,
            notional,
            fee,
            slippageCost,
            funding,
            pnl,
            pnlPct: finalProfitPercent,
            holdingTime: exitTime - position.entryTime,
            exitReason,
            strategyRiskPct: position.risk?.metrics.riskAmount && position.entryCapital > 0
                ? (position.risk.metrics.riskAmount / position.entryCapital) * 100
                : undefined,
            plannedPositionPct: position.initialSize * 100,
            stopLossPct: position.risk?.stopLoss.percentage,
        });
        position.accruedFunding -= funding;

        return {
            capitalReturned: margin + profitUSDT,
            profitUSDT,
        };
    }

    private getIntervalMs(interval: string): number | null {
        const match = interval.match(/^(\d+)(m|h|d|w|M)$/);
        if (!match) {
            return null;
        }

        const value = Number.parseInt(match[1], 10);
        if (!Number.isFinite(value) || value <= 0) {
            return null;
        }

        const unit = match[2];
        switch (unit) {
            case 'm':
                return value * 60 * 1000;
            case 'h':
                return value * 60 * 60 * 1000;
            case 'd':
                return value * 24 * 60 * 60 * 1000;
            case 'w':
                return value * 7 * 24 * 60 * 60 * 1000;
            case 'M':
                return value * 30 * 24 * 60 * 60 * 1000;
            default:
                return null;
        }
    }

    private aggregateTradeLegs(tradeLegs: Trade[]): Trade[] {
        const groups = new Map<string, Trade[]>();

        tradeLegs.forEach((trade) => {
            const key = [
                trade.symbol ?? '',
                trade.entryTime,
                trade.direction,
                trade.entryPrice,
            ].join(':');

            const existing = groups.get(key) || [];
            existing.push(trade);
            groups.set(key, existing);
        });

        return Array.from(groups.values())
            .map((legs) => {
                const orderedLegs = [...legs].sort((a, b) => a.exitTime - b.exitTime);
                const firstLeg = orderedLegs[0];
                const lastLeg = orderedLegs[orderedLegs.length - 1];
                const totalSize = orderedLegs.reduce((sum, leg) => sum + leg.size, 0);
                const weightedProfit = totalSize > 0
                    ? orderedLegs.reduce((sum, leg) => sum + (leg.profit * leg.size), 0) / totalSize
                    : 0;
                const weightedExitPrice = totalSize > 0
                    ? orderedLegs.reduce((sum, leg) => sum + (leg.exitPrice * leg.size), 0) / totalSize
                    : lastLeg.exitPrice;
                const totalProfitUsdt = orderedLegs.reduce((sum, leg) => sum + leg.profitUSDT, 0);
                const totalMargin = orderedLegs.reduce((sum, leg) => sum + (leg.margin ?? 0), 0);
                const totalQty = orderedLegs.reduce((sum, leg) => sum + (leg.qty ?? 0), 0);
                const totalNotional = orderedLegs.reduce((sum, leg) => sum + (leg.notional ?? 0), 0);
                const totalFee = orderedLegs.reduce((sum, leg) => sum + (leg.fee ?? 0), 0);
                const totalSlippageCost = orderedLegs.reduce((sum, leg) => sum + (leg.slippageCost ?? 0), 0);
                const totalFunding = orderedLegs.reduce((sum, leg) => sum + (leg.funding ?? 0), 0);

                return {
                    symbol: firstLeg.symbol,
                    entryTime: firstLeg.entryTime,
                    exitTime: lastLeg.exitTime,
                    entryPrice: firstLeg.entryPrice,
                    exitPrice: weightedExitPrice,
                    direction: firstLeg.direction,
                    size: totalSize > 0 ? totalSize : 1,
                    profit: weightedProfit,
                    profitUSDT: totalProfitUsdt,
                    qty: totalQty,
                    margin: totalMargin,
                    notional: totalNotional,
                    fee: totalFee,
                    slippageCost: totalSlippageCost,
                    funding: totalFunding,
                    pnl: totalProfitUsdt,
                    pnlPct: totalMargin > 0 ? (totalProfitUsdt / totalMargin) * 100 : weightedProfit,
                    holdingTime: lastLeg.exitTime - firstLeg.entryTime,
                    exitReason: lastLeg.exitReason,
                    strategyRiskPct: firstLeg.strategyRiskPct,
                    plannedPositionPct: firstLeg.plannedPositionPct,
                    stopLossPct: firstLeg.stopLossPct,
                };
            })
            .sort((a, b) => a.entryTime - b.entryTime);
    }

    private cloneRiskManagement(risk?: RiskManagement): RiskManagement | undefined {
        return risk ? JSON.parse(JSON.stringify(risk)) as RiskManagement : undefined;
    }

    private assertExecutionBarsAvailable(params: {
        bars: MarketBar[];
        symbol: string;
        executionInterval: string;
        startExclusive: number;
        endInclusive: number;
        currentPosition: BacktestPosition | null;
        pendingEntry: PendingBacktestEntry | null;
        pendingExitReason: Trade['exitReason'] | null;
    }) {
        if (
            params.bars.length > 0 ||
            (!params.currentPosition && !params.pendingEntry && !params.pendingExitReason)
        ) {
            return;
        }

        throw new Error(
            `执行层K线缺失：${params.symbol} ${params.executionInterval} ` +
            `${new Date(params.startExclusive).toISOString()} - ${new Date(params.endInclusive).toISOString()}`
        );
    }

    private processExecutionBars(params: {
        bars: MarketBar[];
        fundingByTime: Map<number, FundingPoint>;
        currentPosition: BacktestPosition | null;
        pendingEntry: PendingBacktestEntry | null;
        pendingExitReason: Trade['exitReason'] | null;
        tradeLegs: Trade[];
        symbol: string;
        cash: number;
        signalIntervalMs: number | null;
        executionIntervalMs: number;
        isFinalSegment: boolean;
        fallbackExitTime: number;
        fallbackExitPrice: number;
    }): {
        currentPosition: BacktestPosition | null;
        pendingEntry: PendingBacktestEntry | null;
        pendingExitReason: Trade['exitReason'] | null;
        cash: number;
        lastProcessedTime: number;
        lastProcessedPrice: number;
    } {
        const {
            bars,
            fundingByTime,
            tradeLegs,
            symbol,
            signalIntervalMs,
            executionIntervalMs,
            isFinalSegment,
            fallbackExitTime,
            fallbackExitPrice,
        } = params;

        let {
            currentPosition,
            pendingEntry,
            pendingExitReason,
            cash,
        } = params;

        let lastProcessedTime = fallbackExitTime;
        let lastProcessedPrice = fallbackExitPrice;

        for (let index = 0; index < bars.length; index++) {
            const bar = bars[index];
            const currentOpen = bar.open;
            const currentClose = bar.close;
            const currentHigh = bar.high;
            const currentLow = bar.low;
            const barOpenTime = bar.time - executionIntervalMs + 1;
            const hasNextBar = index < bars.length - 1;

            if (pendingExitReason && currentPosition && Number.isFinite(currentOpen)) {
                const settlement = this.recordTrade(
                    tradeLegs,
                    currentPosition,
                    symbol,
                    barOpenTime,
                    currentOpen,
                    currentPosition.remainingSize,
                    pendingExitReason
                );
                cash += settlement.capitalReturned;
                currentPosition = null;
            }
            pendingExitReason = null;

            if (pendingEntry && !currentPosition && Number.isFinite(currentOpen) && cash > 0) {
                const desiredPositionSize = Math.max(
                    0,
                    Math.min(1, (pendingEntry.risk?.positionSizing.percentage ?? 100) / 100)
                );

                if (desiredPositionSize <= 0.0001) {
                    pendingEntry = null;
                    continue;
                }

                const entryCapital = cash;
                const leverage = Math.max(1, pendingEntry.risk?.positionSizing.leverage ?? 1);
                const margin = entryCapital * desiredPositionSize;
                const notional = margin * leverage;
                const qty = currentOpen > 0 ? notional / currentOpen : 0;
                currentPosition = {
                    direction: pendingEntry.direction,
                    entryPrice: currentOpen,
                    entryTime: barOpenTime,
                    entryCapital,
                    margin,
                    notional,
                    qty,
                    leverage,
                    accruedFunding: 0,
                    signalEntryTime: pendingEntry.signalTime,
                    entryIndex: index,
                    risk: this.cloneRiskForEntry(pendingEntry.risk, currentOpen, pendingEntry.direction),
                    highestPrice: currentOpen,
                    lowestPrice: currentOpen,
                    initialSize: desiredPositionSize,
                    remainingSize: desiredPositionSize,
                    hitTargetIndices: [],
                    executionHistory: [],
                };
                cash = entryCapital * (1 - desiredPositionSize);
            }
            pendingEntry = null;

            if (currentPosition) {
                const entryPrice = currentPosition.entryPrice;
                const direction = currentPosition.direction;
                const strategyRisk = currentPosition.risk;
                const fundingRate = fundingByTime.get(bar.time)?.rate ?? NaN;
                currentPosition.accruedFunding += this.calculateFundingCashflow(currentPosition, fundingRate);

                let shouldExit = false;
                let exitReason: Trade['exitReason'] = 'end_of_data';
                let exitPrice = currentClose;

                if (this.config.useStrategyRiskManagement && strategyRisk) {
                    const activeStopLossPrice = strategyRisk.stopLoss.price;
                    let deferredStopLossPrice: number | null = null;
                    let deferredStopLossReason: string | null = null;

                    if (strategyRisk.stopLoss.type === 'trailing') {
                        if (direction === 'long') {
                            const trailingDistance = strategyRisk.stopLoss.percentage / 100;
                            const newStopLoss = currentPosition.highestPrice * (1 - trailingDistance);
                            if (isMoreProtectiveStop(direction, newStopLoss, activeStopLossPrice)) {
                                deferredStopLossPrice = newStopLoss;
                                deferredStopLossReason = strategyRisk.stopLoss.reason;
                            }
                        } else {
                            const trailingDistance = strategyRisk.stopLoss.percentage / 100;
                            const newStopLoss = currentPosition.lowestPrice * (1 + trailingDistance);
                            if (isMoreProtectiveStop(direction, newStopLoss, activeStopLossPrice)) {
                                deferredStopLossPrice = newStopLoss;
                                deferredStopLossReason = strategyRisk.stopLoss.reason;
                            }
                        }
                    }

                    const dynamicExit = strategyRisk.dynamicExit;
                    const dynamicExitActive = Boolean(
                        dynamicExit?.enabled
                        && currentPosition.hitTargetIndices.includes(dynamicExit.activateAfterTargetIndex),
                    );
                    if (dynamicExitActive) {
                        const dynamicTrailStop = computeDynamicTrailStop(
                            direction,
                            currentPosition.executionHistory,
                            strategyRisk,
                        );
                        if (
                            dynamicTrailStop !== null &&
                            isMoreProtectiveStop(direction, dynamicTrailStop, deferredStopLossPrice ?? activeStopLossPrice)
                        ) {
                            deferredStopLossPrice = dynamicTrailStop;
                            deferredStopLossReason = dynamicExit?.reason ?? '动态趋势退出';
                        }
                    }

                    const effectiveStopLossPrice = deferredStopLossPrice !== null
                        && isMoreProtectiveStop(direction, deferredStopLossPrice, activeStopLossPrice)
                        ? deferredStopLossPrice
                        : activeStopLossPrice;
                    const invalidationPrice = dynamicExit?.invalidationPrice;
                    const invalidationIsMoreProtective = Number.isFinite(invalidationPrice)
                        && isMoreProtectiveStop(direction, invalidationPrice!, effectiveStopLossPrice);

                    if (invalidationIsMoreProtective) {
                        if (direction === 'long') {
                            if (currentLow <= invalidationPrice!) {
                                shouldExit = true;
                                exitReason = 'signal';
                                exitPrice = invalidationPrice!;
                            }
                        } else if (currentHigh >= invalidationPrice!) {
                            shouldExit = true;
                            exitReason = 'signal';
                            exitPrice = invalidationPrice!;
                        }
                    }

                    const stopLossPrice = effectiveStopLossPrice;
                    if (!shouldExit && direction === 'long') {
                        if (currentLow <= stopLossPrice) {
                            shouldExit = true;
                            exitReason = 'stop_loss';
                            exitPrice = stopLossPrice;
                        }
                    } else if (!shouldExit && currentHigh >= stopLossPrice) {
                        shouldExit = true;
                        exitReason = 'stop_loss';
                        exitPrice = stopLossPrice;
                    }

                    if (!shouldExit && strategyRisk.takeProfit && strategyRisk.takeProfit.targets.length > 0) {
                        strategyRisk.takeProfit.targets.forEach((target, targetIndex) => {
                            if (shouldExit || currentPosition!.hitTargetIndices.includes(targetIndex)) {
                                return;
                            }

                            const isHit = direction === 'long'
                                ? currentHigh >= target.price
                                : currentLow <= target.price;

                            if (!isHit) {
                                return;
                            }

                            currentPosition!.hitTargetIndices.push(targetIndex);

                            if (target.moveStopToEntry) {
                                const breakEvenPrice = entryPrice;
                                const candidateReason = `保本止损(T${targetIndex + 1}触发)`;
                                const baselineStop = deferredStopLossPrice ?? activeStopLossPrice;
                                if (isMoreProtectiveStop(direction, breakEvenPrice, baselineStop)) {
                                    deferredStopLossPrice = breakEvenPrice;
                                    deferredStopLossReason = candidateReason;
                                }
                            }

                            const exitSize = Math.min(
                                currentPosition!.remainingSize,
                                currentPosition!.initialSize * (target.closePercentage / 100)
                            );

                            if (!shouldExit && exitSize > 0.0001) {
                                const settlement = this.recordTrade(
                                    tradeLegs,
                                    currentPosition!,
                                    symbol,
                                    bar.time,
                                    target.price,
                                    exitSize,
                                    'take_profit'
                                );
                                cash += settlement.capitalReturned;
                                currentPosition!.remainingSize -= exitSize;
                            }

                            if (currentPosition!.remainingSize <= 0.0001) {
                                shouldExit = true;
                                exitReason = 'take_profit';
                                exitPrice = target.price;
                            }
                        });
                    }

                    if (
                        !shouldExit &&
                        currentPosition &&
                        currentPosition.remainingSize > 0.0001 &&
                        deferredStopLossPrice !== null &&
                        isMoreProtectiveStop(direction, deferredStopLossPrice, strategyRisk.stopLoss.price)
                    ) {
                        strategyRisk.stopLoss.price = deferredStopLossPrice;
                        if (deferredStopLossReason) {
                            strategyRisk.stopLoss.reason = deferredStopLossReason;
                        }
                    }
                } else {
                    const profitPercent = this.calculateProfitPercent(entryPrice, currentClose, direction);
                    if (profitPercent <= -5) {
                        shouldExit = true;
                        exitReason = 'stop_loss';
                        exitPrice = currentClose;
                    }
                    if (profitPercent >= 10) {
                        shouldExit = true;
                        exitReason = 'take_profit';
                        exitPrice = currentClose;
                    }
                }

                if (!shouldExit && strategyRisk?.timeStop && signalIntervalMs) {
                    const heldDuration = bar.time - currentPosition.signalEntryTime;
                    const maxHoldDuration = strategyRisk.timeStop.maxHoldBars * signalIntervalMs;
                    if (heldDuration >= maxHoldDuration) {
                        const floatingProfitPercent = this.calculateProfitPercent(
                            entryPrice,
                            currentClose,
                            direction
                        );
                        if (floatingProfitPercent < strategyRisk.timeStop.profitThreshold) {
                            if (hasNextBar) {
                                pendingExitReason = 'time_stop';
                            } else if (isFinalSegment) {
                                shouldExit = true;
                                exitReason = 'time_stop';
                                exitPrice = currentClose;
                            } else {
                                pendingExitReason = 'time_stop';
                            }
                        }
                    }
                }

                if (shouldExit && currentPosition.remainingSize > 0.0001) {
                    const settlement = this.recordTrade(
                        tradeLegs,
                        currentPosition,
                        symbol,
                        bar.time,
                        exitPrice,
                        currentPosition.remainingSize,
                        exitReason
                    );
                    cash += settlement.capitalReturned;
                    currentPosition = null;
                } else if (currentPosition && currentPosition.remainingSize <= 0.0001) {
                    currentPosition = null;
                } else if (currentPosition) {
                    if (currentHigh > currentPosition.highestPrice) {
                        currentPosition.highestPrice = currentHigh;
                    }
                    if (currentLow < currentPosition.lowestPrice) {
                        currentPosition.lowestPrice = currentLow;
                    }
                    currentPosition.executionHistory.push(bar);
                }
            }

            lastProcessedTime = bar.time;
            lastProcessedPrice = currentClose;
        }

        if (isFinalSegment) {
            if (pendingExitReason && currentPosition) {
                const settlement = this.recordTrade(
                    tradeLegs,
                    currentPosition,
                    symbol,
                    lastProcessedTime,
                    lastProcessedPrice,
                    currentPosition.remainingSize,
                    pendingExitReason
                );
                cash += settlement.capitalReturned;
                currentPosition = null;
                pendingExitReason = null;
            }

            if (currentPosition) {
                const settlement = this.recordTrade(
                    tradeLegs,
                    currentPosition,
                    symbol,
                    lastProcessedTime,
                    lastProcessedPrice,
                    currentPosition.remainingSize,
                    'end_of_data'
                );
                cash += settlement.capitalReturned;
                currentPosition = null;
            }

            pendingEntry = null;
        }

        return {
            currentPosition,
            pendingEntry,
            pendingExitReason,
            cash,
            lastProcessedTime,
            lastProcessedPrice,
        };
    }

    /**
     * 运行回测
     */
    async run(input: BacktestRunInput): Promise<BacktestResult> {
        const {
            signalKlines,
            strategyDetector,
            strategyName,
            symbol,
            signalInterval,
            executionInterval: requestedExecutionInterval,
            simulationEndTime: requestedSimulationEndTime,
            fetchExecutionKlines,
        } = input;

        if (signalKlines.length === 0) {
            throw new Error('K线数据为空');
        }
        if (signalKlines.length < 2) {
            throw new Error('K线数据不足，至少需要 2 根K线');
        }

        const executionInterval = requestedExecutionInterval || signalInterval;
        const signalIntervalMs = this.getIntervalMs(signalInterval);
        const executionIntervalMs = this.getIntervalMs(executionInterval);

        if (!signalIntervalMs || !executionIntervalMs) {
            throw new Error('回测周期无效');
        }
        if (executionIntervalMs > signalIntervalMs) {
            throw new Error('执行周期不能大于信号周期');
        }
        if (executionInterval !== signalInterval && !fetchExecutionKlines) {
            throw new Error('缺少细粒度执行数据源');
        }

        const tradeLegs: Trade[] = [];
        const equityCurve: EquityPoint[] = [];

            let currentPosition: BacktestPosition | null = null;
            let pendingEntry: PendingBacktestEntry | null = null;
            let pendingExitReason: Trade['exitReason'] | null = null;
            let executionBarsProcessed = 0;
            let finalEvaluationTime = signalKlines[signalKlines.length - 1].closeTime;
            let finalEvaluationPrice = parseFloat(signalKlines[signalKlines.length - 1].close);

            let cash = this.config.initialCapital;
            let peakEquity = this.config.initialCapital;
            let maxDrawdown = 0;

            // 允许短周期/短样本回测继续执行，同时给指标留出合理预热窗口。
            const preferredWarmupBars = 50;
            const startIndex = Math.min(preferredWarmupBars, signalKlines.length - 1);
            const simulationEndTime = requestedSimulationEndTime ?? signalKlines[signalKlines.length - 1].closeTime;
            const executionProvider = new BacktestExecutionProvider({
                interval: executionInterval,
                startTime: signalKlines[startIndex].closeTime,
                endTime: simulationEndTime,
                baseKlines: executionInterval === signalInterval ? signalKlines : undefined,
                fetchRangeData: executionInterval === signalInterval ? undefined : fetchExecutionKlines,
            });

            let previousSignalCloseTime: number | null = null;

            for (let i = startIndex; i < signalKlines.length; i++) {
                const kline = signalKlines[i];
                const currentClose = parseFloat(kline.close);

                if (previousSignalCloseTime !== null && (currentPosition || pendingEntry || pendingExitReason)) {
                    const executionBars = await executionProvider.getBarsBetween(previousSignalCloseTime, kline.closeTime);
                    const executionData = adaptKlinesToBacktestDataSlice(executionBars);
                    const fundingByTime = new Map(executionData.funding.map((point) => [point.time, point]));
                    executionBarsProcessed += executionBars.length;
                    this.assertExecutionBarsAvailable({
                        bars: executionData.bars,
                        symbol,
                        executionInterval,
                        startExclusive: previousSignalCloseTime,
                        endInclusive: kline.closeTime,
                        currentPosition,
                        pendingEntry,
                        pendingExitReason,
                    });

                    const executionState = this.processExecutionBars({
                        bars: executionData.bars,
                        fundingByTime,
                        currentPosition,
                        pendingEntry,
                        pendingExitReason,
                        tradeLegs,
                        symbol,
                        cash,
                        signalIntervalMs,
                        executionIntervalMs,
                        isFinalSegment: false,
                        fallbackExitTime: kline.closeTime,
                        fallbackExitPrice: currentClose,
                    });

                    currentPosition = executionState.currentPosition;
                    pendingEntry = executionState.pendingEntry;
                    pendingExitReason = executionState.pendingExitReason;
                    cash = executionState.cash;
                    finalEvaluationTime = executionState.lastProcessedTime;
                    finalEvaluationPrice = executionState.lastProcessedPrice;
                }

                finalEvaluationTime = kline.closeTime;
                finalEvaluationPrice = currentClose;

                const ticker = TechnicalIndicators.enrichTickerData(signalKlines, i, symbol, signalInterval);
                const strategyResult = this.runWithMockedNow(kline.closeTime, () => strategyDetector(ticker));

                if (!pendingExitReason && currentPosition && strategyResult && strategyResult.signal && strategyResult.signal !== currentPosition.direction) {
                    pendingExitReason = 'signal';
                    pendingEntry = {
                        direction: strategyResult.signal,
                        signalTime: kline.closeTime,
                        risk: this.cloneRiskManagement(strategyResult.risk),
                    };
                } else if (!currentPosition && strategyResult && strategyResult.signal) {
                    pendingEntry = {
                        direction: strategyResult.signal,
                        signalTime: kline.closeTime,
                        risk: this.cloneRiskManagement(strategyResult.risk),
                    };
                }

                const markToMarketEquity = this.calculateMarkToMarketEquity(
                    cash,
                    currentPosition,
                    currentClose
                );

                if (markToMarketEquity > peakEquity) {
                    peakEquity = markToMarketEquity;
                }
                const drawdown = ((peakEquity - markToMarketEquity) / peakEquity) * 100;
                if (drawdown > maxDrawdown) {
                    maxDrawdown = drawdown;
                }

                equityCurve.push({
                    time: kline.closeTime,
                    equity: this.config.initialCapital > 0
                        ? (markToMarketEquity / this.config.initialCapital) * 100
                        : 0,
                    drawdown,
                });

                previousSignalCloseTime = kline.closeTime;
            }

            if (previousSignalCloseTime !== null && (currentPosition || pendingEntry || pendingExitReason)) {
                const executionBars = await executionProvider.getBarsBetween(previousSignalCloseTime, simulationEndTime);
                const executionData = adaptKlinesToBacktestDataSlice(executionBars);
                const fundingByTime = new Map(executionData.funding.map((point) => [point.time, point]));
                executionBarsProcessed += executionBars.length;
                if (executionBars.length > 0 || simulationEndTime > previousSignalCloseTime) {
                    this.assertExecutionBarsAvailable({
                        bars: executionData.bars,
                        symbol,
                        executionInterval,
                        startExclusive: previousSignalCloseTime,
                        endInclusive: simulationEndTime,
                        currentPosition,
                        pendingEntry,
                        pendingExitReason,
                    });
                }

                const executionState = this.processExecutionBars({
                    bars: executionData.bars,
                    fundingByTime,
                    currentPosition,
                    pendingEntry,
                    pendingExitReason,
                    tradeLegs,
                    symbol,
                    cash,
                    signalIntervalMs,
                    executionIntervalMs,
                    isFinalSegment: true,
                    fallbackExitTime: finalEvaluationTime,
                    fallbackExitPrice: finalEvaluationPrice,
                });

                currentPosition = executionState.currentPosition;
                pendingEntry = executionState.pendingEntry;
                pendingExitReason = executionState.pendingExitReason;
                cash = executionState.cash;
                finalEvaluationTime = executionState.lastProcessedTime;
                finalEvaluationPrice = executionState.lastProcessedPrice;

                if (cash > peakEquity) {
                    peakEquity = cash;
                }
                const finalDrawdown = peakEquity > 0 ? ((peakEquity - cash) / peakEquity) * 100 : 0;
                maxDrawdown = Math.max(maxDrawdown, finalDrawdown);

                const lastEquityPoint = equityCurve[equityCurve.length - 1];
                if (!lastEquityPoint || lastEquityPoint.time < finalEvaluationTime) {
                    equityCurve.push({
                        time: finalEvaluationTime,
                        equity: this.config.initialCapital > 0
                            ? (cash / this.config.initialCapital) * 100
                            : 0,
                        drawdown: finalDrawdown,
                    });
                } else {
                    lastEquityPoint.equity = this.config.initialCapital > 0
                        ? (cash / this.config.initialCapital) * 100
                        : 0;
                    lastEquityPoint.drawdown = finalDrawdown;
                }
            }

        const trades = this.aggregateTradeLegs(tradeLegs);

        // 计算统计指标
        return this.calculateMetrics(
            trades,
            tradeLegs,
            equityCurve,
            maxDrawdown,
            symbol,
            signalInterval,
            executionInterval,
            strategyName,
            signalKlines[startIndex].openTime,
            Math.max(signalKlines[signalKlines.length - 1].closeTime, finalEvaluationTime),
            signalKlines.length - startIndex,
            executionBarsProcessed
        );
    }

    /**
     * 计算回测指标
     */
    private calculateMetrics(

        trades: Trade[],
        tradeLegs: Trade[],
        equityCurve: EquityPoint[],
        maxDrawdown: number,
        symbol: string,
        interval: string,
        executionInterval: string,
        strategyName: string,
        startTime: number,
        endTime: number,
        totalBars: number,
        executionBarsProcessed: number
    ): BacktestResult {
        return calculateBacktestMetrics(
            this.config.initialCapital,
            trades,
            tradeLegs,
            equityCurve,
            maxDrawdown,
            symbol,
            interval,
            executionInterval,
            strategyName,
            startTime,
            endTime,
            totalBars,
            executionBarsProcessed
        );
    }
}
