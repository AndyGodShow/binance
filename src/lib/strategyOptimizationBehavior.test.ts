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
import {
    resetStrategyParameterOverrides,
    withStrategyParameterOverrides,
} from './strategyParameters.ts';

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

test('wei-shen strategy detects ledger-derived short setups during short-favored UTC windows', () => {
    const ticker = createTicker({
        symbol: 'WEISHENUSDT',
        closeTime: Date.UTC(2024, 0, 1, 1, 30),
        lastPrice: '100',
        quoteVolume: '50000000',
        volume: '500000',
        priceChangePercent: '-4',
        change15m: -0.4,
        change1h: -1.2,
        change4h: -2.6,
        oiChangePercent: 4.5,
        fundingRate: '0.00012',
        volumeRatio: 1.6,
        bandwidthPercentile: 45,
        atr: 2,
        adx: 24,
        plusDI: 18,
        minusDI: 28,
        gmmaTrend: 'bearish',
        multiEmaTrend: 'bearish',
        ema5mDistancePercent: -1.2,
        bollingerLower: 94,
    });

    const signal = weiShenStrategy.detect(ticker);

    assert.ok(signal, 'qualified ledger-derived short context should trigger');
    assert.equal(signal.strategyId, 'wei-shen-ledger');
    assert.equal(signal.strategyName, '魏神策略');
    assert.equal(signal.direction, 'short');
    assert.ok(signal.confidence >= 80);
    assert.ok(signal.risk, 'signal should include risk management');
    assert.match(signal.risk.positionSizing.reasoning, /账本低胜率高赔率/);
});

test('wei-shen strategy detects ledger-derived long setups during long-favored UTC windows', () => {
    const ticker = createTicker({
        symbol: 'WEISHENLONGUSDT',
        closeTime: Date.UTC(2024, 0, 1, 22, 30),
        lastPrice: '100',
        quoteVolume: '50000000',
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
    });

    const signal = weiShenStrategy.detect(ticker);

    assert.ok(signal, 'qualified ledger-derived long context should trigger');
    assert.equal(signal.direction, 'long');
    assert.ok(signal.confidence >= 80);
});

test('wei-shen strategy can trigger outside inferred UTC windows when market regime is strong', () => {
    const ticker = createTicker({
        symbol: 'WEISHENOFFHOURUSDT',
        closeTime: Date.UTC(2024, 0, 1, 9, 30),
        quoteVolume: '50000000',
        priceChangePercent: '-4',
        change15m: -0.4,
        change1h: -1.2,
        change4h: -2.6,
        oiChangePercent: 4.5,
        fundingRate: '0.00012',
        volumeRatio: 1.6,
        bandwidthPercentile: 45,
        atr: 2,
        adx: 28,
        plusDI: 18,
        minusDI: 30,
        gmmaTrend: 'bearish',
        multiEmaTrend: 'bearish',
        ema5mDistancePercent: -1.3,
        bollingerLower: 94,
    });

    const signal = weiShenStrategy.detect(ticker);

    assert.ok(signal, 'strong market regime should trigger even outside inferred time windows');
    assert.equal(signal.direction, 'short');
    assert.equal(signal.metrics.ledgerTimeBonus, 0);
});

test('wei-shen strategy uses time as a small confidence bonus rather than a hard gate', () => {
    const baseTicker = createTicker({
        symbol: 'WEISHENTIMEBONUSUSDT',
        quoteVolume: '50000000',
        priceChangePercent: '-4',
        change15m: -0.4,
        change1h: -1.2,
        change4h: -2.6,
        oiChangePercent: 4.5,
        fundingRate: '0.00012',
        volumeRatio: 1.6,
        bandwidthPercentile: 45,
        atr: 2,
        adx: 28,
        plusDI: 18,
        minusDI: 30,
        gmmaTrend: 'bearish',
        multiEmaTrend: 'bearish',
        ema5mDistancePercent: -1.3,
        bollingerLower: 94,
    });

    const offWindowSignal = weiShenStrategy.detect({
        ...baseTicker,
        closeTime: Date.UTC(2024, 0, 1, 9, 30),
    });
    cooldownManager.clear();
    const windowSignal = weiShenStrategy.detect({
        ...baseTicker,
        closeTime: Date.UTC(2024, 0, 1, 1, 30),
    });

    assert.ok(offWindowSignal);
    assert.ok(windowSignal);
    assert.ok(windowSignal.confidence > offWindowSignal.confidence);
});

test('wei-shen strategy chooses direction from market regime instead of the old time bucket', () => {
    const ticker = createTicker({
        symbol: 'WEISHENWRONGDIRUSDT',
        closeTime: Date.UTC(2024, 0, 1, 22, 30),
        quoteVolume: '50000000',
        priceChangePercent: '-4',
        change15m: -0.4,
        change1h: -1.2,
        change4h: -2.6,
        oiChangePercent: 4.5,
        fundingRate: '0.00012',
        volumeRatio: 1.6,
        bandwidthPercentile: 45,
        atr: 2,
        adx: 28,
        plusDI: 18,
        minusDI: 30,
        gmmaTrend: 'bearish',
        multiEmaTrend: 'bearish',
        ema5mDistancePercent: -1.3,
        bollingerLower: 94,
    });

    const signal = weiShenStrategy.detect(ticker);

    assert.ok(signal);
    assert.equal(signal.direction, 'short');
});

test('strategy registry exposes wei-shen strategy for the strategy center', () => {
    const strategy = strategyRegistry.getById('wei-shen-ledger');

    assert.equal(strategy?.name, '魏神策略');
    assert.equal(strategy?.category, 'special');
    assert.equal(strategy?.enabled, true);
});
