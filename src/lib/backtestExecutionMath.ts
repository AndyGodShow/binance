import { calculateEMA } from './indicators.ts';
import type { MarketBar } from './backtestDataAdapter.ts';
import type { RiskManagement } from './risk/types.ts';

export function isMoreProtectiveStop(
    direction: 'long' | 'short',
    candidateStop: number,
    currentStop: number
): boolean {
    return direction === 'long'
        ? candidateStop > currentStop
        : candidateStop < currentStop;
}

export function toExecutionHistoryOHLC(bars: MarketBar[]) {
    return bars.map((bar) => ({
        time: bar.time,
        open: bar.open,
        high: bar.high,
        low: bar.low,
        close: bar.close,
        volume: bar.volume,
    }));
}

export function computeDonchianMid(bars: MarketBar[], lookback: number): number | null {
    if (lookback <= 0 || bars.length < lookback) {
        return null;
    }

    const window = bars.slice(Math.max(0, bars.length - lookback));
    if (window.length === 0) {
        return null;
    }

    const highestHigh = Math.max(...window.map((bar) => bar.high));
    const lowestLow = Math.min(...window.map((bar) => bar.low));
    if (!Number.isFinite(highestHigh) || !Number.isFinite(lowestLow)) {
        return null;
    }

    return (highestHigh + lowestLow) / 2;
}

export function computeDynamicTrailStop(
    direction: 'long' | 'short',
    history: MarketBar[],
    risk: RiskManagement,
): number | null {
    const dynamicExit = risk.dynamicExit;
    if (!dynamicExit?.enabled) {
        return null;
    }

    const ohlcHistory = toExecutionHistoryOHLC(history);
    const emaSeries = calculateEMA(
        ohlcHistory.map((bar) => bar.close),
        dynamicExit.emaPeriod,
    );
    const emaValue = emaSeries.length > 0 ? emaSeries[emaSeries.length - 1] : null;
    const donchianMid = computeDonchianMid(history, dynamicExit.donchianLookback);
    const candidates = [emaValue, donchianMid].filter((value): value is number => Number.isFinite(value));

    if (candidates.length === 0) {
        return null;
    }

    return direction === 'long'
        ? Math.max(...candidates)
        : Math.min(...candidates);
}
