import test from 'node:test';
import assert from 'node:assert/strict';

import {
    buildSupplyBreakdown,
    applySupplyToHolderConcentration,
} from './supplyNormalizer.ts';
import type { ClassifiedHolder, HolderConcentrationAnalysis, TokenSearchResult } from './types.ts';

function token(overrides: Partial<TokenSearchResult> = {}): TokenSearchResult {
    return {
        tokenAddress: '0x111',
        chainId: 'ethereum',
        chain: 'ethereum',
        chainName: 'Ethereum',
        chainFamily: 'evm',
        name: 'Pepe',
        symbol: 'PEPE',
        logo: null,
        usdPrice: 0.01,
        marketCap: 700_000,
        fdv: 1_000_000,
        totalLiquidityUsd: 100_000,
        securityScore: null,
        totalHolders: 1000,
        isVerifiedContract: true,
        turnoverRatio: null,
        dexTrades: {
            h1: { buys: null, sells: null, total: null },
            h6: { buys: null, sells: null, total: null },
            h24: { buys: null, sells: null, total: null },
        },
        dexPriceStats: {
            m5: { priceChangePercent: null, volumeUsd: null },
            h1: { priceChangePercent: null, volumeUsd: null },
            h6: { priceChangePercent: null, volumeUsd: null },
            h24: { priceChangePercent: null, volumeUsd: null },
        },
        ...overrides,
    };
}

function classified(overrides: Partial<ClassifiedHolder>): ClassifiedHolder {
    return {
        address: '0xholder',
        percentage: 10,
        balance: '100000',
        label: null,
        entity: null,
        isContract: false,
        class: 'user_wallet',
        confidence: 'medium',
        reasons: [],
        ...overrides,
    };
}

function concentration(overrides: Partial<HolderConcentrationAnalysis> = {}): HolderConcentrationAnalysis {
    const classifiedHolders = [
        classified({ address: '0xburn', class: 'burn', percentage: 10, balance: '100000' }),
        classified({ address: '0xlp', class: 'lp_pool', percentage: 20, balance: '200000' }),
        classified({ address: '0xcex', class: 'cex', percentage: 5, balance: '50000' }),
        classified({ address: '0xunknown', class: 'unknown', percentage: 15, balance: '150000' }),
        classified({ address: '0xuser', class: 'user_wallet', percentage: 8, balance: '80000' }),
    ];

    return {
        rawTop1: 20,
        rawTop5: 58,
        rawTop10: 58,
        floatTop1: 15,
        floatTop5: 23,
        floatTop10: 23,
        excludedSharePercent: 35,
        unknownSharePercent: 15,
        classifiedHolders,
        excludedTopHolders: classifiedHolders.filter((holder) => holder.class !== 'user_wallet' && holder.class !== 'unknown'),
        unknownTopHolders: classifiedHolders.filter((holder) => holder.class === 'unknown'),
        warnings: [],
        ...overrides,
    };
}

test('buildSupplyBreakdown warns when FDV is present but marketCap is missing', () => {
    const breakdown = buildSupplyBreakdown({
        token: token({ marketCap: null, fdv: 1_000_000 }),
        holderConcentration: concentration(),
    });

    assert.match(breakdown.warnings.join(' '), /FDV|marketCap/);
    assert.equal(breakdown.confidence, 'low');
});

test('buildSupplyBreakdown deducts burn LP CEX and treasury from estimated float supply', () => {
    const breakdown = buildSupplyBreakdown({
        token: token(),
        holderConcentration: concentration({
            classifiedHolders: [
                classified({ class: 'burn', percentage: 10, balance: '100000' }),
                classified({ class: 'lp_pool', percentage: 20, balance: '200000' }),
                classified({ class: 'cex', percentage: 5, balance: '50000' }),
                classified({ class: 'treasury', percentage: 15, balance: '150000' }),
                classified({ class: 'user_wallet', percentage: 5, balance: '50000' }),
            ],
        }),
    });

    assert.equal(breakdown.totalSupply, 1_000_000);
    assert.equal(breakdown.burnedSupply, 100_000);
    assert.equal(breakdown.lockedOrInfrastructureSupply, 350_000);
    assert.equal(breakdown.cexSupply, 50_000);
    assert.equal(breakdown.estimatedFloatSupply, 500_000);
});

test('buildSupplyBreakdown detects marketCap and FDV divergence', () => {
    const breakdown = buildSupplyBreakdown({
        token: token({ marketCap: 100_000, fdv: 1_000_000 }),
        holderConcentration: concentration(),
    });

    assert.match(breakdown.warnings.join(' '), /marketCap.*FDV|FDV.*marketCap/);
});

test('buildSupplyBreakdown detects impossible top holder percentages', () => {
    const breakdown = buildSupplyBreakdown({
        token: token(),
        holderConcentration: concentration({
            classifiedHolders: [
                classified({ class: 'user_wallet', percentage: 60, balance: '600000' }),
                classified({ class: 'unknown', percentage: 45, balance: '450000' }),
            ],
        }),
    });

    assert.match(breakdown.warnings.join(' '), /percentage 数学异常/);
});

test('buildSupplyBreakdown warns on unknown top holder supply and invalid estimated float', () => {
    const breakdown = buildSupplyBreakdown({
        token: token(),
        holderConcentration: concentration({
            classifiedHolders: [
                classified({ class: 'burn', percentage: 60, balance: '600000' }),
                classified({ class: 'lp_pool', percentage: 30, balance: '300000' }),
                classified({ class: 'cex', percentage: 10, balance: '100000' }),
                classified({ class: 'unknown', percentage: 40, balance: '400000' }),
            ],
        }),
    });

    assert.match(breakdown.warnings.join(' '), /unknown|estimatedFloatSupply|估算可流通/);
    assert.equal(breakdown.confidence, 'low');
});

test('applySupplyToHolderConcentration removes float TopN when supply confidence is low', () => {
    const normalized = applySupplyToHolderConcentration(concentration(), {
        totalSupply: null,
        circulatingSupply: null,
        burnedSupply: null,
        lockedOrInfrastructureSupply: null,
        cexSupply: null,
        unknownTopHolderSupply: null,
        estimatedFloatSupply: null,
        confidence: 'low',
        warnings: ['supply 缺失'],
        evidence: [],
    });

    assert.equal(normalized.floatTop1, null);
    assert.equal(normalized.floatTop5, null);
    assert.equal(normalized.floatTop10, null);
});
