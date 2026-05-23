import assert from 'node:assert/strict';
import test from 'node:test';

import type { TickerData } from './types.ts';
import {
    calculateSentimentHotspotEntryContext,
    calculateSentimentHotspotOiSignal,
    classifySentimentHotspotCandidate,
    evaluateSentimentFundingTurn,
    evaluateSentimentHotspotExitMonitor,
    clearSentimentHotspotCachesForTest,
    fetchSentimentHotspotContextMap,
    isSentimentHotspotSquareCandidate,
} from './sentimentHotspot.ts';
import { sentimentHotspotStrategy } from '../strategies/sentimentHotspot.ts';
import { createStrategyRuntimeState } from './strategyRuntimeState.ts';

function createTicker(overrides: Partial<TickerData> = {}): TickerData {
    return {
        symbol: 'SAGAUSDT',
        lastPrice: '1.25',
        priceChange: '0.08',
        priceChangePercent: '8.4',
        weightedAvgPrice: '1.19',
        prevClosePrice: '1.17',
        highPrice: '1.32',
        lowPrice: '1.12',
        volume: '12000000',
        quoteVolume: '64000000',
        openTime: 1,
        closeTime: 2,
        fundingRate: '-0.00036',
        openInterestValue: '7200000',
        strategyContexts: {
            sentimentHotspot: {
                heatSourceCount: 2,
                hasSquare: false,
                hasCoinGecko: true,
                hasVolSurge: true,
                volumeSurgeRatio: 3.4,
                oiUsd: 7_200_000,
                oiChangePct: 13.5,
                oiSegments: [5_800_000, 6_100_000, 6_750_000, 6_583_000],
                oiRising: true,
                oiStrong: true,
                fundingRatePct: -0.036,
            },
        },
        ...overrides,
    };
}

test('calculateSentimentHotspotOiSignal requires four strictly rising OI segments', () => {
    const rising = calculateSentimentHotspotOiSignal([
        100, 101, 102, 103,
        111, 112, 113, 114,
        123, 124, 125, 126,
        136, 137, 138, 139,
    ]);

    assert.equal(rising.oiRising, true);
    assert.deepEqual(rising.oiSegments.map((value) => Math.round(value)), [102, 113, 125, 138]);
    assert.ok(rising.oiChangePct >= 30);

    const spiky = calculateSentimentHotspotOiSignal([
        100, 101, 102, 103,
        140, 150, 160, 170,
        120, 121, 122, 123,
        132, 133, 134, 135,
    ]);

    assert.equal(spiky.oiRising, false);
});

test('classifySentimentHotspotCandidate separates A+ and core long candidates', () => {
    const aPlus = classifySentimentHotspotCandidate({
        heatSourceCount: 2,
        hasSquare: false,
        hasCoinGecko: true,
        hasVolSurge: true,
        volume24h: 64_000_000,
        oiUsd: 7_200_000,
        oiRising: true,
        oiChangePct: 13.5,
        fundingRatePct: -0.036,
        priceChange24h: 8.4,
    });

    assert.equal(aPlus.type, 'A_PLUS_LONG');

    const core = classifySentimentHotspotCandidate({
        heatSourceCount: 2,
        hasSquare: true,
        hasCoinGecko: true,
        hasVolSurge: false,
        volume24h: 12_000_000,
        oiUsd: 5_800_000,
        oiRising: true,
        oiChangePct: 8.5,
        fundingRatePct: -0.012,
        priceChange24h: 12,
    });

    assert.equal(core.type, 'CORE_LONG');
});

test('classifySentimentHotspotCandidate rejects noisy or overheated candidates', () => {
    const onlyCg = classifySentimentHotspotCandidate({
        heatSourceCount: 1,
        hasSquare: false,
        hasCoinGecko: true,
        hasVolSurge: false,
        volume24h: 80_000_000,
        oiUsd: 10_000_000,
        oiRising: true,
        oiChangePct: 14,
        fundingRatePct: -0.04,
        priceChange24h: 9,
    });
    assert.equal(onlyCg.type, 'IGNORE');
    assert.match(onlyCg.reason, /热度来源不足/);

    const overheated = classifySentimentHotspotCandidate({
        heatSourceCount: 2,
        hasSquare: true,
        hasCoinGecko: true,
        hasVolSurge: false,
        volume24h: 80_000_000,
        oiUsd: 10_000_000,
        oiRising: true,
        oiChangePct: 14,
        fundingRatePct: -0.04,
        priceChange24h: 32,
    });
    assert.equal(overheated.type, 'RISK_OVERHEATED');
});

test('isSentimentHotspotSquareCandidate limits square hashtag checks to liquid active symbols', () => {
    assert.equal(isSentimentHotspotSquareCandidate({
        volume24h: 12_000_000,
        priceChange24h: 8,
        fundingRatePct: -0.012,
        oiChangePct: 8.5,
        volumeSurgeRatio: 3.1,
    }), true);

    assert.equal(isSentimentHotspotSquareCandidate({
        volume24h: 8_000_000,
        priceChange24h: 12,
        fundingRatePct: -0.04,
        oiChangePct: 18,
        volumeSurgeRatio: 5,
    }), false);

    assert.equal(isSentimentHotspotSquareCandidate({
        volume24h: 1_200_000_000,
        priceChange24h: 12,
        fundingRatePct: -0.04,
        oiChangePct: 18,
        volumeSurgeRatio: 5,
    }), false);

    assert.equal(isSentimentHotspotSquareCandidate({
        volume24h: 12_000_000,
        priceChange24h: 4,
        fundingRatePct: -0.012,
        oiChangePct: 8.5,
        volumeSurgeRatio: 3.1,
    }), false);

    assert.equal(isSentimentHotspotSquareCandidate({
        volume24h: 12_000_000,
        priceChange24h: 8,
        fundingRatePct: -0.006,
        oiChangePct: 8.5,
        volumeSurgeRatio: 3.1,
    }), false);

    assert.equal(isSentimentHotspotSquareCandidate({
        volume24h: 12_000_000,
        priceChange24h: 8,
        fundingRatePct: -0.012,
        oiChangePct: 6,
        volumeSurgeRatio: 3.1,
    }), false);
});

test('evaluateSentimentFundingTurn detects a meaningful positive-to-negative flip', () => {
    assert.deepEqual(evaluateSentimentFundingTurn(0.003, -0.012), {
        prevFundingRatePct: 0.003,
        fundingTurnedNegative: true,
    });

    assert.equal(evaluateSentimentFundingTurn(0.001, -0.012).fundingTurnedNegative, false);
    assert.equal(evaluateSentimentFundingTurn(0.003, -0.006).fundingTurnedNegative, false);
    assert.equal(evaluateSentimentFundingTurn(undefined, -0.012).fundingTurnedNegative, false);
});

test('calculateSentimentHotspotEntryContext marks breakout readiness without chasing a hot 15m candle', () => {
    const baseKlines = [
        { time: 1, open: 95, high: 99, low: 94, close: 98, volume: 10 },
        { time: 2, open: 98, high: 101, low: 97, close: 100, volume: 12 },
        { time: 3, open: 100, high: 103, low: 99, close: 102, volume: 14 },
        { time: 4, open: 102, high: 104, low: 101, close: 103, volume: 16 },
        { time: 5, open: 103, high: 106, low: 102, close: 105, volume: 18 },
    ];

    const ready = calculateSentimentHotspotEntryContext(baseKlines, 105.5);
    assert.ok(ready);
    assert.equal(ready.breakoutConfirmed, true);
    assert.equal(ready.avoidChase, false);
    assert.equal(ready.entryHint, 'breakout-ready');
    assert.equal(ready.oneHourHigh, 104);

    const hot = calculateSentimentHotspotEntryContext([
        ...baseKlines.slice(0, 4),
        { time: 5, open: 103, high: 112, low: 102, close: 111, volume: 30 },
    ], 111.5);
    assert.ok(hot);
    assert.equal(hot.breakoutConfirmed, false);
    assert.equal(hot.avoidChase, true);
    assert.equal(hot.entryHint, 'avoid-chase');
});

test('evaluateSentimentHotspotExitMonitor escalates structural and fuel failures', () => {
    const structural = evaluateSentimentHotspotExitMonitor({
        currentPrice: 96,
        launchZoneLow: 97,
        oiChangePct: 9,
        oiRising: true,
        fundingRatePct: -0.02,
        volumeSurgeRatio: 3.2,
        priceChangeSinceSignalPct: -1,
        elapsedMs: 30 * 60 * 1000,
    });
    assert.equal(structural.level, 'exit');
    assert.match(structural.reasons.join(' '), /跌破启动区/);

    const fuelReleased = evaluateSentimentHotspotExitMonitor({
        currentPrice: 103,
        launchZoneLow: 97,
        oiChangePct: -1.2,
        oiRising: false,
        fundingRatePct: -0.01,
        volumeSurgeRatio: 2,
        priceChangeSinceSignalPct: -0.4,
        elapsedMs: 40 * 60 * 1000,
    });
    assert.equal(fuelReleased.level, 'exit');
    assert.match(fuelReleased.reasons.join(' '), /OI下降/);

    const hold = evaluateSentimentHotspotExitMonitor({
        currentPrice: 106,
        launchZoneLow: 97,
        oiChangePct: 10,
        oiRising: true,
        fundingRatePct: -0.02,
        volumeSurgeRatio: 3.1,
        priceChangeSinceSignalPct: 4,
        elapsedMs: 60 * 60 * 1000,
    });
    assert.equal(hold.level, 'hold');
});

test('fetchSentimentHotspotContextMap can build current OI context without historical segments', async () => {
    clearSentimentHotspotCachesForTest();
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => new Response(JSON.stringify({ coins: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
    })) as typeof fetch;

    try {
        const contexts = await fetchSentimentHotspotContextMap(
            [createTicker({
                fundingRate: '-0.00005',
                oiChangePercent: 9.5,
            })],
            new Map([[
                'SAGAUSDT',
                [
                    { time: 1, open: 1, high: 1.1, low: 0.9, close: 1, volume: 10, quoteVolume: 10_000_000 },
                    { time: 2, open: 1, high: 1.1, low: 0.9, close: 1, volume: 10, quoteVolume: 10_000_000 },
                    { time: 3, open: 1, high: 1.1, low: 0.9, close: 1, volume: 10, quoteVolume: 10_000_000 },
                    { time: 4, open: 1, high: 1.1, low: 0.9, close: 1, volume: 10, quoteVolume: 10_000_000 },
                    { time: 5, open: 1, high: 1.1, low: 0.9, close: 1, volume: 10, quoteVolume: 10_000_000 },
                ],
            ]]),
            new Map(),
            { oiSignalMode: 'current' },
        );

        const context = contexts.get('SAGAUSDT');
        assert.ok(context);
        assert.equal(context.oiChangePct, 9.5);
        assert.equal(context.oiRising, true);
        assert.deepEqual(context.oiSegments, []);
    } finally {
        globalThis.fetch = originalFetch;
    }
});

test('fetchSentimentHotspotContextMap reuses CoinGecko trending lookups across calls', async () => {
    clearSentimentHotspotCachesForTest();
    const originalFetch = globalThis.fetch;
    let fetchCount = 0;
    globalThis.fetch = (async () => {
        fetchCount += 1;
        return new Response(JSON.stringify({ coins: [] }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
        });
    }) as typeof fetch;

    try {
        await fetchSentimentHotspotContextMap([], new Map(), new Map(), { oiSignalMode: 'current' });
        await fetchSentimentHotspotContextMap([], new Map(), new Map(), { oiSignalMode: 'current' });

        assert.equal(fetchCount, 1);
    } finally {
        globalThis.fetch = originalFetch;
        clearSentimentHotspotCachesForTest();
    }
});

test('sentimentHotspotStrategy emits only tradeable sentiment hotspot signals', () => {
    const signal = sentimentHotspotStrategy.detect(createTicker(), { now: 1234567890 });

    assert.ok(signal);
    assert.equal(signal.strategyId, 'sentiment-hotspot');
    assert.equal(signal.strategyName, '情绪热点');
    assert.equal(signal.direction, 'long');
    assert.equal(signal.grade, 'A');
    assert.equal(signal.timestamp, 1234567890);
    assert.equal(signal.metrics.fundingRatePct, -0.036);
    assert.equal(signal.metrics.oiChangePct, 13.5);
    assert.equal(signal.metrics.heatSourceCount, 2);
    assert.match(signal.reason, /A\+做多候选/);

    const weak = sentimentHotspotStrategy.detect(createTicker({
        strategyContexts: {
            sentimentHotspot: {
                heatSourceCount: 1,
                hasSquare: false,
                hasCoinGecko: true,
                hasVolSurge: false,
                volumeSurgeRatio: 1,
                oiUsd: 7_200_000,
                oiChangePct: 13.5,
                oiSegments: [5_800_000, 6_100_000, 6_750_000, 7_100_000],
                oiRising: true,
                oiStrong: true,
                fundingRatePct: -0.036,
            },
        },
    }));

    assert.equal(weak, null);
});

test('sentimentHotspotStrategy evaluate-only mode does not write cooldown', () => {
    const runtimeState = createStrategyRuntimeState();
    const first = sentimentHotspotStrategy.detect(createTicker(), {
        now: 1234567890,
        runtimeState,
        cooldownPolicy: 'evaluate-only',
    });
    const second = sentimentHotspotStrategy.detect(createTicker(), {
        now: 1234567990,
        runtimeState,
        cooldownPolicy: 'evaluate-only',
    });

    assert.ok(first);
    assert.ok(second);
    assert.equal(runtimeState.cooldown.snapshot().size, 0);
});
