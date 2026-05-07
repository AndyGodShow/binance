import test from 'node:test';
import assert from 'node:assert/strict';

import type { TokenSearchResult } from './types.ts';
import {
    buildAddressIdentity,
    buildTokenEligibility,
    buildCandidateTokenResults,
    filterAndSortSearchResults,
    getFallbackBannerMessage,
    matchOfficialAlphaTokens,
    normalizeAcquisitionMix,
    pickPrimaryToken,
    resolveOnchainMappingStatus,
    resolveSelectedToken,
} from './service.ts';

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

test('resolveSelectedToken falls back to strongest primary candidate when selection is missing', () => {
    const selected = resolveSelectedToken(sampleTokens, null, null);

    assert.equal(selected?.tokenAddress, '0x222');
});

test('resolveSelectedToken ignores partial mismatches and falls back to strongest candidate', () => {
    const selected = resolveSelectedToken(sampleTokens, '0x222', '0x1');

    assert.equal(selected?.tokenAddress, '0x222');
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

test('getFallbackBannerMessage explains missing api key clearly', () => {
    assert.match(
        getFallbackBannerMessage('missing_moralis_api_key'),
        /MORALIS_API_KEY/
    );
});

test('getFallbackBannerMessage explains unsupported chains without pretending data exists', () => {
    assert.match(
        getFallbackBannerMessage('unsupported_chain'),
        /不支持/
    );
    assert.doesNotMatch(
        getFallbackBannerMessage('unsupported_chain'),
        /样本数据/
    );
});

test('getFallbackBannerMessage keeps upstream failure guidance as default', () => {
    assert.match(
        getFallbackBannerMessage('upstream_request_failed'),
        /请求失败/
    );
    assert.match(
        getFallbackBannerMessage(),
        /请求失败/
    );
});

test('getFallbackBannerMessage marks unconfirmed mappings without showing onchain data', () => {
    assert.match(
        getFallbackBannerMessage('data_source_unconfirmed' as never),
        /数据源待确认/
    );
});

test('getFallbackBannerMessage explains native assets are not ERC20 holder targets', () => {
    assert.match(
        getFallbackBannerMessage('native_asset_unsupported' as never),
        /原生币/
    );
});

test('matchOfficialAlphaTokens prefers official alpha addresses that map back to the cex symbol', () => {
    const matched = matchOfficialAlphaTokens(
        [
            {
                chainId: '1',
                chainName: 'Ethereum',
                contractAddress: '0xeth-pepe',
                name: 'Pepe',
                symbol: 'PEPE',
                cexCoinName: 'PEPE',
            },
            {
                chainId: '56',
                chainName: 'BNB Chain',
                contractAddress: '0xbsc-pepe',
                name: 'Pepe BSC',
                symbol: 'PEPE',
                cexCoinName: 'PEPE',
            },
            {
                chainId: '1',
                chainName: 'Ethereum',
                contractAddress: '0xother',
                name: 'Something Else',
                symbol: 'OTHER',
                cexCoinName: 'OTHER',
            },
        ],
        ['PEPE'],
        'PEPE'
    );

    assert.deepEqual(
        matched.map((item) => item.contractAddress),
        ['0xeth-pepe', '0xbsc-pepe']
    );
});

test('matchOfficialAlphaTokens ignores name-only lookalikes that are not the cex symbol', () => {
    const matched = matchOfficialAlphaTokens(
        [
            {
                chainId: 'CT_195',
                chainName: 'TRON',
                contractAddress: 'TMacq4TDUw5q8NFBwmbY4RLXvzvG5JTkvi',
                name: 'PePe',
                symbol: 'PePe',
                cexCoinName: '',
            },
            {
                chainId: '1',
                chainName: 'Ethereum',
                contractAddress: '0xeth-pepe',
                name: 'Pepe',
                symbol: 'PEPE',
                cexCoinName: 'PEPE',
            },
        ],
        ['PEPE'],
        'PEPE'
    );

    assert.deepEqual(
        matched.map((item) => item.contractAddress),
        ['0xeth-pepe']
    );
});

test('matchOfficialAlphaTokens can match official alpha-only symbols without cexCoinName', () => {
    const matched = matchOfficialAlphaTokens(
        [
            {
                chainId: '56',
                chainName: 'BSC',
                contractAddress: '0xbsc-opg',
                name: 'OpenGradient',
                symbol: 'OPG',
                alphaId: 'ALPHA_931',
                cexCoinName: '',
            },
        ],
        ['OPG'],
        'OPG'
    );

    assert.deepEqual(
        matched.map((item) => item.contractAddress),
        ['0xbsc-opg']
    );
});

test('resolveOnchainMappingStatus does not mark unverified alpha fallback candidates as confirmed', () => {
    assert.equal(
        resolveOnchainMappingStatus('alpha', {
            ...sampleTokens[0],
            isVerifiedContract: false,
        }),
        'candidate'
    );
});

test('pickPrimaryToken prefers the strongest exact symbol candidate on the priority chain', () => {
    const selected = pickPrimaryToken([
        {
            ...sampleTokens[0],
            tokenAddress: '0xaaa',
            chainId: 'bsc',
            chain: 'bsc',
            chainName: 'BNB Chain',
            totalHolders: 500,
            marketCap: 5_000,
            totalLiquidityUsd: 3_000,
        },
        {
            ...sampleTokens[0],
            tokenAddress: '0xbbb',
            chainId: 'ethereum',
            chain: 'ethereum',
            chainName: 'Ethereum',
            totalHolders: 320,
            marketCap: 6_000,
            totalLiquidityUsd: 4_000,
        },
        {
            ...sampleTokens[0],
            tokenAddress: '0xccc',
            symbol: 'PEPE2',
            name: 'Pepe 2.0',
            chainId: 'ethereum',
            chain: 'ethereum',
            chainName: 'Ethereum',
            totalHolders: 10_000,
            marketCap: 50_000,
            totalLiquidityUsd: 20_000,
        },
    ], 'PEPE');

    assert.equal(selected?.tokenAddress, '0xbbb');
});

test('filterAndSortSearchResults still keeps the strongest holder-backed candidates first after prefiltering', () => {
    const ranked = filterAndSortSearchResults([
        {
            ...sampleTokens[0],
            tokenAddress: '0x901',
            totalHolders: 900,
            marketCap: 9000,
            totalLiquidityUsd: 9000,
        },
        {
            ...sampleTokens[0],
            tokenAddress: '0x902',
            totalHolders: 1200,
            marketCap: 2000,
            totalLiquidityUsd: 2000,
        },
        {
            ...sampleTokens[0],
            tokenAddress: '0x903',
            totalHolders: 300,
            marketCap: 50000,
            totalLiquidityUsd: 30000,
        },
    ]);

    assert.deepEqual(
        ranked.map((token) => token.tokenAddress),
        ['0x902', '0x901', '0x903']
    );
});

test('buildCandidateTokenResults filters weak imposters and ranks market cap before liquidity and holders', () => {
    const ranked = buildCandidateTokenResults([
        {
            ...sampleTokens[0],
            tokenAddress: '0xdead',
            chainId: 'ethereum',
            chain: 'ethereum',
            marketCap: 5_000,
            totalLiquidityUsd: 0,
            totalHolders: 5_000,
        },
        {
            ...sampleTokens[0],
            tokenAddress: '0xmid',
            chainId: 'ethereum',
            chain: 'ethereum',
            marketCap: 8_000_000,
            totalLiquidityUsd: 900_000,
            totalHolders: 1_500,
        },
        {
            ...sampleTokens[0],
            tokenAddress: '0xlarge',
            chainId: 'ethereum',
            chain: 'ethereum',
            marketCap: 12_000_000,
            totalLiquidityUsd: 80_000,
            totalHolders: 500,
        },
        {
            ...sampleTokens[0],
            tokenAddress: '0xwrong',
            chainId: 'ethereum',
            chain: 'ethereum',
            symbol: 'FAKE',
            name: 'Fake Token',
            marketCap: 50_000_000,
            totalLiquidityUsd: 2_000_000,
            totalHolders: 20_000,
        },
    ], ['PEPE'], 'PEPE');

    assert.deepEqual(
        ranked.map((token) => token.tokenAddress),
        ['0xlarge', '0xmid']
    );
});

test('buildAddressIdentity downgrades symbol-only candidates to fallback evidence', () => {
    const identity = buildAddressIdentity({
        token: {
            ...sampleTokens[0],
            isVerifiedContract: false,
        },
        scope: 'contracts',
        mappingStatus: 'candidate',
        searchResults: sampleTokens,
    });

    assert.equal(identity.confidence, 'fallback');
    assert.match(identity.evidence.join(' '), /DEX|候选|币安合约/);
    assert.match(identity.riskFlags.join(' '), /官方地址|多个候选/);
});

test('buildTokenEligibility allows only confirmed clean holder data for analysis', () => {
    const eligibility = buildTokenEligibility({
        token: sampleTokens[0],
        identity: {
            symbol: 'PEPE',
            chain: 'Ethereum',
            address: '0x111',
            confidence: 'probable',
            source: 'binance_alpha',
            evidence: ['Binance Alpha 官方地址命中。'],
            riskFlags: [],
        },
        mappingStatus: 'confirmed',
        metrics: {
            totalHolders: 1200,
            holderSupply: {
                top10: { supply: 1, supplyPercent: 0.3 },
                top25: { supply: 1, supplyPercent: 0.4 },
                top50: { supply: 1, supplyPercent: 0.5 },
                top100: { supply: 1, supplyPercent: 0.6 },
                top250: { supply: 1, supplyPercent: 0.7 },
                top500: { supply: 1, supplyPercent: 0.8 },
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
        },
        dataQuality: {
            confidence: '高',
            summary: '',
            topHoldersCount: 10,
            historicalDays: 14,
            topHolderCoveragePercent: 40,
            flaggedTopHolderSharePercent: 0,
            warnings: [],
        },
    });

    assert.equal(eligibility.level, 'analysis_allowed');
    assert.equal(eligibility.category, 'A');
});

test('buildTokenEligibility blocks abnormal TopN data and keeps fallback addresses raw-only', () => {
    const blocked = buildTokenEligibility({
        token: sampleTokens[0],
        identity: {
            symbol: 'PEPE',
            chain: 'Ethereum',
            address: '0x111',
            confidence: 'probable',
            source: 'binance_alpha',
            evidence: [],
            riskFlags: [],
        },
        mappingStatus: 'confirmed',
        metrics: null,
        dataQuality: {
            confidence: '低',
            summary: '',
            topHoldersCount: 5,
            historicalDays: 1,
            topHolderCoveragePercent: 140,
            flaggedTopHolderSharePercent: 0,
            warnings: ['Top holders 明细占比合计约 140.00%，超过 100%。'],
        },
    });
    const rawOnly = buildTokenEligibility({
        token: sampleTokens[0],
        identity: {
            symbol: 'PEPE',
            chain: 'Ethereum',
            address: '0x111',
            confidence: 'fallback',
            source: 'dex_screener',
            evidence: [],
            riskFlags: ['地址来自 DEX Screener 候选。'],
        },
        mappingStatus: 'candidate',
        metrics: null,
        dataQuality: {
            confidence: '中',
            summary: '',
            topHoldersCount: 10,
            historicalDays: 14,
            topHolderCoveragePercent: 40,
            flaggedTopHolderSharePercent: 0,
            warnings: [],
        },
    });

    assert.equal(blocked.level, 'blocked');
    assert.equal(blocked.category, 'C');
    assert.equal(rawOnly.level, 'raw_only');
    assert.equal(rawOnly.category, 'B');
});

test('buildTokenEligibility downgrades high unknown or excluded holder concentration to raw-only', () => {
    const baseInput = {
        token: sampleTokens[0],
        identity: {
            symbol: 'PEPE',
            chain: 'Ethereum',
            address: '0x111',
            confidence: 'probable' as const,
            source: 'binance_alpha' as const,
            evidence: [],
            riskFlags: [],
        },
        mappingStatus: 'confirmed' as const,
        metrics: {
            totalHolders: 1200,
            holderSupply: {
                top10: { supply: 1, supplyPercent: 0.3 },
                top25: { supply: 1, supplyPercent: 0.4 },
                top50: { supply: 1, supplyPercent: 0.5 },
                top100: { supply: 1, supplyPercent: 0.6 },
                top250: { supply: 1, supplyPercent: 0.7 },
                top500: { supply: 1, supplyPercent: 0.8 },
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
        },
        dataQuality: {
            confidence: '高' as const,
            summary: '',
            topHoldersCount: 10,
            historicalDays: 14,
            topHolderCoveragePercent: 40,
            flaggedTopHolderSharePercent: 0,
            warnings: [],
        },
    };
    const unknown = buildTokenEligibility({
        ...baseInput,
        holderConcentration: {
            rawTop1: 30,
            rawTop5: 60,
            rawTop10: 70,
            floatTop1: 30,
            floatTop5: 60,
            floatTop10: 70,
            excludedSharePercent: 0,
            unknownSharePercent: 35,
            classifiedHolders: [],
            excludedTopHolders: [],
            unknownTopHolders: [],
            warnings: ['未知地址占比约 35.00%。'],
        },
    });
    const excluded = buildTokenEligibility({
        ...baseInput,
        holderConcentration: {
            rawTop1: 40,
            rawTop5: 65,
            rawTop10: 80,
            floatTop1: 6,
            floatTop5: 12,
            floatTop10: 15,
            excludedSharePercent: 45,
            unknownSharePercent: 0,
            classifiedHolders: [],
            excludedTopHolders: [],
            unknownTopHolders: [],
            warnings: ['疑似非流通/基础设施地址占比约 45.00%。'],
        },
    });

    assert.equal(unknown.level, 'raw_only');
    assert.match(unknown.reasons.join(' '), /未知地址占比/);
    assert.equal(excluded.level, 'raw_only');
    assert.match(excluded.reasons.join(' '), /基础设施地址|污染/);
});

test('buildTokenEligibility blocks missing holder percentages and raw-only Solana unlabelled holders', () => {
    const input = {
        token: {
            ...sampleTokens[0],
            chainFamily: 'solana' as const,
            chainId: 'solana',
            chain: 'solana',
            chainName: 'Solana',
        },
        identity: {
            symbol: 'PEPE',
            chain: 'Solana',
            address: 'So11111111111111111111111111111111111111112',
            confidence: 'probable' as const,
            source: 'binance_alpha' as const,
            evidence: [],
            riskFlags: [],
        },
        mappingStatus: 'confirmed' as const,
        metrics: null,
        dataQuality: {
            confidence: '高' as const,
            summary: '',
            topHoldersCount: 10,
            historicalDays: 14,
            topHolderCoveragePercent: 40,
            flaggedTopHolderSharePercent: 0,
            warnings: [],
        },
    };
    const blocked = buildTokenEligibility({
        ...input,
        holderConcentration: {
            rawTop1: null,
            rawTop5: null,
            rawTop10: null,
            floatTop1: null,
            floatTop5: null,
            floatTop10: null,
            excludedSharePercent: 0,
            unknownSharePercent: 0,
            classifiedHolders: [],
            excludedTopHolders: [],
            unknownTopHolders: [],
            warnings: ['部分 Top holders 缺少可用占比。'],
        },
    });
    const rawOnly = buildTokenEligibility({
        ...input,
        holderConcentration: {
            rawTop1: 20,
            rawTop5: 55,
            rawTop10: 70,
            floatTop1: 20,
            floatTop5: 55,
            floatTop10: 70,
            excludedSharePercent: 0,
            unknownSharePercent: 70,
            classifiedHolders: [],
            excludedTopHolders: [],
            unknownTopHolders: [],
            warnings: [],
        },
    });

    assert.equal(blocked.level, 'blocked');
    assert.equal(rawOnly.level, 'raw_only');
    assert.match(rawOnly.reasons.join(' '), /Solana|标签/);
});

test('buildTokenEligibility blocks when every Top holder is unknown', () => {
    const eligibility = buildTokenEligibility({
        token: sampleTokens[0],
        identity: {
            symbol: 'PEPE',
            chain: 'Ethereum',
            address: '0x111',
            confidence: 'probable',
            source: 'binance_alpha',
            evidence: [],
            riskFlags: [],
        },
        mappingStatus: 'confirmed',
        metrics: null,
        dataQuality: {
            confidence: '高',
            summary: '',
            topHoldersCount: 10,
            historicalDays: 14,
            topHolderCoveragePercent: 80,
            flaggedTopHolderSharePercent: 0,
            warnings: [],
        },
        holderConcentration: {
            rawTop1: 20,
            rawTop5: 55,
            rawTop10: 80,
            floatTop1: 20,
            floatTop5: 55,
            floatTop10: 80,
            excludedSharePercent: 0,
            unknownSharePercent: 80,
            classifiedHolders: Array.from({ length: 10 }, (_, index) => ({
                address: `0xunknown${index}`,
                percentage: 8,
                class: 'unknown' as const,
                confidence: 'low' as const,
                reasons: ['缺少可用 label/entity，无法可靠分类。'],
            })),
            excludedTopHolders: [],
            unknownTopHolders: [],
            warnings: [],
        },
    });

    assert.equal(eligibility.level, 'blocked');
    assert.match(eligibility.reasons.join(' '), /全部 Top holders/);
});

test('buildTokenEligibility links supply confidence and estimated float supply', () => {
    const baseInput = {
        token: sampleTokens[0],
        identity: {
            symbol: 'PEPE',
            chain: 'Ethereum',
            address: '0x111',
            confidence: 'probable' as const,
            source: 'binance_alpha' as const,
            evidence: [],
            riskFlags: [],
        },
        mappingStatus: 'confirmed' as const,
        metrics: null,
        dataQuality: {
            confidence: '高' as const,
            summary: '',
            topHoldersCount: 10,
            historicalDays: 14,
            topHolderCoveragePercent: 60,
            flaggedTopHolderSharePercent: 0,
            warnings: [],
        },
    };
    const blocked = buildTokenEligibility({
        ...baseInput,
        supplyBreakdown: {
            totalSupply: 1000,
            circulatingSupply: null,
            burnedSupply: 400,
            lockedOrInfrastructureSupply: 500,
            cexSupply: 100,
            unknownTopHolderSupply: 0,
            estimatedFloatSupply: 0,
            confidence: 'low',
            warnings: ['estimatedFloatSupply <= 0'],
            evidence: [],
        },
    });
    const rawOnly = buildTokenEligibility({
        ...baseInput,
        supplyBreakdown: {
            totalSupply: 1000,
            circulatingSupply: null,
            burnedSupply: 50,
            lockedOrInfrastructureSupply: 100,
            cexSupply: 20,
            unknownTopHolderSupply: 300,
            estimatedFloatSupply: 830,
            confidence: 'low',
            warnings: ['unknownTopHolderSupply 过高'],
            evidence: [],
        },
    });

    assert.equal(blocked.level, 'blocked');
    assert.match(blocked.reasons.join(' '), /estimatedFloatSupply/);
    assert.equal(rawOnly.level, 'raw_only');
    assert.match(rawOnly.reasons.join(' '), /SupplyBreakdown|circulatingSupply|unknownTopHolderSupply/);
});
