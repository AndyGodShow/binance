import { HistoricalDataFetcher } from './historicalDataFetcher.ts';

const MAX_BACKTEST_VALIDATION_LIMIT = 1500;

export function estimateValidationBarCount(
    startTime: number,
    endTime: number,
    interval: string,
): number {
    const intervalMs = HistoricalDataFetcher.getIntervalMilliseconds(interval);
    if (!Number.isFinite(startTime) || !Number.isFinite(endTime) || !Number.isFinite(intervalMs) || intervalMs <= 0) {
        return 1;
    }

    return Math.max(1, Math.floor((endTime - startTime) / intervalMs) + 1);
}

export function buildBacktestValidationStageRequest(params: {
    symbol: string;
    interval: string;
    startTime: number;
    endTime: number;
}): {
    limit: number;
    url: string;
} {
    const limit = Math.min(
        MAX_BACKTEST_VALIDATION_LIMIT,
        estimateValidationBarCount(params.startTime, params.endTime, params.interval),
    );
    const searchParams = new URLSearchParams({
        symbol: params.symbol,
        interval: params.interval,
        startTime: String(params.startTime),
        endTime: String(params.endTime),
        limit: String(limit),
        includeAuxiliary: 'false',
    });

    return {
        limit,
        url: `/api/backtest/klines?${searchParams.toString()}`,
    };
}
