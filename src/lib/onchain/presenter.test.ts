import test from 'node:test';
import assert from 'node:assert/strict';

import { buildExecutiveSummary, buildOnchainStorageKey } from './presenter.ts';
import type { ChipAnalysis, HistoricalHoldersPoint, TokenHolderMetrics, TokenSearchResult } from './types.ts';

function buildVisibleHistory(points: HistoricalHoldersPoint[], limit = 7) {
    const sorted = [...points].sort((a, b) => (
        new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
    ));

    return sorted.slice(-limit);
}

const sampleToken: TokenSearchResult = {
    tokenAddress: '0xABC',
    chainId: 'ethereum',
    chain: 'ethereum',
    chainName: 'Ethereum',
    chainFamily: 'evm',
    name: 'Pepe',
    symbol: 'PEPE',
    logo: null,
    usdPrice: 0.000003,
    marketCap: 1_400_000_000,
    totalLiquidityUsd: 25_000_000,
    securityScore: null,
    totalHolders: null,
    isVerifiedContract: false,
    turnoverRatio: 0.22,
    dexTrades: {
        h1: { buys: 100, sells: 120, total: 220 },
        h6: { buys: 240, sells: 280, total: 520 },
        h24: { buys: 900, sells: 980, total: 1880 },
    },
    dexPriceStats: {
        m5: { priceChangePercent: 1.2, volumeUsd: 120000 },
        h1: { priceChangePercent: -1.5, volumeUsd: 510000 },
        h6: { priceChangePercent: 8.2, volumeUsd: 2100000 },
        h24: { priceChangePercent: 25.4, volumeUsd: 12400000 },
    },
};

const sampleMetrics: TokenHolderMetrics = {
    totalHolders: 512714,
    holderSupply: {
        top10: { supply: 1, supplyPercent: 0.4 },
        top25: { supply: 1, supplyPercent: 0.55 },
        top50: { supply: 1, supplyPercent: 0.67 },
        top100: { supply: 1, supplyPercent: 0.77 },
        top250: { supply: 1, supplyPercent: 0.86 },
        top500: { supply: 1, supplyPercent: 0.89 },
    },
    holderChange: {
        '5min': { change: -6, changePercent: -0.0012 },
        '1h': { change: -78, changePercent: -0.015 },
        '6h': { change: -65, changePercent: -0.013 },
        '24h': { change: 115, changePercent: 0.022 },
        '3d': { change: 614, changePercent: 0.12 },
        '7d': { change: 1493, changePercent: 0.29 },
        '30d': { change: 5634, changePercent: 1.1 },
    },
    holdersByAcquisition: {
        swap: 24.7,
        transfer: 71.2,
        airdrop: 4.1,
    },
    holderDistribution: {
        whales: 116,
        sharks: 57,
        dolphins: 507,
        fish: 1705,
        octopus: 5309,
        crabs: 18823,
        shrimps: 486197,
    },
};

const sampleAnalysis: ChipAnalysis = {
    chipScore: 70,
    controlLevel: '高度控筹',
    distributionLevel: '长尾分散',
    trendLevel: '趋于稳定',
    breakdown: [],
    summaryCards: [],
    insights: [],
};

test('buildOnchainStorageKey creates stable default cache key', () => {
    assert.equal(
        buildOnchainStorageKey('PEPE'),
        'persistent-swr:v3:onchain:PEPE:default'
    );
});

test('buildExecutiveSummary returns direct research sentence', () => {
    const summary = buildExecutiveSummary(sampleToken, sampleMetrics, sampleAnalysis);

    assert.match(summary, /PEPE 当前属于高度控筹/);
    assert.match(summary, /Top10 占比 40.00%/);
});

test('buildVisibleHistory returns latest items in ascending order', () => {
    const points: HistoricalHoldersPoint[] = [
        { timestamp: '2026-04-13T00:00:00.000Z', totalHolders: 3, netHolderChange: 0, holderPercentChange: 0, newHoldersByAcquisition: { swap: 0, transfer: 0, airdrop: 0 }, holdersIn: { whales: 0, sharks: 0, dolphins: 0, fish: 0, octopus: 0, crabs: 0, shrimps: 0 }, holdersOut: { whales: 0, sharks: 0, dolphins: 0, fish: 0, octopus: 0, crabs: 0, shrimps: 0 } },
        { timestamp: '2026-04-11T00:00:00.000Z', totalHolders: 1, netHolderChange: 0, holderPercentChange: 0, newHoldersByAcquisition: { swap: 0, transfer: 0, airdrop: 0 }, holdersIn: { whales: 0, sharks: 0, dolphins: 0, fish: 0, octopus: 0, crabs: 0, shrimps: 0 }, holdersOut: { whales: 0, sharks: 0, dolphins: 0, fish: 0, octopus: 0, crabs: 0, shrimps: 0 } },
        { timestamp: '2026-04-12T00:00:00.000Z', totalHolders: 2, netHolderChange: 0, holderPercentChange: 0, newHoldersByAcquisition: { swap: 0, transfer: 0, airdrop: 0 }, holdersIn: { whales: 0, sharks: 0, dolphins: 0, fish: 0, octopus: 0, crabs: 0, shrimps: 0 }, holdersOut: { whales: 0, sharks: 0, dolphins: 0, fish: 0, octopus: 0, crabs: 0, shrimps: 0 } },
    ];

    const visible = buildVisibleHistory(points, 2);

    assert.deepEqual(visible.map((point) => point.totalHolders), [2, 3]);
});
