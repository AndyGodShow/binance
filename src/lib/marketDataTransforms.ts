import type { OHLC, TickerData } from './types.ts';
import { calculateRsrsMetrics } from './rsrs.ts';

export interface OpenInterestSnapshotLike {
    currentOpenInterest?: string;
    currentOpenInterestValue?: string;
    changePercent4h?: number;
}

export function calculateRecentPriceChangePercent(klines: OHLC[], periodsBack: number): number | undefined {
    const currentIndex = klines.length - 1;
    const pastIndex = currentIndex - periodsBack;
    if (currentIndex < 0 || pastIndex < 0) {
        return undefined;
    }

    const current = klines[currentIndex].close;
    const past = klines[pastIndex].close;
    if (!Number.isFinite(current) || !Number.isFinite(past) || past <= 0) {
        return undefined;
    }

    return ((current - past) / past) * 100;
}

export function normalizeReleaseBarsAgo(releaseBarsAgo: number | undefined): number {
    return releaseBarsAgo ?? -1;
}

export function attachOpenInterestSnapshotsToTickers(
    tickers: TickerData[],
    oiSnapshotMap: Map<string, OpenInterestSnapshotLike>,
): TickerData[] {
    return tickers.map((ticker) => {
        const oiSnapshot = oiSnapshotMap.get(ticker.symbol);
        if (!oiSnapshot) {
            return ticker;
        }

        return {
            ...ticker,
            openInterest: oiSnapshot.currentOpenInterest || ticker.openInterest,
            openInterestValue: oiSnapshot.currentOpenInterestValue || ticker.openInterestValue,
            oiChangePercent: oiSnapshot.changePercent4h ?? ticker.oiChangePercent,
        };
    });
}

export function buildRsrsTickerFields(klines: OHLC[]): Partial<TickerData> {
    const metrics = calculateRsrsMetrics(
        klines.map((kline) => ({
            high: kline.high,
            low: kline.low,
            close: kline.close,
            volume: kline.volume,
        })),
    );

    if (!metrics) {
        return {};
    }

    return {
        rsrs: metrics.beta,
        rsrsZScore: metrics.zScore,
        rsrsR2: metrics.r2,
        rsrsFinal: metrics.rsrsFinal,
        rsrsDynamicLongThreshold: metrics.dynamicLongThreshold,
        rsrsDynamicShortThreshold: metrics.dynamicShortThreshold,
        rsrsROC: metrics.rsrsROC,
        rsrsAcceleration: metrics.rsrsAcceleration,
        rsrsAdaptiveWindow: metrics.adaptiveWindow,
        rsrsMethod: metrics.method,
        bollingerUpper: metrics.bollingerUpper,
        bollingerMid: metrics.bollingerMid,
        bollingerLower: metrics.bollingerLower,
    };
}
