import {
    HistoricalDataFetcher,
    type HistoricalRangeAudit,
} from './historicalDataFetcher.ts';
import type { DeepPartial, StrategyParameterConfigMap } from './strategyParameters.ts';
import { getRequiredHistoricalIntervals } from './historicalMultiTimeframe.ts';
import { getWeiShenBtcContextRequirements, isWeiShenStrategy } from './weiShenStrategy.ts';

export interface BacktestHistoryIntervalReport extends HistoricalRangeAudit {
    role: string;
}

export interface BacktestHistoryPreflightReport {
    strategyId: string;
    symbol: string;
    requestedStartTime: number;
    requestedEndTime: number;
    intervals: BacktestHistoryIntervalReport[];
    passed: boolean;
    reasons: string[];
}

interface BacktestHistoryPreflightOptions {
    dataFetcher: HistoricalDataFetcher;
    strategyId: string;
    symbol: string;
    startTime: number;
    endTime: number;
    signalInterval: string;
    executionInterval: string;
    parameterOverrides?: DeepPartial<StrategyParameterConfigMap>;
}

interface IntervalRequirement {
    symbol: string;
    interval: string;
    role: string;
}

function dedupeRequirements(requirements: IntervalRequirement[]): IntervalRequirement[] {
    const seen = new Set<string>();
    const result: IntervalRequirement[] = [];

    requirements.forEach((item) => {
        const key = `${item.symbol}:${item.interval}:${item.role}`;
        if (seen.has(key)) {
            return;
        }
        seen.add(key);
        result.push(item);
    });

    return result;
}

function buildIntervalRequirements(options: BacktestHistoryPreflightOptions): IntervalRequirement[] {
    const requirements: IntervalRequirement[] = [
        {
            symbol: options.symbol,
            interval: options.signalInterval,
            role: 'signal',
        },
    ];

    if (options.executionInterval !== options.signalInterval) {
        requirements.push({
            symbol: options.symbol,
            interval: options.executionInterval,
            role: 'execution',
        });
    }

    const requiredIntervals = getRequiredHistoricalIntervals(options.strategyId, options.parameterOverrides)
        .filter((interval) => interval !== options.signalInterval);
    
    requiredIntervals.forEach((interval) => {
        requirements.push({
            symbol: options.symbol,
            interval,
            role: interval === '1d' ? 'daily-filter' : `confirm-${interval}`,
        });
    });

    if (isWeiShenStrategy(options.strategyId)) {
        requirements.push(...getWeiShenBtcContextRequirements(options.symbol, options.parameterOverrides));
    }

    return dedupeRequirements(requirements);
}

export async function runBacktestHistoryPreflight(
    options: BacktestHistoryPreflightOptions,
): Promise<BacktestHistoryPreflightReport> {
    const requirements = buildIntervalRequirements(options);
    const intervals: BacktestHistoryIntervalReport[] = [];

    for (const requirement of requirements) {
        const result = await options.dataFetcher.fetchRangeDataWithAudit(
            requirement.symbol,
            requirement.interval,
            options.startTime,
            options.endTime,
            { includeAuxiliary: false },
        );

        intervals.push({
            ...result.audit,
            role: requirement.role,
        });
    }

    const failedIntervals = intervals.filter((interval) => !interval.backtestReady);
    const reasons = failedIntervals.flatMap((interval) => {
        const detail = interval.reasons.length > 0 ? interval.reasons.join('；') : '未达到正式回测门槛。';
        return [`${interval.symbol} ${interval.interval} (${interval.role}) 未通过 preflight：${detail}`];
    });

    return {
        strategyId: options.strategyId,
        symbol: options.symbol,
        requestedStartTime: options.startTime,
        requestedEndTime: options.endTime,
        intervals,
        passed: failedIntervals.length === 0,
        reasons,
    };
}
