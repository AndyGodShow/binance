import { buildOnchainDataQuality } from './analysis.ts';
import {
    normalizeAssetTerm,
    resolveTokenIdentity,
    tokenizeSearchInput,
} from './identity.ts';
import type {
    AnalysisEligibility,
    AddressIdentity,
    HolderConcentrationAnalysis,
    OnchainSearchScope,
    SupplyBreakdown,
    TokenHolderMetrics,
    TokenIdentityCandidate,
    TokenIdentityResolution,
    TokenSearchResult,
} from './types';

const DEFAULT_QUERY = 'PEPE';
const NATIVE_CONTRACT_ASSETS = new Set([
    'BTC', 'ETH', 'SOL', 'BNB', 'XRP', 'ADA', 'DOGE', 'TRX', 'TON', 'AVAX', 'DOT', 'LTC', 'BCH',
]);
const STABLE_CONTRACT_ASSETS = new Set(['USDT', 'USDC', 'FDUSD', 'TUSD', 'DAI', 'USDE']);
const WRAPPED_ASSETS = new Set(['WBTC', 'WETH', 'WBNB', 'WSOL', 'WAVAX', 'WMATIC', 'WTRX']);

export function resolveOnchainMappingStatus(
    scope: OnchainSearchScope,
    token: TokenSearchResult
) {
    if (token.isVerifiedContract) {
        return 'confirmed';
    }

    return scope === 'contracts' || scope === 'alpha' ? 'candidate' : 'unavailable';
}

export function buildTokenIdentityResolution({
    token,
    scope,
    query = token?.symbol ?? DEFAULT_QUERY,
    searchResults = [],
}: {
    token: TokenSearchResult | null;
    scope: OnchainSearchScope;
    query?: string;
    searchResults?: TokenSearchResult[];
}): TokenIdentityResolution {
    const candidates = (searchResults.length > 0 ? searchResults : (token ? [token] : []))
        .map((candidate) => {
            const terms = tokenizeSearchInput(query);
            const symbol = normalizeAssetTerm(candidate.symbol);
            const name = normalizeAssetTerm(candidate.name);
            const normalizedAddress = query.trim().toLowerCase();
            const isAddressMatch = candidate.tokenAddress.toLowerCase() === normalizedAddress;
            const isExactSymbol = terms.some((term) => symbol === term);
            const isSymbolFuzzy = terms.some((term) => symbol.includes(term) || term.includes(symbol));
            const isNameFuzzy = terms.some((term) => name.includes(term));
            const source = candidate.isVerifiedContract ? 'binance_alpha' as const : 'dex_screener' as const;
            const matchType: TokenIdentityCandidate['matchType'] = isAddressMatch
                ? 'exact_address'
                : isExactSymbol
                    ? 'exact_symbol'
                    : isSymbolFuzzy
                        ? 'symbol_fuzzy'
                        : isNameFuzzy
                            ? 'name_fuzzy'
                            : 'unknown';

            return {
                token: candidate,
                source,
                matchType,
                evidence: [
                    source === 'binance_alpha'
                        ? 'Binance Alpha 可识别地址候选。'
                        : 'DEX Screener/Moralis 候选地址。',
                ],
                riskFlags: matchType === 'symbol_fuzzy' || matchType === 'name_fuzzy'
                    ? ['symbol/name 模糊命中。']
                    : [],
            };
        });
    const resolution = resolveTokenIdentity({
        query,
        scope,
        futuresSymbols: scope === 'contracts' ? tokenizeSearchInput(query).slice(-1) : [],
        candidates,
    });
    return {
        ...resolution,
        candidates: token
            ? [
                ...resolution.candidates.filter((candidate) => (
                    candidate.token.tokenAddress.toLowerCase() === token.tokenAddress.toLowerCase()
                    && candidate.token.chainId === token.chainId
                )),
                ...resolution.candidates.filter((candidate) => !(
                    candidate.token.tokenAddress.toLowerCase() === token.tokenAddress.toLowerCase()
                    && candidate.token.chainId === token.chainId
                )),
            ]
            : resolution.candidates,
    };
}

export function identityFromResolution(
    resolution: TokenIdentityResolution,
    mappingStatus: ReturnType<typeof resolveOnchainMappingStatus>,
    token: TokenSearchResult | null
): AddressIdentity {
    return {
        symbol: token?.symbol ?? resolution.normalizedSymbol,
        chain: resolution.chain ?? '',
        address: resolution.address,
        confidence: mappingStatus === 'unavailable' ? 'blocked' : resolution.confidence,
        source: resolution.source,
        evidence: resolution.evidence,
        riskFlags: resolution.riskFlags,
    };
}

export function buildAddressIdentity({
    token,
    scope,
    mappingStatus,
    query = token?.symbol ?? DEFAULT_QUERY,
    searchResults = [],
}: {
    token: TokenSearchResult | null;
    scope: OnchainSearchScope;
    mappingStatus: ReturnType<typeof resolveOnchainMappingStatus>;
    query?: string;
    searchResults?: TokenSearchResult[];
}): AddressIdentity {
    return identityFromResolution(
        buildTokenIdentityResolution({ token, scope, query, searchResults }),
        mappingStatus,
        token
    );
}

function hasBadSupplyBuckets(metrics: TokenHolderMetrics | null) {
    if (!metrics) {
        return false;
    }

    const buckets = [
        metrics.holderSupply.top10.supplyPercent,
        metrics.holderSupply.top25.supplyPercent,
        metrics.holderSupply.top50.supplyPercent,
        metrics.holderSupply.top100.supplyPercent,
        metrics.holderSupply.top250.supplyPercent,
        metrics.holderSupply.top500.supplyPercent,
    ].map((value) => (value < 1 ? value * 100 : value));

    return buckets.some((value) => !Number.isFinite(value) || value < 0 || value > 100)
        || buckets.some((value, index) => index > 0 && value + 0.000001 < buckets[index - 1]);
}

export function buildTokenEligibility({
    token,
    identity,
    mappingStatus,
    metrics,
    dataQuality,
    holderConcentration,
    supplyBreakdown,
}: {
    token: TokenSearchResult | null;
    identity: AddressIdentity;
    mappingStatus: ReturnType<typeof resolveOnchainMappingStatus>;
    metrics: TokenHolderMetrics | null;
    dataQuality: ReturnType<typeof buildOnchainDataQuality>;
    holderConcentration?: HolderConcentrationAnalysis;
    supplyBreakdown?: SupplyBreakdown;
}): AnalysisEligibility {
    const reasons: string[] = [];
    const requiredManualChecks: string[] = [];
    const symbolTerms = token ? tokenizeSearchInput(token.symbol) : [];
    const name = token?.name.toLowerCase() ?? '';
    const topCoverage = dataQuality.topHolderCoveragePercent;
    const hasImpossibleTopHolders = topCoverage !== null && topCoverage > 100.000001;
    const isWrapped = symbolTerms.some((term) => WRAPPED_ASSETS.has(term)) || name.includes('wrapped');
    const isBridgeLike = name.includes('bridge') || identity.riskFlags.some((flag) => /bridge|跨链|桥/i.test(flag));
    const isStable = symbolTerms.some((term) => STABLE_CONTRACT_ASSETS.has(term));
    const isNative = symbolTerms.some((term) => NATIVE_CONTRACT_ASSETS.has(term));

    if (!token || !identity.address || identity.confidence === 'blocked') {
        return {
            level: 'blocked',
            category: 'C',
            reasons: ['地址无法确认，禁止生成链上结构观察。'],
            requiredManualChecks: ['确认官方合约地址、链和主交易池。'],
        };
    }

    if (isNative || isStable || isWrapped || isBridgeLike) {
        reasons.push(
            isNative ? '原生 gas/主流资产不适合套用 token holder 集中度口径。'
                : isStable ? '稳定币需要单独发行储备和跨链口径，禁止生成链上结构观察。'
                    : isWrapped ? 'Wrapped asset 的 holder 结构反映包装合约流通，不代表底层资产筹码。'
                        : 'Bridge token 的 holder 结构受跨链托管/桥合约影响。'
        );
    }

    if (identity.confidence === 'unverified') {
        reasons.push('地址来源未验证。');
    }

    if (hasImpossibleTopHolders || hasBadSupplyBuckets(metrics)) {
        reasons.push('TopN 或 holderSupply 数据异常。');
    }

    if (holderConcentration && (
        holderConcentration.rawTop1 === null
        || holderConcentration.rawTop5 === null
        || holderConcentration.rawTop10 === null
    )) {
        reasons.push('holder percentage 无法计算。');
    }
    if (
        holderConcentration
        && holderConcentration.classifiedHolders.length > 0
        && holderConcentration.classifiedHolders.every((holder) => holder.class === 'unknown')
    ) {
        reasons.push('全部 Top holders 都无法可靠分类。');
    }
    if (supplyBreakdown && (
        (supplyBreakdown.estimatedFloatSupply !== null && supplyBreakdown.estimatedFloatSupply <= 0)
        || (
            supplyBreakdown.estimatedFloatSupply !== null
            && supplyBreakdown.totalSupply !== null
            && supplyBreakdown.estimatedFloatSupply > supplyBreakdown.totalSupply
        )
        || supplyBreakdown.warnings.some((warning) => /分母存在冲突|数学异常/.test(warning))
    )) {
        reasons.push('estimatedFloatSupply 或供应分母数学异常。');
    }

    if (reasons.length > 0) {
        return {
            level: 'blocked',
            category: 'C',
            reasons,
            requiredManualChecks: [
                '核验官方合约地址和 token supply 分母。',
                '复核 Top holders 是否存在接口口径错误。',
            ],
        };
    }

    if (mappingStatus !== 'confirmed' || identity.confidence === 'fallback') {
        reasons.push('地址映射来自 fallback 候选，不能生成链上结构观察。');
    }
    if (dataQuality.confidence !== '高') {
        reasons.push('holder 数据不完整或数据可信度不足。');
    }
    if (!metrics) {
        reasons.push('holder metrics 缺失，只能展示市场与身份原始数据。');
    }
    if (dataQuality.flaggedTopHolderSharePercent > 0) {
        reasons.push('Top holders 存在 LP/CEX/burn/contract 污染，当前未做净化剔除。');
    }
    if (dataQuality.topHoldersCount < 10) {
        reasons.push('Top holders 标签或覆盖不足，只能展示原始数据。');
    }
    if (holderConcentration) {
        if (holderConcentration.unknownSharePercent >= 25) {
            reasons.push(`未知地址占比约 ${holderConcentration.unknownSharePercent.toFixed(2)}%，不能生成净化后观察。`);
        }
        if (holderConcentration.excludedSharePercent >= 20) {
            reasons.push(`疑似非流通/基础设施地址占比约 ${holderConcentration.excludedSharePercent.toFixed(2)}%，原始集中度污染明显。`);
        }
        if (token.chainFamily === 'solana' && holderConcentration.unknownSharePercent >= 50) {
            reasons.push('Solana Top holders 缺少 label/entity，地址分类可信度不足。');
        }
    }
    if (supplyBreakdown) {
        if (supplyBreakdown.confidence === 'low') {
            reasons.push('SupplyBreakdown confidence = low，只能展示原始供应口径。');
        }
        if (supplyBreakdown.circulatingSupply === null) {
            reasons.push('circulatingSupply 缺失，估算可流通供应不等于真实流通量。');
        }
        if (supplyBreakdown.warnings.some((warning) => /FDV|unknownTopHolderSupply|lockedOrInfrastructureSupply/.test(warning))) {
            reasons.push(...supplyBreakdown.warnings);
        }
    }
    if (identity.riskFlags.length > 0) {
        reasons.push(...identity.riskFlags);
    }

    if (reasons.length > 0) {
        requiredManualChecks.push('确认官方合约地址、链、主池和项目公告。');
        requiredManualChecks.push('人工标注 Top holders 中的 LP、CEX、burn、treasury、vesting、bridge 地址。');
        return {
            level: 'raw_only',
            category: 'B',
            reasons: Array.from(new Set(reasons)),
            requiredManualChecks,
        };
    }

    return {
        level: 'analysis_allowed',
        category: 'A',
        reasons: ['地址来源和 holder 数据通过第一阶段可信度门槛。'],
        requiredManualChecks: ['继续人工复核 Top holders 标签，当前系统尚未做地址净化。'],
    };
}

export function applyEligibilityToHolderConcentration(
    holderConcentration: HolderConcentrationAnalysis,
    eligibility: AnalysisEligibility
): HolderConcentrationAnalysis {
    if (eligibility.level === 'analysis_allowed') {
        return holderConcentration;
    }

    return {
        ...holderConcentration,
        floatTop1: null,
        floatTop5: null,
        floatTop10: null,
        warnings: Array.from(new Set([
            ...holderConcentration.warnings,
            '未通过 eligibility gate，隐藏净化后 TopN。',
        ])),
    };
}
