import assert from 'node:assert/strict';
import test from 'node:test';

import {
    attachOpenInterestSnapshotsToTickers,
    buildRsrsTickerFields,
    calculateRecentPriceChangePercent,
    normalizeReleaseBarsAgo,
} from './marketDataTransforms.ts';
import type { OHLC, TickerData } from './types.ts';

function createTicker(): TickerData {
    return {
        symbol: 'CGPTUSDT',
        lastPrice: '0.04',
        priceChange: '0.004',
        priceChangePercent: '12',
        weightedAvgPrice: '0.038',
        prevClosePrice: '0.036',
        highPrice: '0.042',
        lowPrice: '0.035',
        volume: '1000000000',
        quoteVolume: '45000000',
        openTime: 0,
        closeTime: 0,
        fundingRate: '-0.00038',
    };
}

test('calculateRecentPriceChangePercent derives lookback changes from recent klines', () => {
    const klines: OHLC[] = [100, 101, 102, 103, 104].map((close, index) => ({
        time: index,
        open: close - 0.5,
        high: close + 1,
        low: close - 1,
        close,
        volume: 1000,
    }));

    assert.equal(
        Number(calculateRecentPriceChangePercent(klines, 1)?.toFixed(4)),
        Number((((104 - 103) / 103) * 100).toFixed(4)),
    );
    assert.equal(
        Number(calculateRecentPriceChangePercent(klines, 4)?.toFixed(4)),
        Number((((104 - 100) / 100) * 100).toFixed(4)),
    );
});

test('normalizeReleaseBarsAgo preserves release windows and marks no-release state explicitly', () => {
    assert.equal(normalizeReleaseBarsAgo(0), 0);
    assert.equal(normalizeReleaseBarsAgo(3), 3);
    assert.equal(normalizeReleaseBarsAgo(undefined), -1);
});

test('attachOpenInterestSnapshotsToTickers includes OI USD before sentiment classification', () => {
    const sourceTickers = attachOpenInterestSnapshotsToTickers(
        [createTicker()],
        new Map([
            ['CGPTUSDT', {
                symbol: 'CGPTUSDT',
                currentOpenInterest: '100000000',
                currentOpenInterestValue: '4000000',
                changePercent4h: 9,
                changeValue4h: 330000,
            }],
        ]),
    );

    assert.equal(sourceTickers[0].openInterest, '100000000');
    assert.equal(sourceTickers[0].openInterestValue, '4000000');
});

test('buildRsrsTickerFields exposes live RSRS and Bollinger fields for scanner input', () => {
    const klines: OHLC[] = Array.from({ length: 120 }, (_, index) => {
        const base = 100 + index * 0.3;
        const wave = Math.sin(index / 5) * 2;
        const close = base + wave;
        return {
            time: index,
            open: close - 0.2,
            high: close + 1 + (index % 5) * 0.1,
            low: close - 1 - (index % 3) * 0.1,
            close,
            volume: 1000 + index * 10,
        };
    });

    const fields = buildRsrsTickerFields(klines);

    assert.equal(typeof fields.rsrs, 'number');
    assert.equal(typeof fields.rsrsFinal, 'number');
    assert.equal(typeof fields.rsrsZScore, 'number');
    assert.equal(typeof fields.rsrsR2, 'number');
    assert.equal(typeof fields.rsrsDynamicLongThreshold, 'number');
    assert.equal(typeof fields.rsrsDynamicShortThreshold, 'number');
    assert.equal(typeof fields.bollingerUpper, 'number');
    assert.equal(typeof fields.bollingerMid, 'number');
    assert.equal(typeof fields.bollingerLower, 'number');
});
