import test from 'node:test';
import assert from 'node:assert/strict';

import {
    getWeiShenBtcContextRequirements,
    getWeiShenTimeframes,
    isWeiShenStrategy,
    resolveStrategyIntervalsWithOverrides,
    WEI_SHEN_STRATEGY_ID,
} from './weiShenStrategy.ts';

test('wei-shen strategy helper identifies the special strategy id', () => {
    assert.equal(isWeiShenStrategy(WEI_SHEN_STRATEGY_ID), true);
    assert.equal(isWeiShenStrategy('strong-breakout'), false);
});

test('wei-shen interval resolver uses configured signal and execution intervals', () => {
    const resolved = resolveStrategyIntervalsWithOverrides({
        strategyId: WEI_SHEN_STRATEGY_ID,
        signalInterval: '15m',
        executionInterval: '1m',
    });
    const timeframes = getWeiShenTimeframes();

    assert.equal(resolved.signalInterval, timeframes.signalInterval);
    assert.equal(resolved.executionInterval, timeframes.executionInterval);
});

test('wei-shen btc context requirements stay empty for BTC and include three roles for alts', () => {
    assert.deepEqual(getWeiShenBtcContextRequirements('BTCUSDT'), []);

    const requirements = getWeiShenBtcContextRequirements('ETHUSDT');
    assert.equal(requirements.length, 3);
    assert.deepEqual(
        requirements.map((item) => item.role),
        ['btc-market-signal', 'btc-market-confirm', 'btc-market-daily'],
    );
});
