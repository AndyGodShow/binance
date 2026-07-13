import test from 'node:test';
import assert from 'node:assert/strict';

import { buildHolderConcentration } from './addressClassifier.ts';
import { buildOnchainDataQuality, buildStructureObservation } from './analysis.ts';
import { resolveTokenIdentity } from './identity.ts';
import {
    applyEligibilityToHolderConcentration,
    buildAddressIdentity,
    buildTokenEligibility,
    resolveOnchainMappingStatus,
} from './service.ts';
import {
    applySupplyToHolderConcentration,
    buildSupplyBreakdown,
} from './supplyNormalizer.ts';
import {
    alphaOfficialToken,
    cleanTopHolders,
    dexFallbackToken,
    fuzzyFakeToken,
    holderFixture,
    identityCandidate,
    invalidFloatTopHolders,
    invalidPercentageTopHolders,
    invalidSupplyToken,
    metricsFixture,
    nativeAsset,
    pollutedTopHolders,
    pollutedTopHoldersToken,
    solanaUnlabeledToken,
    stablecoinToken,
    tokenFixture,
    unknownHeavyTopHolders,
    wrappedToken,
} from './onchainTracker.e2e.fixtures.ts';
import type {
    AddressIdentity,
    HolderConcentrationAnalysis,
    HistoricalHoldersPoint,
    OnchainMappingStatus,
    OnchainSearchScope,
    SupplyBreakdown,
    TokenHolderMetrics,
    TokenSearchResult,
    TopHolderItem,
} from './types.ts';

type ScenarioInput = {
    query: string;
    scope: OnchainSearchScope;
    token: TokenSearchResult | null;
    searchResults?: TokenSearchResult[];
    topHolders?: TopHolderItem[];
    metrics?: TokenHolderMetrics | null;
    historical?: HistoricalHoldersPoint[];
    mappingStatus?: OnchainMappingStatus;
    identity?: AddressIdentity;
    supplyOverride?: Partial<SupplyBreakdown>;
};

function buildScenario({
    query,
    scope,
    token,
    searchResults = token ? [token] : [],
    topHolders = cleanTopHolders,
    metrics = metricsFixture(),
    historical = [],
    mappingStatus = token ? resolveOnchainMappingStatus(scope, token) : 'unavailable',
    identity = buildAddressIdentity({ token, scope, mappingStatus, query, searchResults }),
    supplyOverride,
}: ScenarioInput) {
    const rawHolderConcentration = buildHolderConcentration(topHolders);
    const rawSupplyBreakdown = buildSupplyBreakdown({ token, holderConcentration: rawHolderConcentration });
    const supplyBreakdown = { ...rawSupplyBreakdown, ...supplyOverride };
    const holderConcentration = applySupplyToHolderConcentration(rawHolderConcentration, supplyBreakdown);
    const dataQuality = buildOnchainDataQuality(metrics, historical, topHolders);
    const eligibility = buildTokenEligibility({
        token,
        identity,
        mappingStatus,
        metrics,
        dataQuality,
        holderConcentration,
        supplyBreakdown,
    });
    const exposedHolderConcentration = applyEligibilityToHolderConcentration(holderConcentration, eligibility);
    const analysis = eligibility.level === 'analysis_allowed'
        ? buildStructureObservation(metrics!, historical, exposedHolderConcentration)
        : null;

    return {
        identity,
        eligibility,
        supplyBreakdown,
        holderConcentration: exposedHolderConcentration,
        analysis,
    };
}

function assertNoFloatTopN(holderConcentration: HolderConcentrationAnalysis) {
    assert.equal(holderConcentration.floatTop1, null);
    assert.equal(holderConcentration.floatTop5, null);
    assert.equal(holderConcentration.floatTop10, null);
}

function assertGateClosed(result: ReturnType<typeof buildScenario>) {
    assert.notEqual(result.eligibility.level, 'analysis_allowed');
    assert.equal(result.analysis, null);
    assertNoFloatTopN(result.holderConcentration);
}

function historicalFixture(): HistoricalHoldersPoint[] {
    return Array.from({ length: 14 }, (_, index) => ({
        timestamp: `2026-01-${String(index + 1).padStart(2, '0')}T00:00:00.000Z`,
        totalHolders: 2000 + index,
        netHolderChange: 0,
        holderPercentChange: 0,
        newHoldersByAcquisition: { swap: 0, transfer: 0, airdrop: 0 },
        holdersIn: { whales: 1, sharks: 2, dolphins: 3, fish: 4, octopus: 5, crabs: 6, shrimps: 7 },
        holdersOut: { whales: 1, sharks: 2, dolphins: 3, fish: 4, octopus: 5, crabs: 6, shrimps: 7 },
    }));
}

test('alphaOfficialToken stays raw-only when supply denominator lacks circulating supply', () => {
    const result = buildScenario({
        query: 'PEPE',
        scope: 'alpha',
        token: alphaOfficialToken,
    });

    assert.equal(result.identity.confidence, 'probable');
    assert.deepEqual(result.identity.riskFlags, []);
    assert.equal(result.eligibility.level, 'raw_only');
    assert.match(result.eligibility.reasons.join(' '), /circulatingSupply/);
    assert.equal(result.supplyBreakdown.confidence, 'medium');
    assertGateClosed(result);
});

test('futures symbol without official address is blocked by identity gate', () => {
    const resolution = resolveTokenIdentity({
        query: 'NEWCOINUSDT',
        scope: 'contracts',
        futuresSymbols: ['NEWCOINUSDT'],
        candidates: [],
    });
    const result = buildScenario({
        query: 'NEWCOINUSDT',
        scope: 'contracts',
        token: null,
        identity: {
            symbol: resolution.normalizedSymbol,
            chain: resolution.chain ?? '',
            address: resolution.address,
            confidence: resolution.confidence,
            source: resolution.source,
            evidence: resolution.evidence,
            riskFlags: resolution.riskFlags,
        },
        metrics: null,
    });

    assert.equal(result.identity.confidence, 'blocked');
    assert.match(result.identity.riskFlags.join(' '), /地址无法确认/);
    assert.equal(result.eligibility.level, 'blocked');
    assert.match(result.eligibility.reasons.join(' '), /地址无法确认/);
    assert.equal(result.supplyBreakdown.confidence, 'low');
    assertGateClosed(result);
});

test('1000-prefix futures symbol is normalized but still raw-only without official address', () => {
    const result = buildScenario({
        query: '1000PEPEUSDT',
        scope: 'contracts',
        token: dexFallbackToken,
        searchResults: [dexFallbackToken],
        mappingStatus: 'candidate',
    });

    assert.equal(result.identity.confidence, 'fallback');
    assert.match(result.identity.riskFlags.join(' '), /不能证明链上地址/);
    assert.equal(result.eligibility.level, 'raw_only');
    assert.match(result.eligibility.reasons.join(' '), /fallback|circulatingSupply/);
    assertGateClosed(result);
});

test('same-name meme token candidates do not become analysis allowed', () => {
    const resolution = resolveTokenIdentity({
        query: 'PEPE',
        scope: 'contracts',
        candidates: [
            identityCandidate(dexFallbackToken, { score: 520, evidence: ['DEX exact symbol match.'] }),
            identityCandidate(tokenFixture({
                tokenAddress: '0xotherpepe000000000000000000000000000000',
                chainId: 'base',
                chain: 'base',
                chainName: 'Base',
                symbol: 'PEPE',
                marketCap: 9_800_000,
            }), { score: 500, evidence: ['DEX exact symbol match.'] }),
        ],
    });
    const result = buildScenario({
        query: 'PEPE',
        scope: 'contracts',
        token: dexFallbackToken,
        mappingStatus: 'candidate',
        identity: {
            symbol: resolution.normalizedSymbol,
            chain: resolution.chain ?? '',
            address: resolution.address,
            confidence: resolution.confidence,
            source: resolution.source,
            evidence: resolution.evidence,
            riskFlags: resolution.riskFlags,
        },
    });

    assert.equal(result.identity.confidence, 'fallback');
    assert.match(result.identity.riskFlags.join(' '), /多个候选|地址不唯一/);
    assert.equal(result.eligibility.level, 'raw_only');
    assertGateClosed(result);
});

test('multi-chain token candidates are raw-only until main contract is manually confirmed', () => {
    const wifFallbackToken = tokenFixture({
        tokenAddress: '0xethwif',
        symbol: 'WIF',
        name: 'dogwifhat',
        isVerifiedContract: false,
    });
    const resolution = resolveTokenIdentity({
        query: 'WIF',
        scope: 'contracts',
        candidates: [
            identityCandidate(wifFallbackToken, { score: 520, evidence: ['DEX exact symbol match.'] }),
            identityCandidate(tokenFixture({
                tokenAddress: '0xbscwif',
                chainId: 'bsc',
                chain: 'bsc',
                chainName: 'BNB Chain',
                symbol: 'WIF',
                marketCap: 9_800_000,
            }), { score: 500, evidence: ['DEX exact symbol match.'] }),
        ],
    });
    const result = buildScenario({
        query: 'WIF',
        scope: 'contracts',
        token: wifFallbackToken,
        mappingStatus: 'candidate',
        identity: {
            symbol: resolution.normalizedSymbol,
            chain: resolution.chain ?? '',
            address: resolution.address,
            confidence: resolution.confidence,
            source: resolution.source,
            evidence: resolution.evidence,
            riskFlags: resolution.riskFlags,
        },
    });

    assert.equal(result.identity.confidence, 'fallback');
    assert.match(result.identity.riskFlags.join(' '), /多个候选|官方地址/);
    assert.equal(result.eligibility.level, 'raw_only');
    assertGateClosed(result);
});

test('fuzzy fake token is unverified and cannot pass the gate', () => {
    const resolution = resolveTokenIdentity({
        query: 'PEPE',
        scope: 'contracts',
        candidates: [
            identityCandidate(fuzzyFakeToken, {
                matchType: 'symbol_fuzzy',
                evidence: ['DEX Screener symbol/name 模糊匹配。'],
                riskFlags: ['symbol/name 模糊命中。'],
            }),
        ],
    });
    const result = buildScenario({
        query: 'PEPE',
        scope: 'contracts',
        token: fuzzyFakeToken,
        mappingStatus: 'candidate',
        identity: {
            symbol: resolution.normalizedSymbol,
            chain: resolution.chain ?? '',
            address: resolution.address,
            confidence: resolution.confidence,
            source: resolution.source,
            evidence: resolution.evidence,
            riskFlags: resolution.riskFlags,
        },
    });

    assert.equal(result.identity.confidence, 'unverified');
    assert.match(result.identity.riskFlags.join(' '), /模糊|同名币/);
    assert.equal(result.eligibility.level, 'blocked');
    assertGateClosed(result);
});

test('wrapped stablecoin and native asset fixtures are blocked', () => {
    for (const token of [wrappedToken, stablecoinToken, nativeAsset]) {
        const result = buildScenario({
            query: token.symbol,
            scope: 'alpha',
            token,
            identity: {
                symbol: token.symbol,
                chain: token.chainName,
                address: token.tokenAddress,
                confidence: 'probable',
                source: 'binance_alpha',
                evidence: ['Binance Alpha 官方地址命中。'],
                riskFlags: [],
            },
        });

        assert.equal(result.eligibility.level, 'blocked');
        assert.match(result.eligibility.reasons.join(' '), /原生|稳定币|Wrapped/);
        assertGateClosed(result);
    }
});

test('Solana token with missing labels is blocked before analysis', () => {
    const result = buildScenario({
        query: 'SMEME',
        scope: 'alpha',
        token: solanaUnlabeledToken,
        topHolders: Array.from({ length: 10 }, (_, index) => holderFixture({
            address: `SolanaUnknown${index}`,
            label: null,
            entity: null,
            percentage: 5,
            balance: '50000',
            isContract: false,
        })),
        identity: {
            symbol: 'SMEME',
            chain: 'Solana',
            address: solanaUnlabeledToken.tokenAddress,
            confidence: 'probable',
            source: 'binance_alpha',
            evidence: ['Binance Alpha 官方地址命中。'],
            riskFlags: [],
        },
    });

    assert.equal(result.identity.confidence, 'probable');
    assert.equal(result.eligibility.level, 'blocked');
    assert.match(result.eligibility.reasons.join(' '), /全部 Top holders/);
    assert.equal(result.supplyBreakdown.confidence, 'low');
    assertGateClosed(result);
});

test('Top holders over 100 percent are blocked and analysis stays hidden', () => {
    const result = buildScenario({
        query: 'INVALID',
        scope: 'alpha',
        token: invalidSupplyToken,
        topHolders: invalidPercentageTopHolders,
        identity: {
            symbol: 'INVALID',
            chain: 'Ethereum',
            address: invalidSupplyToken.tokenAddress,
            confidence: 'probable',
            source: 'binance_alpha',
            evidence: ['Binance Alpha 官方地址命中。'],
            riskFlags: [],
        },
    });

    assert.equal(result.eligibility.level, 'blocked');
    assert.match(result.eligibility.reasons.join(' '), /TopN|数学异常|分母/);
    assert.match(result.supplyBreakdown.warnings.join(' '), /percentage 数学异常/);
    assertGateClosed(result);
});

test('FDV without marketCap keeps supply confidence low and closes analysis gate', () => {
    const token = tokenFixture({ marketCap: null, fdv: 20_000_000 });
    const result = buildScenario({
        query: token.symbol,
        scope: 'alpha',
        token,
        identity: {
            symbol: token.symbol,
            chain: token.chainName,
            address: token.tokenAddress,
            confidence: 'probable',
            source: 'binance_alpha',
            evidence: ['Binance Alpha 官方地址命中。'],
            riskFlags: [],
        },
    });

    assert.equal(result.supplyBreakdown.confidence, 'low');
    assert.match(result.supplyBreakdown.warnings.join(' '), /FDV|marketCap/);
    assert.equal(result.eligibility.level, 'raw_only');
    assert.match(result.eligibility.reasons.join(' '), /FDV|SupplyBreakdown/);
    assertGateClosed(result);
});

test('LP CEX and burn pollution blocks float supply and analysis', () => {
    const result = buildScenario({
        query: 'POLLUTE',
        scope: 'alpha',
        token: pollutedTopHoldersToken,
        topHolders: pollutedTopHolders,
        identity: {
            symbol: 'POLLUTE',
            chain: 'Ethereum',
            address: pollutedTopHoldersToken.tokenAddress,
            confidence: 'probable',
            source: 'binance_alpha',
            evidence: ['Binance Alpha 官方地址命中。'],
            riskFlags: [],
        },
    });

    assert.equal(result.eligibility.level, 'raw_only');
    assert.match(result.eligibility.reasons.join(' '), /基础设施|SupplyBreakdown|lockedOrInfrastructureSupply/);
    assert.equal(result.supplyBreakdown.confidence, 'medium');
    assertGateClosed(result);
});

test('unknown holder concentration is raw-only and cannot expose float TopN', () => {
    const result = buildScenario({
        query: 'PEPE',
        scope: 'alpha',
        token: alphaOfficialToken,
        topHolders: unknownHeavyTopHolders,
        identity: {
            symbol: 'PEPE',
            chain: 'Ethereum',
            address: alphaOfficialToken.tokenAddress,
            confidence: 'probable',
            source: 'binance_alpha',
            evidence: ['Binance Alpha 官方地址命中。'],
            riskFlags: [],
        },
    });

    assert.equal(result.eligibility.level, 'raw_only');
    assert.match(result.eligibility.reasons.join(' '), /未知地址占比|unknownTopHolderSupply/);
    assertGateClosed(result);
});

test('estimatedFloatSupply below zero is blocked', () => {
    const result = buildScenario({
        query: 'INVALID',
        scope: 'alpha',
        token: invalidSupplyToken,
        topHolders: invalidFloatTopHolders,
        identity: {
            symbol: 'INVALID',
            chain: 'Ethereum',
            address: invalidSupplyToken.tokenAddress,
            confidence: 'probable',
            source: 'binance_alpha',
            evidence: ['Binance Alpha 官方地址命中。'],
            riskFlags: [],
        },
    });

    assert.equal(result.eligibility.level, 'blocked');
    assert.match(result.eligibility.reasons.join(' '), /estimatedFloatSupply/);
    assert.equal(result.supplyBreakdown.estimatedFloatSupply, 0);
    assertGateClosed(result);
});

test('DEX pair baseToken address mismatch remains raw-only through risk flags', () => {
    const resolution = resolveTokenIdentity({
        query: 'PEPE',
        scope: 'contracts',
        candidates: [
            identityCandidate(dexFallbackToken, {
                evidence: ['DEX Screener pair baseToken 与候选 tokenAddress 不一致。'],
                riskFlags: ['DEX pair baseToken address 不匹配，可能选中了错误交易池。'],
            }),
        ],
    });
    const result = buildScenario({
        query: 'PEPE',
        scope: 'contracts',
        token: dexFallbackToken,
        mappingStatus: 'candidate',
        identity: {
            symbol: resolution.normalizedSymbol,
            chain: resolution.chain ?? '',
            address: resolution.address,
            confidence: resolution.confidence,
            source: resolution.source,
            evidence: resolution.evidence,
            riskFlags: resolution.riskFlags,
        },
    });

    assert.equal(result.identity.confidence, 'fallback');
    assert.match(result.identity.riskFlags.join(' '), /baseToken address 不匹配/);
    assert.equal(result.eligibility.level, 'raw_only');
    assert.match(result.eligibility.reasons.join(' '), /baseToken address 不匹配/);
    assertGateClosed(result);
});

test('analysis allowed only when every gate is explicitly satisfied', () => {
    const result = buildScenario({
        query: 'PEPE',
        scope: 'alpha',
        token: alphaOfficialToken,
        identity: {
            symbol: 'PEPE',
            chain: 'Ethereum',
            address: alphaOfficialToken.tokenAddress,
            confidence: 'probable',
            source: 'binance_alpha',
            evidence: ['Binance Alpha 官方地址命中。'],
            riskFlags: [],
        },
        supplyOverride: {
            circulatingSupply: 1_000_000,
            confidence: 'high',
            warnings: [],
        },
        historical: historicalFixture(),
    });

    assert.equal(result.identity.confidence, 'probable');
    assert.equal(result.eligibility.level, 'analysis_allowed');
    assert.equal(result.supplyBreakdown.confidence, 'high');
    assert.notEqual(result.holderConcentration.floatTop1, null);
    assert.notEqual(result.analysis, null);
});
