import type { StrategySignal } from './strategyTypes.ts';

export function createDismissedSignalKey(signal: Pick<StrategySignal, 'symbol' | 'strategyId'>): string {
    return `${signal.symbol}:${signal.strategyId}`;
}
