import assert from 'node:assert/strict';
import test from 'node:test';

import { getDefaultRiskConfig } from './riskConfig.ts';
import { calculateRiskManagement } from './riskCalculator.ts';

test('sentiment hotspot has a dedicated default risk profile', () => {
    const config = getDefaultRiskConfig('sentiment-hotspot');

    assert.equal(config.stopLoss.type, 'indicator');
    assert.equal(config.maxLeverage, 2);
    assert.deepEqual(
        config.takeProfit.targets.map((target) => target.closePercentage),
        [35, 35, 30],
    );
});

test('sentiment hotspot risk uses hotspot invalidation instead of the generic ATR fallback', () => {
    const risk = calculateRiskManagement('sentiment-hotspot', {
        entryPrice: 100,
        direction: 'long',
        confidence: 94,
        atr: 1.2,
        keltnerLower: 97.8,
        bollingerMid: 101,
        oiChangePercent: 18,
        volumeChangePercent: 25,
        accountBalance: 10_000,
        riskPercentage: 0.8,
    });

    assert.equal(risk.stopLoss.type, 'dynamic');
    assert.match(risk.stopLoss.reason, /情绪热点|启动区|热度/);
    assert.equal(risk.takeProfit.targets.length, 3);
    assert.equal(risk.takeProfit.targets[0]?.moveStopToEntry, true);
    assert.ok(risk.timeStop);
    assert.ok(risk.positionSizing.leverage <= 2);
});
