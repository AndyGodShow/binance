import assert from 'node:assert/strict';
import test from 'node:test';

import type { TickerData } from './types.ts';
import type { TradingStrategy } from './strategyTypes.ts';
import type { DeepPartial, StrategyParameterConfigMap } from './strategyParameters.ts';
import { createStrategyRuntimeState } from './strategyRuntimeState.ts';
import { detectVisibleStrategySignalsForTicker } from './strategyScannerCore.ts';

function createTicker(): TickerData {
    return {
        symbol: 'BTCUSDT',
        lastPrice: '100',
        priceChange: '1',
        priceChangePercent: '1',
        weightedAvgPrice: '99',
        prevClosePrice: '98',
        highPrice: '101',
        lowPrice: '97',
        volume: '1000',
        quoteVolume: '1000000',
        openTime: 1,
        closeTime: 2,
    };
}

test('detectVisibleStrategySignalsForTicker forwards parameter overrides to strategies', () => {
    const parameterOverrides: DeepPartial<StrategyParameterConfigMap> = {
        'sentiment-hotspot': {
            minHeatSourceCount: 3,
        },
    };

    let receivedOverrides: DeepPartial<StrategyParameterConfigMap> | undefined;
    const strategy: TradingStrategy = {
        id: 'test-strategy',
        name: 'Test Strategy',
        description: 'test',
        category: 'special',
        enabled: true,
        detect: (_ticker, context) => {
            receivedOverrides = context?.parameterOverrides;
            return {
                symbol: 'BTCUSDT',
                strategyId: 'test-strategy',
                strategyName: 'Test Strategy',
                direction: 'long',
                confidence: 90,
                reason: 'test',
                metrics: {},
                timestamp: context?.now ?? 0,
            };
        },
    };

    const signals = detectVisibleStrategySignalsForTicker({
        ticker: createTicker(),
        strategies: [strategy],
        now: 123,
        runtimeState: createStrategyRuntimeState(),
        minConfidence: 80,
        parameterOverrides,
    });

    assert.equal(signals.length, 1);
    assert.equal(receivedOverrides, parameterOverrides);
});
