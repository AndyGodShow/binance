import type { DeepPartial, StrategyParameterConfigMap } from './strategyParameters.ts';
import type { StrategyRuntimeState } from './strategyRuntimeState.ts';
import type { StrategySignal, TradingStrategy } from './strategyTypes.ts';
import type { TickerData } from './types.ts';
import { isStrategySignalVisible } from './strategySignalVisibility.ts';
import { isWeiShenUniverseSymbol } from './weiShenUniverse.ts';

interface DetectVisibleStrategySignalsForTickerParams {
    ticker: TickerData;
    strategies: TradingStrategy[];
    now: number;
    runtimeState: StrategyRuntimeState;
    minConfidence: number;
    parameterOverrides?: DeepPartial<StrategyParameterConfigMap>;
    onSignalFiltered?: (signal: StrategySignal) => void;
}

export function detectVisibleStrategySignalsForTicker({
    ticker,
    strategies,
    now,
    runtimeState,
    minConfidence,
    parameterOverrides,
    onSignalFiltered,
}: DetectVisibleStrategySignalsForTickerParams): StrategySignal[] {
    const symbolSignals: StrategySignal[] = [];

    strategies.forEach((strategy) => {
        if (strategy.id === 'wei-shen-ledger' && !isWeiShenUniverseSymbol(ticker.symbol)) {
            return;
        }

        const signal = strategy.detect(ticker, {
            now,
            runtimeState,
            parameterOverrides,
            cooldownPolicy: 'evaluate-only',
        });
        if (!signal) {
            return;
        }

        if (!isStrategySignalVisible(signal, minConfidence)) {
            onSignalFiltered?.(signal);
            return;
        }

        signal.price = parseFloat(ticker.lastPrice);
        symbolSignals.push({
            ...signal,
            status: 'active',
            lastSeenAt: now,
        });
    });

    return symbolSignals;
}
