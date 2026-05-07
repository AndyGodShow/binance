import test from 'node:test';
import assert from 'node:assert/strict';

import { buildOnchainDataQuality, buildStructureObservation } from './analysis.ts';
import type { HistoricalHoldersPoint, TokenHolderMetrics, TopHolderItem } from './types.ts';

function createMetrics(overrides: Partial<TokenHolderMetrics> = {}): TokenHolderMetrics {
    return {
        totalHolders: 12500,
        holderSupply: {
            top10: { supply: 670000000, supplyPercent: 0.67 },
            top25: { supply: 760000000, supplyPercent: 0.76 },
            top50: { supply: 830000000, supplyPercent: 0.83 },
            top100: { supply: 890000000, supplyPercent: 0.89 },
            top250: { supply: 940000000, supplyPercent: 0.94 },
            top500: { supply: 970000000, supplyPercent: 0.97 },
        },
        holderChange: {
            '5min': { change: 2, changePercent: 0.02 },
            '1h': { change: 28, changePercent: 0.31 },
            '6h': { change: 180, changePercent: 1.7 },
            '24h': { change: 420, changePercent: 3.8 },
            '3d': { change: 720, changePercent: 6.5 },
            '7d': { change: 910, changePercent: 8.4 },
            '30d': { change: 2120, changePercent: 19.5 },
        },
        holdersByAcquisition: {
            swap: 54,
            transfer: 34,
            airdrop: 12,
        },
        holderDistribution: {
            whales: 12,
            sharks: 32,
            dolphins: 120,
            fish: 640,
            octopus: 1200,
            crabs: 2400,
            shrimps: 8096,
        },
        ...overrides,
    };
}

function createHistorical(overrides: Partial<HistoricalHoldersPoint> = {}): HistoricalHoldersPoint[] {
    return [
        {
            timestamp: '2026-04-06T00:00:00.000Z',
            totalHolders: 11200,
            netHolderChange: 120,
            holderPercentChange: 1.1,
            newHoldersByAcquisition: { swap: 40, transfer: 45, airdrop: 15 },
            holdersIn: { whales: 0, sharks: 2, dolphins: 3, fish: 20, octopus: 40, crabs: 70, shrimps: 220 },
            holdersOut: { whales: 0, sharks: 1, dolphins: 1, fish: 8, octopus: 15, crabs: 32, shrimps: 118 },
        },
        {
            timestamp: '2026-04-13T00:00:00.000Z',
            totalHolders: 12500,
            netHolderChange: 210,
            holderPercentChange: 1.7,
            newHoldersByAcquisition: { swap: 52, transfer: 33, airdrop: 15 },
            holdersIn: { whales: 1, sharks: 3, dolphins: 4, fish: 32, octopus: 55, crabs: 91, shrimps: 298 },
            holdersOut: { whales: 0, sharks: 1, dolphins: 2, fish: 10, octopus: 18, crabs: 37, shrimps: 216 },
            ...overrides,
        },
    ];
}

function createTopHolders(overrides: Partial<TopHolderItem>[] = []): TopHolderItem[] {
    const defaults: TopHolderItem[] = [
        { address: '0x1', label: null, entity: null, percentage: 8, balance: null, usdValue: null, isContract: false },
        { address: '0x2', label: null, entity: null, percentage: 6, balance: null, usdValue: null, isContract: false },
        { address: '0x3', label: null, entity: null, percentage: 4, balance: null, usdValue: null, isContract: false },
        { address: '0x4', label: null, entity: null, percentage: 3, balance: null, usdValue: null, isContract: false },
        { address: '0x5', label: null, entity: null, percentage: 2, balance: null, usdValue: null, isContract: false },
    ];

    return defaults.map((holder, index) => ({
        ...holder,
        ...(overrides[index] ?? {}),
    }));
}

test('buildStructureObservation describes raw concentration without removed score fields', () => {
    const analysis = buildStructureObservation(createMetrics(), createHistorical());

    assert.equal(analysis.concentrationLevel, '原始地址高度集中');
    assert.equal(analysis.distributionLevel, '长尾分散');
    assert.equal(analysis.trendLevel, '地址数量扩张');
    assert.equal('chipScore' in analysis, false);
    assert.equal('controlLevel' in analysis, false);
});

test('buildStructureObservation can describe more distributed raw structure', () => {
    const analysis = buildStructureObservation(
        createMetrics({
            holderSupply: {
                top10: { supply: 120000000, supplyPercent: 0.12 },
                top25: { supply: 190000000, supplyPercent: 0.19 },
                top50: { supply: 260000000, supplyPercent: 0.26 },
                top100: { supply: 330000000, supplyPercent: 0.33 },
                top250: { supply: 490000000, supplyPercent: 0.49 },
                top500: { supply: 620000000, supplyPercent: 0.62 },
            },
            holderDistribution: {
                whales: 1,
                sharks: 4,
                dolphins: 40,
                fish: 220,
                octopus: 840,
                crabs: 2800,
                shrimps: 16000,
            },
            holderChange: {
                '5min': { change: 0, changePercent: 0 },
                '1h': { change: 3, changePercent: 0.01 },
                '6h': { change: 12, changePercent: 0.1 },
                '24h': { change: 38, changePercent: 0.3 },
                '3d': { change: 90, changePercent: 0.7 },
                '7d': { change: 130, changePercent: 0.9 },
                '30d': { change: 280, changePercent: 1.9 },
            },
            holdersByAcquisition: {
                swap: 18,
                transfer: 61,
                airdrop: 21,
            },
        }),
        createHistorical({ netHolderChange: -12, holderPercentChange: -0.1 })
    );

    assert.equal(analysis.concentrationLevel, '原始地址相对分散');
    assert.equal(analysis.distributionLevel, '长尾分散');
    assert.equal(analysis.trendLevel, '地址数量稳定');
});

test('buildOnchainDataQuality downgrades confidence when top holders include contracts and burn addresses', () => {
    const quality = buildOnchainDataQuality(
        createMetrics(),
        createHistorical(),
        createTopHolders([
            { label: 'Uniswap V2 Pair', percentage: 12, isContract: true },
            { label: 'Burn Address', percentage: 8 },
        ])
    );

    assert.equal(quality.confidence, '中');
    assert.equal(quality.flaggedTopHolderSharePercent, 20);
    assert.match(quality.warnings.join(' '), /非普通持仓地址/);
});

test('buildOnchainDataQuality marks missing top holders as low confidence', () => {
    const quality = buildOnchainDataQuality(createMetrics(), createHistorical(), []);

    assert.equal(quality.confidence, '低');
    assert.match(quality.warnings.join(' '), /Top holders 明细/);
});

test('buildOnchainDataQuality marks impossible top holder percentages as low confidence', () => {
    const quality = buildOnchainDataQuality(
        createMetrics(),
        createHistorical(),
        createTopHolders([
            { percentage: 68.06 },
            { percentage: 32.4 },
            { percentage: 18.8 },
            { percentage: 12.5 },
            { percentage: 8.6 },
        ])
    );

    assert.equal(quality.confidence, '低');
    assert.equal(quality.topHolderCoveragePercent?.toFixed(2), '140.36');
    assert.match(quality.warnings.join(' '), /超过 100%/);
});

test('buildOnchainDataQuality warns when holder supply buckets are not monotonic', () => {
    const quality = buildOnchainDataQuality(
        createMetrics({
            holderSupply: {
                top10: { supply: 1, supplyPercent: 0.7 },
                top25: { supply: 1, supplyPercent: 0.8 },
                top50: { supply: 1, supplyPercent: 0.6 },
                top100: { supply: 1, supplyPercent: 0.9 },
                top250: { supply: 1, supplyPercent: 0.94 },
                top500: { supply: 1, supplyPercent: 0.97 },
            },
        }),
        createHistorical(),
        createTopHolders()
    );

    assert.equal(quality.confidence, '低');
    assert.match(quality.warnings.join(' '), /holderSupply 聚合桶/);
});
