import type {
    TokenHolderMetrics,
    TokenIdentityCandidate,
    TokenSearchResult,
    TopHolderItem,
} from './types.ts';

const emptyDexStats = {
    h1: { buys: null, sells: null, total: null },
    h6: { buys: null, sells: null, total: null },
    h24: { buys: null, sells: null, total: null },
};

const emptyPriceStats = {
    m5: { priceChangePercent: null, volumeUsd: null },
    h1: { priceChangePercent: null, volumeUsd: null },
    h6: { priceChangePercent: null, volumeUsd: null },
    h24: { priceChangePercent: null, volumeUsd: null },
};

export function tokenFixture(overrides: Partial<TokenSearchResult> = {}): TokenSearchResult {
    return {
        tokenAddress: '0x1111111111111111111111111111111111111111',
        chainId: 'ethereum',
        chain: 'ethereum',
        chainName: 'Ethereum',
        chainFamily: 'evm',
        name: 'Pepe',
        symbol: 'PEPE',
        logo: null,
        usdPrice: 0.00001,
        marketCap: 10_000_000,
        fdv: 12_000_000,
        totalLiquidityUsd: 1_000_000,
        securityScore: null,
        totalHolders: 20_000,
        isVerifiedContract: true,
        turnoverRatio: null,
        dexTrades: emptyDexStats,
        dexPriceStats: emptyPriceStats,
        ...overrides,
    };
}

export const alphaOfficialToken = tokenFixture({
    tokenAddress: '0xalpha000000000000000000000000000000000000',
    name: 'Alpha Pepe',
    symbol: 'PEPE',
    isVerifiedContract: true,
});

export const dexFallbackToken = tokenFixture({
    tokenAddress: '0xdex0000000000000000000000000000000000000',
    name: 'Pepe',
    symbol: 'PEPE',
    isVerifiedContract: false,
});

export const fuzzyFakeToken = tokenFixture({
    tokenAddress: '0xfake000000000000000000000000000000000000',
    name: 'Pepe Community Mirror',
    symbol: 'PEPE2',
    marketCap: 30_000_000,
    isVerifiedContract: false,
});

export const wrappedToken = tokenFixture({
    tokenAddress: '0xwrapped0000000000000000000000000000000000',
    name: 'Wrapped Ether',
    symbol: 'WETH',
});

export const stablecoinToken = tokenFixture({
    tokenAddress: '0xstable00000000000000000000000000000000000',
    name: 'Tether USD',
    symbol: 'USDT',
    marketCap: 100_000_000_000,
    fdv: 100_000_000_000,
});

export const nativeAsset = tokenFixture({
    tokenAddress: '0xnative00000000000000000000000000000000000',
    name: 'Ether',
    symbol: 'ETH',
});

export const solanaUnlabeledToken = tokenFixture({
    tokenAddress: 'So11111111111111111111111111111111111111112',
    chainId: 'solana',
    chain: 'solana',
    chainName: 'Solana',
    chainFamily: 'solana',
    name: 'Solana Meme',
    symbol: 'SMEME',
});

export const pollutedTopHoldersToken = tokenFixture({
    tokenAddress: '0xpolluted000000000000000000000000000000000',
    name: 'Polluted Holder Token',
    symbol: 'POLLUTE',
});

export const invalidSupplyToken = tokenFixture({
    tokenAddress: '0xinvalid0000000000000000000000000000000000',
    name: 'Invalid Supply Token',
    symbol: 'INVALID',
});

export function metricsFixture(overrides: Partial<TokenHolderMetrics> = {}): TokenHolderMetrics {
    return {
        totalHolders: 2000,
        holderSupply: {
            top10: { supply: 300_000, supplyPercent: 0.3 },
            top25: { supply: 400_000, supplyPercent: 0.4 },
            top50: { supply: 500_000, supplyPercent: 0.5 },
            top100: { supply: 600_000, supplyPercent: 0.6 },
            top250: { supply: 700_000, supplyPercent: 0.7 },
            top500: { supply: 800_000, supplyPercent: 0.8 },
        },
        holderChange: {
            '5min': { change: 0, changePercent: 0 },
            '1h': { change: 0, changePercent: 0 },
            '6h': { change: 0, changePercent: 0 },
            '24h': { change: 0, changePercent: 0 },
            '3d': { change: 0, changePercent: 0 },
            '7d': { change: 0, changePercent: 0 },
            '30d': { change: 0, changePercent: 0 },
        },
        holdersByAcquisition: { swap: 0, transfer: 0, airdrop: 0 },
        holderDistribution: { whales: 1, sharks: 2, dolphins: 3, fish: 4, octopus: 5, crabs: 6, shrimps: 7 },
        ...overrides,
    };
}

export function holderFixture(overrides: Partial<TopHolderItem> = {}): TopHolderItem {
    return {
        address: '0xholder000000000000000000000000000000000000',
        label: 'Wallet',
        entity: null,
        percentage: 5,
        balance: '50000',
        usdValue: null,
        isContract: false,
        ...overrides,
    };
}

export const cleanTopHolders = [
    holderFixture({ address: '0xuser1', percentage: 8, balance: '80000' }),
    holderFixture({ address: '0xuser2', percentage: 7, balance: '70000' }),
    holderFixture({ address: '0xuser3', percentage: 6, balance: '60000' }),
    holderFixture({ address: '0xuser4', percentage: 5, balance: '50000' }),
    holderFixture({ address: '0xuser5', percentage: 4, balance: '40000' }),
    holderFixture({ address: '0xuser6', percentage: 3, balance: '30000' }),
    holderFixture({ address: '0xuser7', percentage: 2, balance: '20000' }),
    holderFixture({ address: '0xuser8', percentage: 1.5, balance: '15000' }),
    holderFixture({ address: '0xuser9', percentage: 1, balance: '10000' }),
    holderFixture({ address: '0xuser10', percentage: 0.5, balance: '5000' }),
];

export const pollutedTopHolders = [
    holderFixture({ address: '0xpool', label: 'Uniswap V2 Pair', percentage: 45, balance: '450000', isContract: true }),
    holderFixture({ address: '0xbinance', label: 'Binance Hot Wallet', percentage: 20, balance: '200000' }),
    holderFixture({ address: '0x000000000000000000000000000000000000dEaD', label: 'Burn Address', percentage: 15, balance: '150000' }),
    holderFixture({ address: '0xuser1', percentage: 3, balance: '30000' }),
    holderFixture({ address: '0xuser2', percentage: 2, balance: '20000' }),
];

export const unknownHeavyTopHolders = [
    holderFixture({ address: '0xunknown1', label: null, percentage: 18, balance: '180000' }),
    holderFixture({ address: '0xunknown2', label: null, percentage: 16, balance: '160000' }),
    holderFixture({ address: '0xunknown3', label: null, percentage: 14, balance: '140000' }),
    holderFixture({ address: '0xwallet1', percentage: 4, balance: '40000' }),
    holderFixture({ address: '0xwallet2', percentage: 3, balance: '30000' }),
];

export const invalidPercentageTopHolders = [
    holderFixture({ address: '0xholder1', percentage: 70, balance: '700000' }),
    holderFixture({ address: '0xholder2', percentage: 40, balance: '400000' }),
];

export const invalidFloatTopHolders = [
    holderFixture({ address: '0x000000000000000000000000000000000000dEaD', label: 'Burn Address', percentage: 60, balance: '600000' }),
    holderFixture({ address: '0xpool', label: 'PancakeSwap Pool', percentage: 30, balance: '300000', isContract: true }),
    holderFixture({ address: '0xbinance', label: 'Binance Hot Wallet', percentage: 10, balance: '100000' }),
];

export function identityCandidate(
    token: TokenSearchResult,
    overrides: Partial<TokenIdentityCandidate> = {}
): TokenIdentityCandidate {
    return {
        token,
        source: 'dex_screener',
        matchType: 'exact_symbol',
        score: 0,
        evidence: [],
        riskFlags: [],
        ...overrides,
    };
}
