import assert from 'node:assert/strict';
import test from 'node:test';

import type { TickerData } from './types.ts';
import {
    buildStrategyInputReadinessSummary,
    STRATEGY_INPUT_CONTRACTS,
    toCapitalInflowStrategyInput,
    toRsrsStrategyInput,
    toSentimentHotspotStrategyInput,
    toStrongBreakoutStrategyInput,
    toTrendConfirmationStrategyInput,
    toVolatilitySqueezeStrategyInput,
    toWeiShenStrategyInput,
} from './strategyInputs.ts';

const sampleTicker: TickerData = {
    symbol: 'BTCUSDT',
    lastPrice: '100',
    priceChange: '1',
    priceChangePercent: '2',
    weightedAvgPrice: '99',
    prevClosePrice: '98',
    highPrice: '105',
    lowPrice: '95',
    volume: '1234',
    quoteVolume: '5678',
    openTime: 1,
    closeTime: 2,
    openInterestValue: '999',
    change15m: 1.5,
    change1h: 2.5,
    change4h: 3.5,
    breakout21dHigh: 110,
    breakout21dPercent: 4.5,
    ema5m20: 101,
    ema5m60: 99,
    ema5m100: 97,
    ema5mDistancePercent: 1.2,
    gmmaTrend: 'bullish',
    multiEmaTrend: 'bullish',
    multiEmaAlignmentScore: 5,
    rsrs: 1.1,
    rsrsZScore: 0.8,
    rsrsFinal: 1.5,
    rsrsR2: 0.9,
    rsrsDynamicLongThreshold: 0.7,
    rsrsDynamicShortThreshold: -0.7,
    rsrsROC: 0.4,
    rsrsAcceleration: 0.2,
    bollingerUpper: 110,
    bollingerMid: 100,
    bollingerLower: 90,
    volumeMA: 1000,
    volumeRatio: 1.8,
    atr: 3,
    betaToBTC: 1.3,
    correlationToBTC: 0.6,
    cvd: 15,
    cvdSlope: 2,
    vah: 104,
    val: 96,
    poc: 100,
    oiChangePercent: 18,
    volumeChangePercent: 20,
    squeezeStatus: 'off',
    squeezeDuration: 8,
    lastSqueezeDuration: 10,
    squeezeStrength: 0.6,
    releaseBarsAgo: 0,
    squeezeBoxHigh: 103,
    squeezeBoxLow: 97,
    keltnerUpper: 108,
    keltnerMid: 100,
    keltnerLower: 92,
    momentumValue: 1.2,
    momentumColor: 'cyan',
    adx: 28,
    plusDI: 24,
    minusDI: 14,
    bandwidthPercentile: 12,
    ohlc: [
        { time: 1, open: 95, high: 97, low: 94, close: 96, volume: 10 },
        { time: 2, open: 96, high: 98, low: 95, close: 97, volume: 12 },
        { time: 3, open: 97, high: 99, low: 96, close: 98, volume: 14 },
        { time: 4, open: 98, high: 100, low: 97, close: 99, volume: 16 },
        { time: 5, open: 99, high: 101, low: 98, close: 100, volume: 18 },
        { time: 6, open: 100, high: 103, low: 99, close: 102, volume: 20 },
    ],
    strategyContexts: {
        weiShen: {
            universeAllowed: true,
            symbol: 'BTCUSDT',
            regime: {
                state: 'bull-trend',
                allowLong: true,
                allowShort: false,
                onlyAGrade: false,
                summary: 'bull trend',
                passed: ['regime ok'],
                failed: [],
            },
            relativeStrength: {
                passed: true,
                reasons: ['rs ok'],
                slope1h: 2,
                excessReturn4h: 4,
                volume24hUsd: 5_000_000,
                minVolume24hUsd: 1_000_000,
                minExcessReturn4h: 1,
                summary: 'relative strength ok',
                passedReasons: ['volume ok'],
                failedReasons: [],
                directional: {
                    long: {
                        passed: true,
                        reasons: ['long ok'],
                        failedReasons: [],
                    },
                    short: {
                        passed: false,
                        reasons: [],
                        failedReasons: ['short blocked'],
                    },
                },
            },
            entries: {
                breakout: {
                    long: {
                        eligible: true,
                        grade: 'A',
                        confidenceScore: 90,
                        passed: ['breakout ok'],
                        failed: [],
                        blockedReasons: [],
                        stopLossPrice: 96,
                        invalidationPrice: 95,
                        suggestedRiskPct: 0.75,
                    },
                    short: {
                        eligible: false,
                        grade: 'C',
                        confidenceScore: 10,
                        passed: [],
                        failed: ['short breakout blocked'],
                        blockedReasons: ['trend mismatch'],
                        stopLossPrice: 0,
                        invalidationPrice: 0,
                        suggestedRiskPct: 0,
                    },
                },
                pullback: {
                    long: {
                        eligible: false,
                        grade: 'B',
                        confidenceScore: 50,
                        passed: [],
                        failed: ['pullback not ready'],
                        blockedReasons: [],
                        stopLossPrice: 97,
                        invalidationPrice: 96,
                        suggestedRiskPct: 0.5,
                    },
                    short: {
                        eligible: false,
                        grade: 'C',
                        confidenceScore: 5,
                        passed: [],
                        failed: ['short pullback blocked'],
                        blockedReasons: ['trend mismatch'],
                        stopLossPrice: 0,
                        invalidationPrice: 0,
                        suggestedRiskPct: 0,
                    },
                },
            },
        },
        sentimentHotspot: {
            heatSourceCount: 2,
            hasSquare: true,
            hasCoinGecko: true,
            hasVolSurge: true,
            volumeSurgeRatio: 3.2,
            oiUsd: 8_000_000,
            oiChangePct: 12,
            oiSegments: [5_000_000, 6_000_000, 7_000_000, 8_000_000],
            oiRising: true,
            oiStrong: true,
            fundingRatePct: -0.02,
        },
    },
};

test('strategy input contracts enumerate fields for every registered strategy adapter', () => {
    assert.deepEqual(Object.keys(STRATEGY_INPUT_CONTRACTS).sort(), [
        'capital-inflow',
        'rsrs-trend',
        'sentiment-hotspot',
        'strong-breakout',
        'trend-confirmation',
        'volatility-squeeze',
        'wei-shen-ledger',
    ]);

    Object.values(STRATEGY_INPUT_CONTRACTS).forEach((fields) => {
        assert.ok(fields.length > 0);
    });
});

test('strategy input adapters preserve the declared ticker fields', () => {
    const breakoutInput = toStrongBreakoutStrategyInput(sampleTicker);
    assert.equal(breakoutInput.breakout21dPercent, sampleTicker.breakout21dPercent);
    assert.equal(breakoutInput.volumeChangePercent, sampleTicker.volumeChangePercent);

    const trendInput = toTrendConfirmationStrategyInput(sampleTicker);
    assert.equal(trendInput.gmmaTrend, sampleTicker.gmmaTrend);
    assert.equal(trendInput.betaToBTC, sampleTicker.betaToBTC);

    const inflowInput = toCapitalInflowStrategyInput(sampleTicker);
    assert.equal(inflowInput.cvdSlope, sampleTicker.cvdSlope);
    assert.equal(inflowInput.val, sampleTicker.val);

    const rsrsInput = toRsrsStrategyInput(sampleTicker);
    assert.equal(rsrsInput.rsrsFinal, sampleTicker.rsrsFinal);
    assert.equal(rsrsInput.bollingerMid, sampleTicker.bollingerMid);

    const squeezeInput = toVolatilitySqueezeStrategyInput(sampleTicker);
    assert.equal(squeezeInput.releaseBarsAgo, sampleTicker.releaseBarsAgo);
    assert.equal(squeezeInput.ohlc, sampleTicker.ohlc);

    const weiShenInput = toWeiShenStrategyInput(sampleTicker);
    assert.equal(weiShenInput.strategyContexts, sampleTicker.strategyContexts);
    assert.equal(weiShenInput.closeTime, sampleTicker.closeTime);

    const sentimentHotspotInput = toSentimentHotspotStrategyInput(sampleTicker);
    assert.equal(sentimentHotspotInput.strategyContexts, sampleTicker.strategyContexts);
    assert.equal(sentimentHotspotInput.fundingRate, sampleTicker.fundingRate);
});

test('strategy input readiness summary reports missing key fields per strategy', () => {
    const fallbackTicker: TickerData = {
        symbol: 'LIGHTUSDT',
        lastPrice: '100',
        priceChange: '1',
        priceChangePercent: '2',
        weightedAvgPrice: '99',
        prevClosePrice: '98',
        highPrice: '105',
        lowPrice: '95',
        volume: '1234',
        quoteVolume: '5678',
        openTime: 1,
        closeTime: 2,
    };

    const summary = buildStrategyInputReadinessSummary([fallbackTicker], [
        'strong-breakout',
        'trend-confirmation',
        'capital-inflow',
        'rsrs-trend',
        'volatility-squeeze',
        'wei-shen-ledger',
        'sentiment-hotspot',
    ]);

    assert.equal(summary.totalSymbols, 1);
    assert.equal(summary.byStrategy['capital-inflow'].symbolsMissingRequiredFields, 1);
    assert.ok(summary.byStrategy['capital-inflow'].missingFieldCounts.cvdSlope >= 1);
    assert.equal(summary.byStrategy['rsrs-trend'].symbolsMissingRequiredFields, 1);
    assert.ok(summary.byStrategy['rsrs-trend'].missingFieldCounts.rsrsFinal >= 1);
    assert.equal(summary.byStrategy['volatility-squeeze'].symbolsMissingRequiredFields, 1);
    assert.ok(summary.byStrategy['volatility-squeeze'].missingFieldCounts.squeezeStatus >= 1);
    assert.equal(summary.byStrategy['wei-shen-ledger'].symbolsMissingRequiredFields, 1);
    assert.ok(summary.byStrategy['wei-shen-ledger'].missingFieldCounts['strategyContexts.weiShen'] >= 1);
    assert.equal(summary.byStrategy['sentiment-hotspot'].symbolsMissingRequiredFields, 1);
    assert.ok(summary.byStrategy['sentiment-hotspot'].missingFieldCounts['strategyContexts.sentimentHotspot'] >= 1);
});
