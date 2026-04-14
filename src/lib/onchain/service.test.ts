import test from 'node:test';
import assert from 'node:assert/strict';

import type { TokenSearchResult } from './types';
import { filterAndSortSearchResults, normalizeAcquisitionMix, resolveSelectedToken } from './service';

const sampleTokens: TokenSearchResult[] = [
    {
        tokenAddress: '0x111',
        chainId: '0x1',
        chain: 'eth',
        chainName: 'Ethereum',
        chainFamily: 'evm',
        name: 'Pepe',
        symbol: 'PEPE',
        logo: null,
        usdPrice: 0.00001,
        marketCap: 1000,
        totalLiquidityUsd: 500,
        securityScore: 81,
        totalHolders: 100,
        isVerifiedContract: true,
        turnoverRatio: 0.5,
        dexTrades: {
            h1: { buys: 10, sells: 12, total: 22 },
            h6: { buys: 20, sells: 18, total: 38 },
            h24: { buys: 40, sells: 44, total: 84 },
        },
        dexPriceStats: {
            m5: { priceChangePercent: 1.2, volumeUsd: 1200 },
            h1: { priceChangePercent: 2.1, volumeUsd: 2100 },
            h6: { priceChangePercent: 3.1, volumeUsd: 3100 },
            h24: { priceChangePercent: 4.1, volumeUsd: 4100 },
        },
    },
    {
        tokenAddress: '0x222',
        chainId: '0x2105',
        chain: 'base',
        chainName: 'Base',
        chainFamily: 'evm',
        name: 'Pepe',
        symbol: 'PEPE',
        logo: null,
        usdPrice: 0.00002,
        marketCap: 2000,
        totalLiquidityUsd: 800,
        securityScore: 88,
        totalHolders: 220,
        isVerifiedContract: true,
        turnoverRatio: 0.4,
        dexTrades: {
            h1: { buys: 14, sells: 16, total: 30 },
            h6: { buys: 24, sells: 26, total: 50 },
            h24: { buys: 64, sells: 66, total: 130 },
        },
        dexPriceStats: {
            m5: { priceChangePercent: 1.5, volumeUsd: 1500 },
            h1: { priceChangePercent: 2.5, volumeUsd: 2500 },
            h6: { priceChangePercent: 3.5, volumeUsd: 3500 },
            h24: { priceChangePercent: 4.5, volumeUsd: 4500 },
        },
    },
];

test('resolveSelectedToken prefers exact address and chain match', () => {
    const selected = resolveSelectedToken(sampleTokens, '0x222', '0x2105');

    assert.equal(selected?.tokenAddress, '0x222');
    assert.equal(selected?.chainId, '0x2105');
});

test('resolveSelectedToken falls back to first candidate when selection is missing', () => {
    const selected = resolveSelectedToken(sampleTokens, null, null);

    assert.equal(selected?.tokenAddress, '0x111');
});

test('resolveSelectedToken ignores partial mismatches', () => {
    const selected = resolveSelectedToken(sampleTokens, '0x222', '0x1');

    assert.equal(selected?.tokenAddress, '0x111');
});

test('normalizeAcquisitionMix converts raw counts into percentages', () => {
    const normalized = normalizeAcquisitionMix({
        swap: 633,
        transfer: 54,
        airdrop: 4,
    });

    assert.equal(normalized.swap.toFixed(1), '91.6');
    assert.equal(normalized.transfer.toFixed(1), '7.8');
    assert.equal(normalized.airdrop.toFixed(1), '0.6');
});

test('filterAndSortSearchResults removes tiny holder sets and sorts by holders desc', () => {
    const ranked = filterAndSortSearchResults([
        sampleTokens[0],
        sampleTokens[1],
        {
            ...sampleTokens[0],
            tokenAddress: '0x333',
            chainId: 'bsc',
            totalHolders: 90,
            marketCap: 5000,
            totalLiquidityUsd: 2000,
        },
        {
            ...sampleTokens[0],
            tokenAddress: '0x444',
            chainId: 'arbitrum',
            totalHolders: 1200,
            marketCap: 1500,
            totalLiquidityUsd: 600,
        },
    ]);

    assert.deepEqual(
        ranked.map((token) => token.tokenAddress),
        ['0x444', '0x222', '0x111']
    );
});

test('filterAndSortSearchResults keeps unknown holder counts behind known ones', () => {
    const ranked = filterAndSortSearchResults([
        {
            ...sampleTokens[0],
            tokenAddress: '0x555',
            chainId: 'solana',
            totalHolders: null,
            marketCap: 9000,
            totalLiquidityUsd: 5000,
        },
        {
            ...sampleTokens[1],
            totalHolders: 180,
        },
    ]);

    assert.deepEqual(
        ranked.map((token) => token.tokenAddress),
        ['0x222', '0x555']
    );
});
