import test from 'node:test';
import assert from 'node:assert/strict';

import { resolveTokenIdentity, tokenizeSearchInput } from './identity.ts';
import type { TokenSearchResult } from './types.ts';

function createToken(overrides: Partial<TokenSearchResult> = {}): TokenSearchResult {
    return {
        tokenAddress: '0x111',
        chainId: 'ethereum',
        chain: 'ethereum',
        chainName: 'Ethereum',
        chainFamily: 'evm',
        name: 'Pepe',
        symbol: 'PEPE',
        logo: null,
        usdPrice: null,
        marketCap: 10_000_000,
        totalLiquidityUsd: 1_000_000,
        securityScore: null,
        totalHolders: 10_000,
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

test('tokenizeSearchInput normalizes quote suffixes and 1000-prefix futures symbols', () => {
    assert.deepEqual(tokenizeSearchInput('1000PEPEUSDT'), ['1000PEPEUSDT', '1000PEPE', 'PEPE']);
});

test('resolveTokenIdentity treats single Binance Alpha mapping as probable official evidence', () => {
    const resolution = resolveTokenIdentity({
        query: 'PEPE',
        scope: 'alpha',
        candidates: [
            {
                token: createToken(),
                source: 'binance_alpha',
                matchType: 'exact_symbol',
                evidence: ['Binance Alpha cexCoinName 精确匹配 PEPE。'],
                riskFlags: [],
            },
        ],
    });

    assert.equal(resolution.confidence, 'probable');
    assert.equal(resolution.source, 'binance_alpha');
    assert.equal(resolution.address, '0x111');
    assert.match(resolution.evidence.join(' '), /Binance Alpha/);
});

test('resolveTokenIdentity downgrades DEX fuzzy mirror candidates to unverified', () => {
    const resolution = resolveTokenIdentity({
        query: 'PEPE',
        scope: 'contracts',
        futuresSymbols: ['PEPE'],
        candidates: [
            {
                token: createToken({
                    tokenAddress: '0xmirror',
                    isVerifiedContract: false,
                    symbol: 'PEPE2',
                    name: 'Pepe Mirror',
                    marketCap: 50_000_000,
                }),
                source: 'dex_screener',
                matchType: 'symbol_fuzzy',
                evidence: ['DEX Screener symbol/name 模糊匹配。'],
                riskFlags: ['symbol/name 模糊命中。'],
            },
        ],
    });

    assert.equal(resolution.confidence, 'unverified');
    assert.equal(resolution.source, 'dex_screener');
    assert.match(resolution.riskFlags.join(' '), /模糊|不能证明链上地址/);
});

test('resolveTokenIdentity flags multiple close candidates as non-unique', () => {
    const resolution = resolveTokenIdentity({
        query: 'WIF',
        scope: 'contracts',
        candidates: [
            {
                token: createToken({ tokenAddress: '0xaaa', chainId: 'ethereum', chainName: 'Ethereum', symbol: 'WIF' }),
                source: 'dex_screener',
                matchType: 'exact_symbol',
                evidence: ['DEX Screener exact symbol match.'],
                riskFlags: [],
            },
            {
                token: createToken({ tokenAddress: '0xbbb', chainId: 'bsc', chainName: 'BNB Chain', symbol: 'WIF', marketCap: 9_800_000 }),
                source: 'dex_screener',
                matchType: 'exact_symbol',
                evidence: ['DEX Screener exact symbol match.'],
                riskFlags: [],
            },
        ],
    });

    assert.equal(resolution.confidence, 'fallback');
    assert.match(resolution.riskFlags.join(' '), /多个候选|地址不唯一/);
});
