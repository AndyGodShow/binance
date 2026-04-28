import assert from 'node:assert/strict';
import test from 'node:test';

import { isStrategySignalVisible } from './strategySignalVisibility.ts';
import {
    WEI_SHEN_UNIVERSE,
    filterWeiShenUniverseSymbols,
    isWeiShenUniverseSymbol,
    resolveStrategyUniverseSymbols,
} from './weiShenUniverse.ts';
import type { StrategySignal } from './strategyTypes.ts';

function createSignal(overrides: Partial<StrategySignal>): StrategySignal {
    return {
        symbol: 'ETHUSDT',
        strategyId: 'wei-shen-ledger',
        strategyName: '魏神策略',
        direction: 'long',
        confidence: 84,
        reason: 'test',
        metrics: {},
        timestamp: Date.now(),
        ...overrides,
    };
}

test('wei-shen universe helpers only keep the explicit five-coin whitelist', () => {
    assert.equal(isWeiShenUniverseSymbol('BTCUSDT'), true);
    assert.equal(isWeiShenUniverseSymbol('ADAUSDT'), false);

    assert.deepEqual(
        filterWeiShenUniverseSymbols(['ADAUSDT', 'ETHUSDT', 'DOGEUSDT', 'ETHUSDT', 'BTCUSDT']),
        ['BTCUSDT', 'ETHUSDT', 'DOGEUSDT'],
    );

    assert.deepEqual(
        resolveStrategyUniverseSymbols('wei-shen-ledger', ['BTCUSDT', 'ADAUSDT', 'SOLUSDT']),
        ['BTCUSDT', 'SOLUSDT'],
    );
    assert.deepEqual(
        resolveStrategyUniverseSymbols('strong-breakout', ['BTCUSDT', 'ADAUSDT', 'SOLUSDT']),
        ['BTCUSDT', 'ADAUSDT', 'SOLUSDT'],
    );
    assert.equal(WEI_SHEN_UNIVERSE.length, 5);
});

test('live visibility keeps wei-shen B trades and hides C observations while filtering other low-confidence trades', () => {
    const weiBSignal = createSignal({
        confidence: 84,
        executionMode: 'trade',
        grade: 'B',
    });
    const weiCSignal = createSignal({
        confidence: 70,
        executionMode: 'observe',
        grade: 'C',
    });
    const otherLowConfidence = createSignal({
        strategyId: 'strong-breakout',
        confidence: 84,
        executionMode: 'trade',
    });

    assert.equal(isStrategySignalVisible(weiBSignal, 85), true);
    assert.equal(isStrategySignalVisible(weiCSignal, 85), false);
    assert.equal(isStrategySignalVisible(otherLowConfidence, 85), false);
});
