import type {
    AddressConfidence,
    OnchainSearchScope,
    TokenIdentityCandidate,
    TokenIdentityResolution,
    TokenIdentitySource,
    TokenSearchResult,
} from './types.ts';

type CandidateInput = Omit<TokenIdentityCandidate, 'score'> & { score?: number };

export function normalizeAssetTerm(value: string) {
    return value.trim().toUpperCase();
}

function stripLeadingMultiplier(value: string) {
    return value.replace(/^\d+/, '');
}

export function tokenizeSearchInput(query: string) {
    const normalized = normalizeAssetTerm(query);
    const strippedQuote = normalized.replace(/(USDT|USDC|FDUSD)$/i, '');
    const strippedMultiplier = stripLeadingMultiplier(strippedQuote);
    return Array.from(new Set([normalized, strippedQuote, strippedMultiplier].filter(Boolean))) as string[];
}

export function chainPriority(chainId: string) {
    switch (chainId) {
        case 'ethereum':
            return 6;
        case 'bsc':
            return 5;
        case 'solana':
            return 4;
        case 'base':
            return 3;
        case 'arbitrum':
            return 2;
        case 'optimism':
            return 1;
        default:
            return 0;
    }
}

function sourceBaseScore(source: TokenIdentitySource) {
    switch (source) {
        case 'binance_alpha':
            return 900;
        case 'manual':
            return 850;
        case 'futures_symbol':
            return 500;
        case 'dex_screener':
            return 300;
        case 'unknown':
        default:
            return 0;
    }
}

function matchScore(matchType: TokenIdentityCandidate['matchType']) {
    switch (matchType) {
        case 'exact_address':
            return 500;
        case 'exact_symbol':
            return 240;
        case 'futures_symbol':
            return 180;
        case 'symbol_fuzzy':
            return 80;
        case 'name_fuzzy':
            return 40;
        case 'unknown':
        default:
            return 0;
    }
}

function marketScore(token: TokenSearchResult) {
    return Math.min(80, Math.log10((token.marketCap ?? 0) + 1) * 8)
        + Math.min(60, Math.log10((token.totalLiquidityUsd ?? 0) + 1) * 6)
        + Math.min(60, Math.log10((token.totalHolders ?? 0) + 1) * 10)
        + chainPriority(token.chainId) * 10;
}

function scoreCandidate(candidate: CandidateInput) {
    if (candidate.score !== undefined) {
        return candidate.score;
    }

    return sourceBaseScore(candidate.source)
        + matchScore(candidate.matchType)
        + marketScore(candidate.token);
}

function normalizeCandidate(candidate: CandidateInput): TokenIdentityCandidate {
    return {
        ...candidate,
        score: scoreCandidate(candidate),
    };
}

function isFuzzyCandidate(candidate: TokenIdentityCandidate) {
    return candidate.matchType === 'symbol_fuzzy' || candidate.matchType === 'name_fuzzy';
}

function confidenceForCandidate(candidate: TokenIdentityCandidate): AddressConfidence {
    if (candidate.source === 'binance_alpha' && candidate.token.isVerifiedContract && !isFuzzyCandidate(candidate)) {
        return 'probable';
    }

    if (candidate.source === 'manual' && candidate.matchType === 'exact_address') {
        return 'official';
    }

    if (candidate.source === 'dex_screener' && isFuzzyCandidate(candidate)) {
        return 'unverified';
    }

    if (candidate.source === 'dex_screener') {
        return 'fallback';
    }

    if (candidate.source === 'futures_symbol') {
        return 'unverified';
    }

    return 'unverified';
}

function isCloseCandidate(candidate: TokenIdentityCandidate, winner: TokenIdentityCandidate) {
    const sameSymbol = normalizeAssetTerm(candidate.token.symbol) === normalizeAssetTerm(winner.token.symbol);
    const closeScore = winner.score - candidate.score <= 80;
    return candidate.token.tokenAddress.toLowerCase() !== winner.token.tokenAddress.toLowerCase()
        && sameSymbol
        && closeScore;
}

export class TokenIdentityResolver {
    resolve({
        query,
        scope,
        futuresSymbols = [],
        candidates,
    }: {
        query: string;
        scope: OnchainSearchScope;
        futuresSymbols?: string[];
        candidates: CandidateInput[];
    }): TokenIdentityResolution {
        const queryTerms = tokenizeSearchInput(query);
        const normalizedSymbol = queryTerms[queryTerms.length - 1] ?? normalizeAssetTerm(query);
        const normalizedCandidates = candidates
            .map(normalizeCandidate)
            .sort((a, b) => b.score - a.score);
        const winner = normalizedCandidates[0] ?? null;

        if (!winner) {
            return {
                query,
                normalizedSymbol,
                chain: null,
                address: null,
                confidence: 'blocked',
                source: 'unknown',
                evidence: futuresSymbols.length > 0
                    ? ['币安合约 universe 命中交易标的，但没有可确认链上地址。']
                    : ['没有找到可用链上地址候选。'],
                riskFlags: ['地址无法确认。'],
                candidates: [],
            };
        }

        const closeCandidates = normalizedCandidates.filter((candidate) => isCloseCandidate(candidate, winner));
        const evidence = [...winner.evidence];
        const riskFlags = [...winner.riskFlags];
        let confidence = confidenceForCandidate(winner);

        if (scope === 'contracts' && futuresSymbols.length > 0) {
            evidence.push(`币安合约 universe 命中 ${futuresSymbols.join(', ')}。`);
            riskFlags.push('币安合约 symbol 只能证明交易标的存在，不能证明链上地址。');
        }

        if (closeCandidates.length > 0) {
            riskFlags.push('存在多个候选地址接近，地址不唯一，需人工确认主链和主合约。');
            if (confidence === 'probable' || confidence === 'official') {
                confidence = 'fallback';
            }
        }

        if (isFuzzyCandidate(winner)) {
            confidence = 'unverified';
            riskFlags.push('symbol/name 模糊命中，可能是同名币、镜像或仿盘。');
        }

        return {
            query,
            normalizedSymbol,
            chain: winner.token.chainName,
            address: winner.token.tokenAddress,
            confidence,
            source: winner.source,
            evidence,
            riskFlags: Array.from(new Set(riskFlags)),
            candidates: normalizedCandidates,
        };
    }
}

export function resolveTokenIdentity(input: Parameters<TokenIdentityResolver['resolve']>[0]) {
    return new TokenIdentityResolver().resolve(input);
}
