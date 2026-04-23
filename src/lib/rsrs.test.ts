import assert from 'node:assert/strict';
import test from 'node:test';

import type { KlineData } from '../app/api/backtest/klines/route.ts';
import { calculateRsrsMetrics } from './rsrs.ts';
import { TechnicalIndicators } from './technicalIndicators.ts';

function createKlines(count: number): KlineData[] {
    return Array.from({ length: count }, (_, index) => {
        const base = 100 + index * 0.8 + Math.sin(index / 4) * 2;
        const low = base - 2 - (index % 3) * 0.1;
        const high = base + 2 + (index % 4) * 0.15;
        const open = base - 0.6;
        const close = base + 0.4;
        const volume = 1000 + index * 25;
        const quoteVolume = volume * close;

        return {
            openTime: index * 60_000,
            open: open.toFixed(6),
            high: high.toFixed(6),
            low: low.toFixed(6),
            close: close.toFixed(6),
            volume: volume.toFixed(6),
            closeTime: index * 60_000 + 59_999,
            quoteVolume: quoteVolume.toFixed(6),
            trades: 100 + index,
            takerBuyVolume: (volume * 0.52).toFixed(6),
            takerBuyQuoteVolume: (quoteVolume * 0.52).toFixed(6),
        };
    });
}

function createChoppyKlines(count: number): KlineData[] {
    return Array.from({ length: count }, (_, index) => {
        const wobble = index % 2 === 0 ? 6 : -6;
        const base = 100 + wobble + Math.sin(index) * 0.5;
        const low = base - 2.2;
        const high = base + 2.2;
        const open = base - 0.4;
        const close = base + 0.4;
        const volume = 800 + (index % 5) * 20;
        const quoteVolume = volume * close;

        return {
            openTime: index * 60_000,
            open: open.toFixed(6),
            high: high.toFixed(6),
            low: low.toFixed(6),
            close: close.toFixed(6),
            volume: volume.toFixed(6),
            closeTime: index * 60_000 + 59_999,
            quoteVolume: quoteVolume.toFixed(6),
            trades: 50 + index,
            takerBuyVolume: (volume * 0.48).toFixed(6),
            takerBuyQuoteVolume: (quoteVolume * 0.48).toFixed(6),
        };
    });
}

test('calculateRsrsMetrics returns deterministic shared metrics for adequate history', () => {
    const klines = createKlines(150);

    const metrics = calculateRsrsMetrics(klines.map((kline) => ({
        high: parseFloat(kline.high),
        low: parseFloat(kline.low),
        close: parseFloat(kline.close),
        volume: parseFloat(kline.volume),
    })));

    assert.ok(metrics);
    assert.equal(metrics.method, 'VW-TLS + Median/MAD');
    assert.ok(Number.isFinite(metrics.beta));
    assert.ok(Number.isFinite(metrics.rsrsFinal));
    assert.ok(Number.isFinite(metrics.dynamicLongThreshold));
    assert.ok(Number.isFinite(metrics.dynamicShortThreshold));
    assert.ok(Number.isFinite(metrics.bollingerUpper));
    assert.ok(Number.isFinite(metrics.volumeMA));
});

test('calculateRsrsMetrics can preserve route fallback behavior for shallow history', () => {
    const klines = createChoppyKlines(40);

    const strictMetrics = calculateRsrsMetrics(klines.map((kline) => ({
        high: parseFloat(kline.high),
        low: parseFloat(kline.low),
        close: parseFloat(kline.close),
        volume: parseFloat(kline.volume),
    })));
    assert.equal(strictMetrics, null);

    const fallbackMetrics = calculateRsrsMetrics(
        klines.map((kline) => ({
            high: parseFloat(kline.high),
            low: parseFloat(kline.low),
            close: parseFloat(kline.close),
            volume: parseFloat(kline.volume),
        })),
        { fallbackOnInsufficientHistory: true },
    );

    assert.ok(fallbackMetrics);
    assert.equal(fallbackMetrics.method, 'VW-TLS (insufficient data)');
    assert.equal(fallbackMetrics.rsrsFinal, 0);
    assert.equal(fallbackMetrics.zScore, 0);
});

test('TechnicalIndicators.calculateRSRS maps the shared RSRS core output', () => {
    const klines = createKlines(150);
    const sharedMetrics = calculateRsrsMetrics(klines.map((kline) => ({
        high: parseFloat(kline.high),
        low: parseFloat(kline.low),
        close: parseFloat(kline.close),
        volume: parseFloat(kline.volume),
    })));
    const indicatorMetrics = TechnicalIndicators.calculateRSRS(klines);

    assert.ok(sharedMetrics);
    assert.ok(indicatorMetrics);
    assert.equal(indicatorMetrics.rsrs, sharedMetrics.beta);
    assert.equal(indicatorMetrics.rsrsZScore, sharedMetrics.zScore);
    assert.equal(indicatorMetrics.rsrsFinal, sharedMetrics.rsrsFinal);
    assert.equal(indicatorMetrics.rsrsR2, sharedMetrics.r2);
    assert.equal(indicatorMetrics.rsrsDynamicLongThreshold, sharedMetrics.dynamicLongThreshold);
    assert.equal(indicatorMetrics.rsrsDynamicShortThreshold, sharedMetrics.dynamicShortThreshold);
    assert.equal(indicatorMetrics.rsrsROC, sharedMetrics.rsrsROC);
    assert.equal(indicatorMetrics.rsrsAcceleration, sharedMetrics.rsrsAcceleration);
    assert.equal(indicatorMetrics.rsrsAdaptiveWindow, sharedMetrics.adaptiveWindow);
    assert.equal(indicatorMetrics.rsrsMethod, sharedMetrics.method);
});
