import assert from 'node:assert/strict';
import test, { beforeEach } from 'node:test';

import { strongBreakoutStrategy, trendConfirmationStrategy, capitalInflowStrategy } from '../strategies/compositeStrategies.ts';
import { rsrsStrategy } from '../strategies/rsrs.ts';
import { volatilitySqueezeStrategy } from '../strategies/volatilitySqueeze.ts';
import { weiShenStrategy } from '../strategies/weiShen.ts';
import { strategyRegistry } from '../strategies/registry.ts';
import type { TickerData } from './types.ts';
import { cooldownManager } from './cooldownManager.ts';
import { trendStateManager } from './trendStateManager.ts';
import { createStrategyRuntimeState } from './strategyRuntimeState.ts';
import { isStrategySignalVisible } from './strategySignalVisibility.ts';
import {
    resetStrategyParameterOverrides,
    withStrategyParameterOverrides,
} from './strategyParameters.ts';

type RichStrategySignal = {
    grade?: 'A' | 'B' | 'C';
    executionMode?: 'trade' | 'observe';
    entryType?: 'breakout' | 'pullback';
    explain?: {
        marketRegime?: {
            summary?: string;
        };
        relativeStrength?: {
            summary?: string;
        };
        passed?: string[];
        failed?: string[];
        blockedReasons?: string[];
        suggestedRiskPct?: number;
        stopLossPrice?: number;
        invalidationPrice?: number;
        entryType?: 'breakout' | 'pullback';
        grade?: 'A' | 'B' | 'C';
    };
};

function detectWeiShen(ticker: TickerData, context?: unknown) {
    return (weiShenStrategy.detect as unknown as (nextTicker: TickerData, nextContext?: unknown) => ReturnType<typeof weiShenStrategy.detect>)(ticker, context);
}

function createWeiShenContext(overrides: Record<string, unknown> = {}) {
    return {
        regime: {
            state: 'bull-trend',
            allowLong: true,
            allowShort: false,
            onlyAGrade: false,
            summary: 'BTC 4h 多头趋势成立，允许顺势做多',
            passed: ['BTC 4h 趋势结构完成'],
            failed: [],
        },
        relativeStrength: {
            passed: true,
            reasons: ['24h 成交额达标', '相对 BTC 强度达标'],
            slope1h: 0.8,
            excessReturn4h: 1.2,
            volume24hUsd: 2_500_000_000,
            minVolume24hUsd: 2_000_000_000,
            minExcessReturn4h: 0.3,
            summary: '相对 BTC 强弱与流动性通过',
            passedReasons: ['24h 成交额达标', '相对 BTC 强度达标'],
            failedReasons: [],
            directional: {
                long: {
                    passed: true,
                    reasons: ['24h 成交额达标', '相对 BTC 强度达标'],
                    failedReasons: [],
                },
                short: {
                    passed: false,
                    reasons: ['24h 成交额达标'],
                    failedReasons: ['相对 BTC 未转弱'],
                },
            },
        },
        entries: {
            breakout: {
                long: {
                    eligible: true,
                    grade: 'A',
                    passed: ['1h/4h 同向', '突破 Donchian 高点', '放量确认'],
                    failed: [],
                    stopLossPrice: 96,
                    invalidationPrice: 95.5,
                    suggestedRiskPct: 0.75,
                },
                short: {
                    eligible: false,
                    grade: 'C',
                    passed: [],
                    failed: ['空头趋势未建立'],
                    stopLossPrice: 0,
                    invalidationPrice: 0,
                    suggestedRiskPct: 0,
                },
            },
            pullback: {
                long: {
                    eligible: false,
                    grade: 'C',
                    passed: [],
                    failed: ['当前不是回踩结构'],
                    stopLossPrice: 0,
                    invalidationPrice: 0,
                    suggestedRiskPct: 0,
                },
                short: {
                    eligible: false,
                    grade: 'C',
                    passed: [],
                    failed: ['当前不是回踩结构'],
                    stopLossPrice: 0,
                    invalidationPrice: 0,
                    suggestedRiskPct: 0,
                },
            },
        },
        ...overrides,
    };
}

function attachWeiShenContext(
    ticker: TickerData,
    weiShenContext: Record<string, unknown>,
): TickerData {
    return {
        ...ticker,
        strategyContexts: {
            weiShen: weiShenContext,
        },
    } as unknown as TickerData;
}

function createTicker(overrides: Partial<TickerData> = {}): TickerData {
    return {
        symbol: 'BTCUSDT',
        lastPrice: '100',
        priceChange: '0',
        priceChangePercent: '0',
        weightedAvgPrice: '100',
        prevClosePrice: '100',
        highPrice: '101',
        lowPrice: '99',
        volume: '1000',
        quoteVolume: '10000000',
        openTime: 0,
        closeTime: 60_000,
        ...overrides,
    };
}

beforeEach(() => {
    cooldownManager.clear();
    trendStateManager.clear();
    resetStrategyParameterOverrides();
});

test('strong-breakout reads thresholds from the shared strategy parameter config', () => {
    const ticker = createTicker({
        symbol: 'STRONGBREAKOUTUSDT',
        lastPrice: '101.5',
        priceChangePercent: '13',
        quoteVolume: '15000000',
        change15m: 3,
        change1h: 5,
        change4h: 9,
        breakout21dHigh: 100,
        breakout21dPercent: 0.8,
        ema5m20: 100,
        ema5m60: 99,
        ema5m100: 98,
        ema5mDistancePercent: 1.5,
        oiChangePercent: 20,
        atr: 1,
        keltnerLower: 97,
        volumeChangePercent: 6,
    });

    const baseline = strongBreakoutStrategy.detect(ticker);
    assert.ok(baseline, 'baseline parameters should allow the signal');

    const overridden = withStrategyParameterOverrides({
        'strong-breakout': {
            minVolume24h: 20_000_000,
        },
    }, () => strongBreakoutStrategy.detect(ticker));

    assert.equal(overridden, null);
});

test('explicit strategy runtime state keeps cooldown isolated from the global singleton', () => {
    const ticker = createTicker({
        symbol: 'ISOLATEDBREAKOUTUSDT',
        lastPrice: '101.5',
        priceChangePercent: '13',
        quoteVolume: '15000000',
        change15m: 3,
        change1h: 5,
        change4h: 9,
        breakout21dHigh: 100,
        breakout21dPercent: 0.8,
        ema5m20: 100,
        ema5m60: 99,
        ema5m100: 98,
        ema5mDistancePercent: 1.5,
        oiChangePercent: 20,
        atr: 1,
        keltnerLower: 97,
        volumeChangePercent: 6,
    });
    const runtimeState = createStrategyRuntimeState();

    const first = strongBreakoutStrategy.detect(ticker, { runtimeState });
    const second = strongBreakoutStrategy.detect(ticker, { runtimeState });
    const global = strongBreakoutStrategy.detect(ticker);

    assert.ok(first);
    assert.equal(second, null, 'isolated runtime state should retain its own cooldown');
    assert.ok(global, 'global singleton should remain untouched by isolated runtime state');
    assert.equal(cooldownManager.snapshot().size, 1, 'only the explicit global detect should populate the singleton cooldown');
});

test('trend-confirmation blocks high BTC-correlation symbols that are not stronger than BTC', () => {
    const ticker = createTicker({
        symbol: 'TRENDBETAUSDT',
        lastPrice: '102',
        quoteVolume: '12000000',
        openInterestValue: '10000000',
        change15m: 0.6,
        change1h: 1.4,
        change4h: 3.2,
        oiChangePercent: 5,
        ema5mDistancePercent: 1.2,
        gmmaTrend: 'bullish',
        multiEmaTrend: 'bullish',
        multiEmaAlignmentScore: 3,
        betaToBTC: 1.05,
        correlationToBTC: 0.95,
        atr: 1,
        keltnerMid: 100,
        keltnerLower: 98,
        keltnerUpper: 104,
        bandwidthPercentile: 50,
    });

    const signal = withStrategyParameterOverrides({
        'trend-confirmation': {
            betaFilter: {
                enabled: true,
            },
        },
    }, () => trendConfirmationStrategy.detect(ticker));

    assert.equal(signal, null);
});

test('trend-confirmation forwards bandwidth percentile into risk management', () => {
    const ticker = createTicker({
        symbol: 'TRENDRISKUSDT',
        lastPrice: '102',
        quoteVolume: '12000000',
        openInterestValue: '10000000',
        change15m: 0.6,
        change1h: 1.4,
        change4h: 3.2,
        oiChangePercent: 5,
        ema5mDistancePercent: 1.2,
        gmmaTrend: 'bullish',
        multiEmaTrend: 'bullish',
        multiEmaAlignmentScore: 3,
        betaToBTC: 1.3,
        correlationToBTC: 0.6,
        atr: 1,
        keltnerMid: 100,
        keltnerLower: 98,
        keltnerUpper: 104,
        bandwidthPercentile: 85,
    });

    const signal = trendConfirmationStrategy.detect(ticker);
    assert.ok(signal?.risk, 'signal should include risk data');
    assert.match(signal.risk.stopLoss.reason, /高波动宽止损/);
});

test('capital-inflow no longer falls back to price-only breakouts when volume profile data is missing', () => {
    const ticker = createTicker({
        symbol: 'CAPITALFLOWUSDT',
        lastPrice: '112',
        priceChangePercent: '12',
        quoteVolume: '40000000',
        change15m: 6,
        change1h: 9,
        change4h: 6,
        volumeMA: 20_000_000,
        cvd: 1000,
        cvdSlope: 10,
        atr: 1,
    });

    const signal = withStrategyParameterOverrides({
        'capital-inflow': {
            volumeProfile: {
                requireVolumeProfile: true,
                allowPriceOnlyFallback: false,
            },
        },
    }, () => capitalInflowStrategy.detect(ticker));

    assert.equal(signal, null);
});

test('rsrs-trend rejects extreme signals that are already decelerating', () => {
    const ticker = createTicker({
        symbol: 'RSRSDECELUSDT',
        lastPrice: '100',
        volume: '200',
        quoteVolume: '20000000',
        rsrs: 1.8,
        rsrsZScore: 1.5,
        rsrsFinal: 3,
        rsrsR2: 0.9,
        rsrsDynamicLongThreshold: 1.5,
        rsrsDynamicShortThreshold: -1.5,
        rsrsROC: 20,
        rsrsAcceleration: -6,
        change15m: 4,
        change1h: 4,
        change4h: 4,
        volumeMA: 100,
        bollingerUpper: 110,
        bollingerLower: 90,
    });

    const signal = withStrategyParameterOverrides({
        'rsrs-trend': {
            rejectExtremeDecelerating: true,
        },
    }, () => rsrsStrategy.detect(ticker));

    assert.equal(signal, null);
});

test('rsrs-trend can consume explicit parameter overrides from detection context', () => {
    const ticker = createTicker({
        symbol: 'RSRSCONTEXTUSDT',
        lastPrice: '100',
        volume: '300',
        change15m: 4,
        change1h: 4,
        change4h: 4,
        volumeMA: 100,
        rsrs: 1.1,
        rsrsFinal: 2.5,
        rsrsZScore: 1.8,
        rsrsR2: 0.82,
        rsrsROC: 20,
        rsrsAcceleration: -12,
        rsrsDynamicLongThreshold: 1.5,
        rsrsDynamicShortThreshold: -1.5,
        bollingerUpper: 110,
        bollingerLower: 90,
    });

    const baseline = rsrsStrategy.detect(ticker);
    assert.ok(baseline, 'baseline context should allow the signal');

    const overridden = rsrsStrategy.detect(ticker, {
        now: Date.now(),
        parameterOverrides: {
            'rsrs-trend': {
                rejectExtremeDecelerating: true,
            },
        },
    });

    assert.equal(overridden, null);
});

test('rsrs-trend forwards rsrsR2 into risk management so high-fit setups earn the bonus', () => {
    const ticker = createTicker({
        symbol: 'RSRSR2USDT',
        lastPrice: '100',
        volume: '200',
        quoteVolume: '20000000',
        rsrs: 1.8,
        rsrsZScore: 1.5,
        rsrsFinal: 2.5,
        rsrsR2: 0.9,
        rsrsDynamicLongThreshold: 1.5,
        rsrsDynamicShortThreshold: -1.5,
        rsrsROC: 20,
        rsrsAcceleration: 0,
        change15m: 4,
        change1h: 4,
        change4h: 4,
        volumeMA: 100,
        bollingerUpper: 110,
        bollingerLower: 90,
    });

    const signal = rsrsStrategy.detect(ticker);
    assert.ok(signal?.risk, 'signal should include risk data');
    assert.match(signal.risk.positionSizing.reasoning, /策略加成5%/);
});

test('volatility-squeeze can be tightened through the shared strategy parameter config', () => {
    const ticker = createTicker({
        symbol: 'SQUEEZEUSDT',
        lastPrice: '105',
        quoteVolume: '30000000',
        atr: 1,
        squeezeStatus: 'on',
        momentumColor: 'cyan',
        momentumValue: 2,
        lastSqueezeDuration: 12,
        bandwidthPercentile: 6,
        releaseBarsAgo: 1,
        keltnerMid: 100,
        keltnerUpper: 108,
        keltnerLower: 97,
        adx: 28,
        plusDI: 30,
        minusDI: 18,
        volumeRatio: 2.1,
        ohlc: [
            { time: 1, open: 98, high: 99, low: 97, close: 98.5, volume: 1000 },
            { time: 2, open: 98.5, high: 99.2, low: 98, close: 99, volume: 1000 },
            { time: 3, open: 99, high: 99.5, low: 98.7, close: 99.2, volume: 1000 },
            { time: 4, open: 99.2, high: 99.8, low: 99, close: 99.4, volume: 1000 },
            { time: 5, open: 99.4, high: 100, low: 99.1, close: 99.6, volume: 1000 },
            { time: 6, open: 101, high: 106, low: 100.5, close: 105, volume: 2000 },
        ],
    });

    const baseline = volatilitySqueezeStrategy.detect(ticker);
    assert.ok(baseline, 'baseline parameters should allow the squeeze setup');

    const tightened = withStrategyParameterOverrides({
        'volatility-squeeze': {
            requireImmediateRelease: true,
            maxReleaseBarsAgo: 0,
        },
    }, () => volatilitySqueezeStrategy.detect(ticker));

    assert.equal(tightened, null);
});

test('wei-shen only scans the explicit BTC-led universe', () => {
    const ticker = attachWeiShenContext(createTicker({
        symbol: 'ADAUSDT',
        closeTime: Date.UTC(2024, 0, 1, 22, 30),
        lastPrice: '100',
        quoteVolume: '5000000000',
        volume: '500000',
        priceChangePercent: '4',
        change15m: 0.4,
        change1h: 1.2,
        change4h: 2.6,
        oiChangePercent: 4.5,
        fundingRate: '0.00008',
        volumeRatio: 1.6,
        bandwidthPercentile: 45,
        atr: 2,
        adx: 24,
        plusDI: 28,
        minusDI: 18,
        gmmaTrend: 'bullish',
        multiEmaTrend: 'bullish',
        ema5mDistancePercent: 1.2,
        bollingerUpper: 106,
    }), createWeiShenContext());

    const signal = detectWeiShen(ticker, {
        now: ticker.closeTime,
    });

    assert.equal(signal, null);
});

test('wei-shen blocks ETH breakouts when BTC market regime is risk-off', () => {
    const ethTicker = attachWeiShenContext(createTicker({
        symbol: 'ETHUSDT',
        closeTime: Date.UTC(2024, 0, 1, 22, 30),
        lastPrice: '100',
        quoteVolume: '3000000000',
        volume: '500000',
        priceChangePercent: '4',
        change15m: 0.4,
        change1h: 1.2,
        change4h: 2.6,
        oiChangePercent: 4.5,
        fundingRate: '0.00008',
        volumeRatio: 1.6,
        bandwidthPercentile: 45,
        atr: 2,
        adx: 24,
        plusDI: 28,
        minusDI: 18,
        gmmaTrend: 'bullish',
        multiEmaTrend: 'bullish',
        ema5mDistancePercent: 1.2,
        bollingerUpper: 106,
    }), createWeiShenContext({
        regime: {
            state: 'risk-off',
            allowLong: false,
            allowShort: false,
            onlyAGrade: false,
            summary: 'BTC 风险关闭，禁止新开仓',
            passed: [],
            failed: ['BTC 风险关闭'],
        },
    }));

    const signal = detectWeiShen(ethTicker, {
        now: ethTicker.closeTime,
    });

    assert.equal(signal, null);
});

test('wei-shen emits A-grade BTC breakout trades with structured explain output', () => {
    const btcTicker = attachWeiShenContext(createTicker({
        symbol: 'BTCUSDT',
        closeTime: Date.UTC(2024, 0, 1, 22, 30),
        lastPrice: '100',
        quoteVolume: '6000000000',
        volume: '500000',
        priceChangePercent: '4',
        change15m: 0.4,
        change1h: 1.2,
        change4h: 2.6,
        oiChangePercent: 4.5,
        fundingRate: '0.00008',
        volumeRatio: 1.6,
        bandwidthPercentile: 45,
        atr: 2,
        adx: 24,
        plusDI: 28,
        minusDI: 18,
        gmmaTrend: 'bullish',
        multiEmaTrend: 'bullish',
        ema5mDistancePercent: 1.2,
        bollingerUpper: 106,
    }), createWeiShenContext());

    const signal = detectWeiShen(btcTicker, {
        now: btcTicker.closeTime,
    }) as (ReturnType<typeof weiShenStrategy.detect> & RichStrategySignal);

    assert.ok(signal, 'BTC should be able to emit a tradable A-grade breakout');
    assert.equal(signal.grade, 'A');
    assert.equal(signal.executionMode, 'trade');
    assert.equal(signal.entryType, 'breakout');
    assert.equal(signal.explain?.grade, 'A');
    assert.equal(signal.explain?.entryType, 'breakout');
    assert.ok((signal.explain?.marketRegime?.summary || '').length > 0);
    assert.ok((signal.explain?.relativeStrength?.summary || '').length > 0);
    assert.ok((signal.explain?.passed || []).length > 0);
    assert.equal(signal.explain?.failed?.length || 0, 0);
    assert.ok((signal.explain?.suggestedRiskPct || 0) > 0);
    assert.ok((signal.explain?.stopLossPrice || 0) > 0);
    assert.ok((signal.explain?.invalidationPrice || 0) > 0);
});

test('wei-shen keeps B-grade tradable signals visible in the live chain', () => {
    const ethTicker = attachWeiShenContext(createTicker({
        symbol: 'ETHUSDT',
        closeTime: Date.UTC(2024, 0, 1, 23, 30),
        lastPrice: '2200',
        quoteVolume: '3200000000',
    }), createWeiShenContext({
        entries: {
            breakout: {
                long: {
                    eligible: true,
                    grade: 'B',
                    confidenceScore: 84,
                    passed: ['1h/4h 同向', '突破 Donchian 高点', '放量但未达到 A 级'],
                    failed: [],
                    stopLossPrice: 2145,
                    invalidationPrice: 2160,
                    suggestedRiskPct: 0.45,
                    blockedReasons: [],
                },
                short: {
                    eligible: false,
                    grade: 'C',
                    confidenceScore: 70,
                    passed: [],
                    failed: ['空头不成立'],
                    stopLossPrice: 0,
                    invalidationPrice: 0,
                    suggestedRiskPct: 0,
                    blockedReasons: [],
                },
            },
            pullback: {
                long: {
                    eligible: false,
                    grade: 'C',
                    confidenceScore: 70,
                    passed: [],
                    failed: ['当前不是回踩结构'],
                    stopLossPrice: 0,
                    invalidationPrice: 0,
                    suggestedRiskPct: 0,
                    blockedReasons: [],
                },
                short: {
                    eligible: false,
                    grade: 'C',
                    confidenceScore: 70,
                    passed: [],
                    failed: ['空头不成立'],
                    stopLossPrice: 0,
                    invalidationPrice: 0,
                    suggestedRiskPct: 0,
                    blockedReasons: [],
                },
            },
        },
    }));

    const signal = detectWeiShen(ethTicker, {
        now: ethTicker.closeTime,
    }) as (ReturnType<typeof weiShenStrategy.detect> & RichStrategySignal);

    assert.ok(signal);
    assert.equal(signal.grade, 'B');
    assert.equal(signal.executionMode, 'trade');
    assert.equal(signal.confidence, 84);
    assert.equal(isStrategySignalVisible(signal as never), true);
});

test('wei-shen downgrades DOGE pullbacks to C-grade observe-only signals', () => {
    const dogeTicker = attachWeiShenContext(createTicker({
        symbol: 'DOGEUSDT',
        closeTime: Date.UTC(2024, 0, 1, 22, 30),
        lastPrice: '0.1',
        quoteVolume: '1200000000',
        volume: '500000',
        priceChangePercent: '4',
        change15m: 0.4,
        change1h: 1.2,
        change4h: 2.6,
        oiChangePercent: 4.5,
        fundingRate: '0.00008',
        volumeRatio: 1.6,
        bandwidthPercentile: 45,
        atr: 2,
        adx: 24,
        plusDI: 28,
        minusDI: 18,
        gmmaTrend: 'bullish',
        multiEmaTrend: 'bullish',
        ema5mDistancePercent: 1.2,
        bollingerUpper: 0.12,
    }), createWeiShenContext({
        entries: {
            breakout: {
                long: {
                    eligible: false,
                    grade: 'C',
                    passed: ['DOGE 不是最强动量突破'],
                    failed: ['普通突破质量不足'],
                    stopLossPrice: 0.09,
                    invalidationPrice: 0.089,
                    suggestedRiskPct: 0,
                },
                short: {
                    eligible: false,
                    grade: 'C',
                    passed: [],
                    failed: ['空头不成立'],
                    stopLossPrice: 0,
                    invalidationPrice: 0,
                    suggestedRiskPct: 0,
                },
            },
            pullback: {
                long: {
                    eligible: true,
                    grade: 'C',
                    passed: ['出现回踩结构'],
                    failed: ['DOGE 默认禁用宽松回踩'],
                    stopLossPrice: 0.094,
                    invalidationPrice: 0.093,
                    suggestedRiskPct: 0,
                },
                short: {
                    eligible: false,
                    grade: 'C',
                    passed: [],
                    failed: ['空头不成立'],
                    stopLossPrice: 0,
                    invalidationPrice: 0,
                    suggestedRiskPct: 0,
                },
            },
        },
    }));

    const signal = detectWeiShen(dogeTicker, {
        now: dogeTicker.closeTime,
    }) as (ReturnType<typeof weiShenStrategy.detect> & RichStrategySignal);

    assert.ok(signal, 'DOGE should still surface as an observation signal');
    assert.equal(signal.grade, 'C');
    assert.equal(signal.executionMode, 'observe');
    assert.equal(signal.entryType, 'pullback');
    assert.equal(signal.explain?.grade, 'C');
    assert.equal(signal.explain?.entryType, 'pullback');
    assert.equal(signal.explain?.suggestedRiskPct, 0);
    assert.ok((signal.explain?.blockedReasons || []).length > 0);
});

test('strategy registry exposes wei-shen strategy for the strategy center', () => {
    const strategy = strategyRegistry.getById('wei-shen-ledger');

    assert.equal(strategy?.name, '魏神策略');
    assert.equal(strategy?.category, 'special');
    assert.equal(strategy?.enabled, true);
});
