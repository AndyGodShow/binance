import type { OpenInterestFrameSnapshot, TickerData } from './types.ts';
import { extractSymbolValueMap } from './dataQualityStatus.ts';

export type MultiFrameDataMap = Record<string, { o15m: number; o1h: number; o4h: number }>;
export type OpenInterestFrameDataMap = Record<string, OpenInterestFrameSnapshot>;
export type RsrsDataMap = Record<string, {
    beta: number;
    zScore: number;
    r2: number;
    rsrsFinal: number;
    dynamicLongThreshold: number;
    dynamicShortThreshold: number;
    bollingerUpper: number;
    bollingerMid: number;
    bollingerLower: number;
    volumeMA: number;
    rsrsROC: number;
    rsrsAcceleration: number;
    adaptiveWindow: number;
    method: string;
}>;

export type TimedPayload<T> = {
    data: T;
    fetchedAt: number;
    cacheAgeSeconds?: number;
    dataSource?: string;
    dataQuality?: string;
    buildState?: string;
    isStale?: boolean;
    isFallback?: boolean;
    errorKind?: string;
};

export function pruneTimedPayloadData<T>(
    payload: TimedPayload<Record<string, T>> | undefined,
    activeSymbols: Set<string>
): TimedPayload<Record<string, T>> | undefined {
    if (!payload) {
        return payload;
    }

    const prunedData = Object.fromEntries(
        Object.entries(payload.data).filter(([symbol]) => activeSymbols.has(symbol))
    );

    if (Object.keys(prunedData).length === Object.keys(payload.data).length) {
        return payload;
    }

    return {
        ...payload,
        data: prunedData,
    };
}

export function mergeTimedPayloadData<T>(
    previous: TimedPayload<Record<string, T>> | undefined,
    next: TimedPayload<Record<string, T>>
): TimedPayload<Record<string, T>> {
    return {
        data: {
            ...(previous?.data || {}),
            ...next.data,
        },
        fetchedAt: Date.now(),
        dataSource: next.dataSource || 'client-batched',
        dataQuality: next.dataQuality,
        buildState: next.buildState,
        isStale: next.isStale,
        isFallback: next.isFallback,
        errorKind: next.errorKind,
    };
}

export function parseOptionalSeconds(value: string | null): number | undefined {
    if (!value) {
        return undefined;
    }

    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : undefined;
}

export function getLatestCloseTime(data: TickerData[] | undefined): number | undefined {
    if (!data || data.length === 0) {
        return undefined;
    }

    let latestCloseTime = 0;
    data.forEach((ticker) => {
        if (Number.isFinite(ticker.closeTime) && ticker.closeTime > latestCloseTime) {
            latestCloseTime = ticker.closeTime;
        }
    });

    return latestCloseTime > 0 ? latestCloseTime : undefined;
}

export function isTimedPayloadFresh(payload: TimedPayload<unknown> | undefined, maxAgeSeconds: number): boolean {
    if (!payload) {
        return false;
    }

    if (payload.cacheAgeSeconds !== undefined) {
        return payload.cacheAgeSeconds <= maxAgeSeconds;
    }

    return (Date.now() - payload.fetchedAt) <= maxAgeSeconds * 1000;
}

export function isHeavyMarketPayloadFresh(payload: TimedPayload<TickerData[]> | undefined, maxAgeMs: number): boolean {
    if (!payload || !Array.isArray(payload.data) || payload.data.length === 0) {
        return false;
    }

    if (payload.cacheAgeSeconds !== undefined && payload.cacheAgeSeconds > maxAgeMs / 1000) {
        return false;
    }

    const latestCloseTime = getLatestCloseTime(payload.data);
    if (latestCloseTime !== undefined) {
        return (Date.now() - latestCloseTime) <= maxAgeMs;
    }

    return (Date.now() - payload.fetchedAt) <= maxAgeMs;
}

export function enrichTickerWithDeferredData(
    ticker: TickerData,
    frameData?: MultiFrameDataMap,
    rsrsData?: RsrsDataMap
): TickerData {
    const nextTicker = { ...ticker };
    const valuationPrice = parseFloat(ticker.markPrice || ticker.lastPrice);
    const price = parseFloat(ticker.lastPrice);

    if (!Number.isFinite(price)) {
        return nextTicker;
    }

    if ((!nextTicker.openInterestValue || nextTicker.openInterestValue === '0') && nextTicker.openInterest && Number.isFinite(valuationPrice)) {
        nextTicker.openInterestValue = (parseFloat(nextTicker.openInterest) * valuationPrice).toString();
    }

    if (frameData) {
        const frame = frameData[ticker.symbol];
        if (frame) {
            nextTicker.change15m = frame.o15m ? ((price - frame.o15m) / frame.o15m) * 100 : 0;
            nextTicker.change1h = frame.o1h ? ((price - frame.o1h) / frame.o1h) * 100 : 0;
            nextTicker.change4h = frame.o4h ? ((price - frame.o4h) / frame.o4h) * 100 : 0;
        }
    }

    if (rsrsData && rsrsData[ticker.symbol]) {
        const rsrs = rsrsData[ticker.symbol];
        nextTicker.rsrs = rsrs.beta;
        nextTicker.rsrsZScore = rsrs.zScore;
        nextTicker.rsrsFinal = rsrs.rsrsFinal;
        nextTicker.rsrsR2 = rsrs.r2;
        nextTicker.rsrsDynamicLongThreshold = rsrs.dynamicLongThreshold;
        nextTicker.rsrsDynamicShortThreshold = rsrs.dynamicShortThreshold;
        nextTicker.bollingerUpper = rsrs.bollingerUpper;
        nextTicker.bollingerMid = rsrs.bollingerMid;
        nextTicker.bollingerLower = rsrs.bollingerLower;
        nextTicker.volumeMA = rsrs.volumeMA;
        nextTicker.rsrsROC = rsrs.rsrsROC;
        nextTicker.rsrsAcceleration = rsrs.rsrsAcceleration;
        nextTicker.rsrsAdaptiveWindow = rsrs.adaptiveWindow;
        nextTicker.rsrsMethod = rsrs.method;
    }

    return nextTicker;
}

export function isUsdtTickerCandidate(ticker: TickerData | undefined | null): ticker is TickerData {
    if (!ticker || typeof ticker.symbol !== 'string') {
        return false;
    }

    return (
        typeof ticker.lastPrice === 'string' &&
        typeof ticker.quoteVolume === 'string' &&
        ticker.symbol.endsWith('USDT')
    );
}

export function isRecentTicker(ticker: TickerData, now: number): boolean {
    return Number.isFinite(ticker.closeTime) && (now - ticker.closeTime) < 24 * 60 * 60 * 1000;
}

export function isLiquidTicker(ticker: TickerData): boolean {
    return Number.isFinite(parseFloat(ticker.quoteVolume)) && parseFloat(ticker.quoteVolume) > 100000;
}

export function mergeLightMarketOpenInterest(
    lightMarketData: TickerData[] | undefined,
    openInterestData: Record<string, unknown> | undefined
): TickerData[] | undefined {
    if (!lightMarketData || lightMarketData.length === 0) {
        return undefined;
    }

    const symbolOpenInterestData = extractSymbolValueMap(openInterestData);

    return lightMarketData.map((ticker) => {
        const openInterest = symbolOpenInterestData[ticker.symbol];
        if (!openInterest) {
            return ticker;
        }

        const valuationPrice = parseFloat(ticker.markPrice || ticker.lastPrice);
        const numericOpenInterest = parseFloat(openInterest);
        const openInterestValue = Number.isFinite(valuationPrice) && Number.isFinite(numericOpenInterest)
            ? (numericOpenInterest * valuationPrice).toString()
            : undefined;

        return {
            ...ticker,
            openInterest,
            openInterestValue,
        };
    });
}

export function mergeBaseAndHeavyMarketData(
    baseMarketData: TickerData[] | undefined,
    heavyMarketData: TickerData[] | undefined
): TickerData[] | undefined {
    if (!baseMarketData || baseMarketData.length === 0) {
        return heavyMarketData;
    }

    if (!heavyMarketData || heavyMarketData.length === 0) {
        return baseMarketData;
    }

    const heavyMap = new Map(heavyMarketData.map((ticker) => [ticker.symbol, ticker]));
    return baseMarketData.map((ticker) => {
        const heavyTicker = heavyMap.get(ticker.symbol);

        return {
            ...ticker,
            ...(heavyTicker || {}),
            lastPrice: ticker.lastPrice,
            priceChange: ticker.priceChange,
            priceChangePercent: ticker.priceChangePercent,
            weightedAvgPrice: ticker.weightedAvgPrice,
            prevClosePrice: ticker.prevClosePrice,
            highPrice: ticker.highPrice,
            lowPrice: ticker.lowPrice,
            volume: ticker.volume,
            quoteVolume: ticker.quoteVolume,
            openTime: ticker.openTime,
            closeTime: ticker.closeTime,
            markPrice: ticker.markPrice || heavyTicker?.markPrice,
            fundingRate: ticker.fundingRate || heavyTicker?.fundingRate,
            openInterest: ticker.openInterest || heavyTicker?.openInterest,
            openInterestValue: ticker.openInterestValue || heavyTicker?.openInterestValue,
        };
    });
}

export function normalizeTickerUniverse(
    rawData: TickerData[] | undefined,
    frameData?: MultiFrameDataMap,
    rsrsData?: RsrsDataMap
): TickerData[] {
    if (!rawData || rawData.length === 0) {
        return [];
    }

    const now = Date.now();
    return rawData
        .filter(isUsdtTickerCandidate)
        .filter((ticker) => isRecentTicker(ticker, now))
        .filter(isLiquidTicker)
        .map((ticker) => enrichTickerWithDeferredData(ticker, frameData, rsrsData));
}
