import assert from 'node:assert/strict';
import test from 'node:test';

import {
    calculateBreakoutMetrics,
    calculateDirectionalAlignmentScore,
    calculatePercentageChange,
    deriveTrendStructure,
    determineOrderedTrend,
} from './marketStructure.ts';

test('calculatePercentageChange returns 0 for invalid baselines and percent for valid inputs', () => {
    assert.equal(calculatePercentageChange(110, 100), 10);
    assert.equal(calculatePercentageChange(100, 0), 0);
    assert.equal(calculatePercentageChange(Number.NaN, 100), 0);
});

test('determineOrderedTrend and alignment score use the shared ordering rules', () => {
    assert.equal(determineOrderedTrend([10, 9, 8]), 'bullish');
    assert.equal(determineOrderedTrend([8, 9, 10]), 'bearish');
    assert.equal(determineOrderedTrend([10, 8, 9]), 'mixed');
    assert.equal(calculateDirectionalAlignmentScore([10, 9, 8], 'bullish'), 2);
    assert.equal(calculateDirectionalAlignmentScore([8, 9, 10], 'bearish'), 2);
    assert.equal(calculateDirectionalAlignmentScore([10, null, 8], 'bullish'), 0);
});

test('deriveTrendStructure builds shared EMA, GMMA and multi-EMA fields', () => {
    const structure = deriveTrendStructure({
        currentPrice: 110,
        ema20: 100,
        ema60: 95,
        ema100: 90,
        gmmaShortValues: [108, 107, 106, 105, 104, 103],
        gmmaLongValues: [98, 97, 96, 95, 94, 93],
        multiEmaValues: [100, 95, 90, 85],
    });

    assert.equal(structure.ema5m20, 100);
    assert.equal(structure.ema5mDistancePercent, 10);
    assert.equal(structure.gmmaTrend, 'bullish');
    assert.equal(structure.gmmaShortScore, 5);
    assert.equal(structure.gmmaLongScore, 5);
    assert.equal(structure.multiEmaTrend, 'bullish');
    assert.equal(structure.multiEmaAlignmentScore, 3);
    assert.ok(typeof structure.gmmaSeparationPercent === 'number');
});

test('calculateBreakoutMetrics reuses shared breakout math', () => {
    const metrics = calculateBreakoutMetrics(105, 100);
    assert.deepEqual(metrics, {
        breakout21dHigh: 100,
        breakout21dPercent: 5,
    });
    assert.equal(calculateBreakoutMetrics(105, 0), null);
});
