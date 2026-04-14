import test from 'node:test';
import assert from 'node:assert/strict';

import { buildFundingRateAlert } from './scheduledAlerts';
import type { TickerData } from './types';

function createTicker(symbol: string, fundingRate: string): TickerData {
    return {
        symbol,
        fundingRate,
        lastPrice: '0',
        priceChange: '0',
        priceChangePercent: '0',
        weightedAvgPrice: '0',
        prevClosePrice: '0',
        highPrice: '0',
        lowPrice: '0',
        volume: '0',
        quoteVolume: '0',
        openTime: 0,
        closeTime: 0,
    };
}

test('buildFundingRateAlert returns top 3 positive and negative funding rates', () => {
    const alert = buildFundingRateAlert([
        createTicker('BTCUSDT', '0.0012'),
        createTicker('ETHUSDT', '0.0009'),
        createTicker('SOLUSDT', '0.0007'),
        createTicker('DOGEUSDT', '-0.0011'),
        createTicker('XRPUSDT', '-0.0008'),
        createTicker('ADAUSDT', '-0.0006'),
        createTicker('BNBUSDT', '0'),
    ], 1712800000000);

    assert.ok(alert);
    assert.equal(alert.type, 'funding-rate');
    assert.deepEqual(alert.topPositive.map((item) => item.symbol), ['BTCUSDT', 'ETHUSDT', 'SOLUSDT']);
    assert.deepEqual(alert.topNegative.map((item) => item.symbol), ['DOGEUSDT', 'XRPUSDT', 'ADAUSDT']);
});
