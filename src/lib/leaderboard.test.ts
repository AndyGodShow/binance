import test from 'node:test';
import assert from 'node:assert/strict';

import { buildDashboardLeaderboards } from './leaderboard.ts';
import type { OpenInterestFrameSnapshot, TickerData } from './types.ts';

function createTicker(symbol: string, overrides: Partial<TickerData> = {}): TickerData {
    return {
        symbol,
        lastPrice: '100',
        priceChange: '0',
        priceChangePercent: '0',
        weightedAvgPrice: '0',
        prevClosePrice: '0',
        highPrice: '0',
        lowPrice: '0',
        volume: '0',
        quoteVolume: '1000',
        openTime: 0,
        closeTime: 0,
        change15m: 0,
        change1h: 0,
        change4h: 0,
        fundingRate: '0',
        openInterestValue: '0',
        ...overrides,
    };
}

test('buildDashboardLeaderboards ranks price, oi ratio, and funding slices', () => {
    const tickers = [
        createTicker('BTCUSDT', {
            change15m: 6,
            change1h: 8,
            change4h: 12,
            priceChangePercent: '18',
            fundingRate: '0.0012',
            openInterestValue: '3000',
            quoteVolume: '1000',
        }),
        createTicker('ETHUSDT', {
            change15m: 9,
            change1h: 4,
            change4h: 6,
            priceChangePercent: '11',
            fundingRate: '-0.0008',
            openInterestValue: '2200',
            quoteVolume: '2000',
        }),
        createTicker('SOLUSDT', {
            change15m: 3,
            change1h: 11,
            change4h: 9,
            priceChangePercent: '7',
            fundingRate: '0.0007',
            openInterestValue: '5000',
            quoteVolume: '1250',
        }),
        createTicker('DOGEUSDT', {
            change15m: -1,
            change1h: 1,
            change4h: 2,
            priceChangePercent: '-4',
            fundingRate: '-0.0011',
            openInterestValue: '900',
            quoteVolume: '3000',
        }),
    ];

    const oiSnapshots: Record<string, OpenInterestFrameSnapshot> = {
        BTCUSDT: {
            symbol: 'BTCUSDT',
            asOf: 1,
            currentValue: 3000,
            change15m: { percent: 12, value: 320 },
            change1h: { percent: 20, value: 500 },
            change4h: { percent: 28, value: 656.25 },
            change24h: { percent: 35, value: 777.78 },
        },
        ETHUSDT: {
            symbol: 'ETHUSDT',
            asOf: 1,
            currentValue: 2200,
            change15m: { percent: 18, value: 335.59 },
            change1h: { percent: 10, value: 200 },
            change4h: { percent: 8, value: 162.96 },
            change24h: { percent: 5, value: 104.76 },
        },
        SOLUSDT: {
            symbol: 'SOLUSDT',
            asOf: 1,
            currentValue: 5000,
            change15m: { percent: 5, value: 238.1 },
            change1h: { percent: 24, value: 967.74 },
            change4h: { percent: 16, value: 689.66 },
            change24h: { percent: 42, value: 1478.87 },
        },
        DOGEUSDT: {
            symbol: 'DOGEUSDT',
            asOf: 1,
            currentValue: 900,
            change15m: { percent: -6, value: -57.45 },
            change1h: { percent: -4, value: -37.5 },
            change4h: { percent: -2, value: -18.37 },
            change24h: { percent: 1, value: 8.91 },
        },
    };

    const leaderboard = buildDashboardLeaderboards(tickers, oiSnapshots);

    assert.deepEqual(
        leaderboard.price['15m'].map((item) => item.symbol),
        ['ETHUSDT', 'BTCUSDT', 'SOLUSDT', 'DOGEUSDT']
    );
    assert.deepEqual(
        leaderboard.price['1h'].map((item) => item.symbol),
        ['SOLUSDT', 'BTCUSDT', 'ETHUSDT', 'DOGEUSDT']
    );
    assert.deepEqual(
        leaderboard.oi['15m'].map((item) => item.symbol),
        ['ETHUSDT', 'BTCUSDT', 'SOLUSDT', 'DOGEUSDT']
    );
    assert.equal(leaderboard.oi['15m'][0].secondaryValue, 335.59);
    assert.deepEqual(
        leaderboard.oiToVolume.map((item) => item.symbol),
        ['SOLUSDT', 'BTCUSDT', 'ETHUSDT', 'DOGEUSDT']
    );
    assert.equal(leaderboard.oiToVolume[0].value, 4);
    assert.deepEqual(
        leaderboard.funding.positive.map((item) => item.symbol),
        ['BTCUSDT', 'SOLUSDT']
    );
    assert.deepEqual(
        leaderboard.funding.negative.map((item) => item.symbol),
        ['DOGEUSDT', 'ETHUSDT']
    );
});
