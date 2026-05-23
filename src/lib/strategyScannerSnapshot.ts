import type { StrategySignal } from './strategyTypes.ts';
import type { TickerData } from './types.ts';

function clampConfidence(value: number): number {
    return Math.max(0, Math.min(100, value));
}

function toStackedSignalDetail(signal: StrategySignal) {
    return {
        strategyId: signal.strategyId,
        strategyName: signal.strategyName,
        direction: signal.direction,
        confidence: signal.confidence,
        reason: signal.reason,
        conditionsMet: signal.conditionsMet,
        totalConditions: signal.totalConditions,
        executionMode: signal.executionMode,
        grade: signal.grade,
    };
}

function summarizeOhlcForDigest(ticker: TickerData) {
    return ticker.ohlc?.slice(-3).map((candle) => ({
        time: candle.time,
        open: candle.open,
        high: candle.high,
        low: candle.low,
        close: candle.close,
        volume: candle.volume,
        quoteVolume: candle.quoteVolume,
        takerBuyQuoteVolume: candle.takerBuyQuoteVolume,
    }));
}

export function buildStrategyScannerTickerDigest(ticker: TickerData): string {
    return JSON.stringify({
        lastPrice: ticker.lastPrice,
        priceChangePercent: ticker.priceChangePercent,
        volume: ticker.volume,
        change15m: ticker.change15m,
        change1h: ticker.change1h,
        change4h: ticker.change4h,
        breakout21dHigh: ticker.breakout21dHigh,
        breakout21dPercent: ticker.breakout21dPercent,
        ema5m20: ticker.ema5m20,
        ema5m60: ticker.ema5m60,
        ema5m100: ticker.ema5m100,
        ema5mDistancePercent: ticker.ema5mDistancePercent,
        gmmaTrend: ticker.gmmaTrend,
        gmmaShortScore: ticker.gmmaShortScore,
        gmmaLongScore: ticker.gmmaLongScore,
        gmmaSeparationPercent: ticker.gmmaSeparationPercent,
        multiEmaTrend: ticker.multiEmaTrend,
        multiEmaAlignmentScore: ticker.multiEmaAlignmentScore,
        quoteVolume: ticker.quoteVolume,
        volumeChangePercent: ticker.volumeChangePercent,
        openInterest: ticker.openInterest,
        openInterestValue: ticker.openInterestValue,
        oiChangePercent: ticker.oiChangePercent,
        fundingRate: ticker.fundingRate,
        rsrs: ticker.rsrs,
        rsrsZScore: ticker.rsrsZScore,
        rsrsFinal: ticker.rsrsFinal,
        rsrsR2: ticker.rsrsR2,
        rsrsROC: ticker.rsrsROC,
        rsrsAcceleration: ticker.rsrsAcceleration,
        rsrsDynamicLongThreshold: ticker.rsrsDynamicLongThreshold,
        rsrsDynamicShortThreshold: ticker.rsrsDynamicShortThreshold,
        atr: ticker.atr,
        volumeMA: ticker.volumeMA,
        volumeRatio: ticker.volumeRatio,
        betaToBTC: ticker.betaToBTC,
        correlationToBTC: ticker.correlationToBTC,
        cvd: ticker.cvd,
        cvdSlope: ticker.cvdSlope,
        vah: ticker.vah,
        val: ticker.val,
        poc: ticker.poc,
        bollingerUpper: ticker.bollingerUpper,
        bollingerMid: ticker.bollingerMid,
        bollingerLower: ticker.bollingerLower,
        keltnerUpper: ticker.keltnerUpper,
        keltnerMid: ticker.keltnerMid,
        keltnerLower: ticker.keltnerLower,
        squeezeStatus: ticker.squeezeStatus,
        prevSqueezeStatus: ticker.prevSqueezeStatus,
        squeezeDuration: ticker.squeezeDuration,
        lastSqueezeDuration: ticker.lastSqueezeDuration,
        squeezeStrength: ticker.squeezeStrength,
        releaseBarsAgo: ticker.releaseBarsAgo,
        squeezeBoxHigh: ticker.squeezeBoxHigh,
        squeezeBoxLow: ticker.squeezeBoxLow,
        momentumValue: ticker.momentumValue,
        momentumColor: ticker.momentumColor,
        adx: ticker.adx,
        plusDI: ticker.plusDI,
        minusDI: ticker.minusDI,
        bandwidthPercentile: ticker.bandwidthPercentile,
        ohlc: summarizeOhlcForDigest(ticker),
        strategyContexts: {
            weiShen: ticker.strategyContexts?.weiShen,
            sentimentHotspot: ticker.strategyContexts?.sentimentHotspot,
        },
    });
}

export function selectScannerSignalForSymbol(symbolSignals: StrategySignal[]): StrategySignal | null {
    if (symbolSignals.length === 0) {
        return null;
    }

    const tradableSignals = symbolSignals.filter((signal) => signal.executionMode !== 'observe');
    const observationSignals = symbolSignals.filter((signal) => signal.executionMode === 'observe');
    const stackCount = tradableSignals.length;
    let comboBonus = 0;

    if (stackCount >= 3) {
        comboBonus = 20;
    } else if (stackCount >= 2) {
        comboBonus = 10;
    }

    if (tradableSignals.length > 0) {
        const mainSignal = tradableSignals.reduce((max, signal) =>
            signal.confidence > max.confidence ? signal : max
        );

        return {
            ...mainSignal,
            confidence: clampConfidence(mainSignal.confidence + comboBonus),
            stackCount,
            stackedStrategies: tradableSignals.map((signal) => signal.strategyName),
            stackedSignalDetails: tradableSignals.map(toStackedSignalDetail),
            comboBonus,
        };
    }

    const mainObservation = observationSignals.reduce((max, signal) =>
        signal.confidence > max.confidence ? signal : max
    );

    return {
        ...mainObservation,
        stackCount: 1,
        stackedStrategies: [mainObservation.strategyName],
        stackedSignalDetails: [toStackedSignalDetail(mainObservation)],
        comboBonus: 0,
    };
}

export function filterScannerSignalsByEnabledStrategies(
    signals: StrategySignal[],
    enabledStrategyIds: ReadonlySet<string>,
): StrategySignal[] {
    return signals.filter((signal) => {
        if (enabledStrategyIds.has(signal.strategyId)) {
            return true;
        }

        return signal.stackedSignalDetails?.some((detail) => enabledStrategyIds.has(detail.strategyId)) ?? false;
    });
}

export function createStrategySignalSnapshotDigest(signals: StrategySignal[]): string {
    return JSON.stringify(
        [...signals]
            .sort((a, b) => a.symbol.localeCompare(b.symbol) || a.strategyId.localeCompare(b.strategyId))
            .map((signal) => ({
                symbol: signal.symbol,
                strategyId: signal.strategyId,
                direction: signal.direction,
                status: signal.status ?? 'active',
                confidence: signal.confidence,
                stackCount: signal.stackCount ?? 1,
                executionMode: signal.executionMode ?? 'trade',
                grade: signal.grade ?? null,
            }))
    );
}
