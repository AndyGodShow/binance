import { chainPriority, normalizeAssetTerm, tokenizeSearchInput } from './identity.ts';
import type {
    ChainFamily,
    DexPriceWindow,
    DexTradeWindow,
    HolderAcquisition,
    HolderDistribution,
    HolderSupplyBucket,
    TokenHolderMetrics,
    TokenSearchResult,
} from './types';

const MIN_HOLDER_COUNT = 100;
const SUPPORTED_EVM_CHAINS = new Set([
    'ethereum', 'bsc', 'base', 'polygon', 'arbitrum', 'optimism', 'avalanche', 'fantom', 'cronos',
]);

export function parseNumber(value: string | number | null | undefined) {
    const num = Number(value ?? 0);
    return Number.isFinite(num) ? num : 0;
}

export function parseOptionalNumber(value: unknown) {
    if (value === null || value === undefined || value === '') {
        return null;
    }

    const num = Number(value);
    return Number.isFinite(num) ? num : null;
}

export function emptyTradeWindow(): DexTradeWindow {
    return { buys: null, sells: null, total: null };
}

export function emptyPriceWindow(): DexPriceWindow {
    return { priceChangePercent: null, volumeUsd: null };
}

export function mapTradeWindow(raw: unknown): DexTradeWindow {
    const obj = recordOfValues(raw);
    const buys = parseOptionalNumber(obj.buys);
    const sells = parseOptionalNumber(obj.sells);

    return {
        buys,
        sells,
        total: buys === null && sells === null ? null : (buys ?? 0) + (sells ?? 0),
    };
}

export function mapPriceWindow(rawPriceChange: unknown, rawVolume: unknown): DexPriceWindow {
    return {
        priceChangePercent: parseOptionalNumber(rawPriceChange),
        volumeUsd: parseOptionalNumber(rawVolume),
    };
}

function toFamily(chainId: string, chainName: string): ChainFamily {
    if (chainName.toLowerCase().includes('solana') || chainId.startsWith('solana') || chainId === 'mainnet') {
        return 'solana';
    }
    return 'evm';
}

export function isAddressLikeQuery(query: string) {
    const trimmed = query.trim();
    return /^0x[a-fA-F0-9]{40}$/.test(trimmed) || /^[1-9A-HJ-NP-Za-km-z]{32,64}$/.test(trimmed) || /^T[A-Za-z1-9]{25,}$/.test(trimmed);
}

export function isSupportedOnchainToken(token: TokenSearchResult) {
    return token.chainFamily === 'solana' || SUPPORTED_EVM_CHAINS.has(token.chainId);
}

function isSupportedChain(chainId: string, chainFamily: ChainFamily) {
    return chainFamily === 'solana' || SUPPORTED_EVM_CHAINS.has(chainId);
}

export function mapHolderDistribution(input: Record<string, string | number | null | undefined>): HolderDistribution {
    return {
        whales: parseNumber(input.whales),
        sharks: parseNumber(input.sharks),
        dolphins: parseNumber(input.dolphins),
        fish: parseNumber(input.fish),
        octopus: parseNumber(input.octopus),
        crabs: parseNumber(input.crabs ?? input.crab),
        shrimps: parseNumber(input.shrimps),
    };
}

export function mapAcquisition(input: Record<string, string | number | null | undefined>): HolderAcquisition {
    return {
        swap: parseNumber(input.swap),
        transfer: parseNumber(input.transfer),
        airdrop: parseNumber(input.airdrop),
    };
}

export function mapSupplyBucket(input: Record<string, string | number | null | undefined>): HolderSupplyBucket {
    return {
        supply: parseNumber(input.supply),
        supplyPercent: parseNumber(input.supplyPercent),
    };
}

export function recordOfValues(value: unknown): Record<string, string | number | null | undefined> {
    return (value && typeof value === 'object' ? value : {}) as Record<string, string | number | null | undefined>;
}

export function recordOfRecords(value: unknown): Record<string, Record<string, string | number | null | undefined>> {
    return (value && typeof value === 'object' ? value : {}) as Record<string, Record<string, string | number | null | undefined>>;
}

export function normalizeAcquisitionMix(input: HolderAcquisition): HolderAcquisition {
    const total = input.swap + input.transfer + input.airdrop;
    if (total <= 0) {
        return input;
    }

    return {
        swap: (input.swap / total) * 100,
        transfer: (input.transfer / total) * 100,
        airdrop: (input.airdrop / total) * 100,
    };
}

export function filterAndSortSearchResults(
    searchResults: TokenSearchResult[],
    minHolderCount = MIN_HOLDER_COUNT
) {
    return searchResults
        .filter((token) => token.totalHolders === null || token.totalHolders >= minHolderCount)
        .sort((a, b) => {
            const aHolders = a.totalHolders;
            const bHolders = b.totalHolders;

            if (aHolders !== null && bHolders !== null && aHolders !== bHolders) {
                return bHolders - aHolders;
            }

            if (aHolders === null && bHolders !== null) {
                return 1;
            }

            if (aHolders !== null && bHolders === null) {
                return -1;
            }

            const marketCapDiff = (b.marketCap ?? 0) - (a.marketCap ?? 0);
            if (marketCapDiff !== 0) {
                return marketCapDiff;
            }

            return (b.totalLiquidityUsd ?? 0) - (a.totalLiquidityUsd ?? 0);
        });
}

export function hasTokenTerm(query: string, assetSet: Set<string>) {
    return tokenizeSearchInput(query).some((term) => assetSet.has(term));
}

function mapHolderChangeWindow(raw: unknown): { change: number; changePercent: number } {
    const obj = recordOfValues(raw);
    return {
        change: parseNumber(obj.change),
        changePercent: parseNumber(obj.changePercent),
    };
}

export function mapHolderChange(raw: unknown): TokenHolderMetrics['holderChange'] {
    const obj = recordOfRecords(raw);
    return {
        '5min': mapHolderChangeWindow(obj['5min']),
        '1h': mapHolderChangeWindow(obj['1h']),
        '6h': mapHolderChangeWindow(obj['6h']),
        '24h': mapHolderChangeWindow(obj['24h']),
        '3d': mapHolderChangeWindow(obj['3d']),
        '7d': mapHolderChangeWindow(obj['7d']),
        '30d': mapHolderChangeWindow(obj['30d']),
    };
}

export function moralisChainParam(chainId: string): string {
    switch (chainId) {
        case 'ethereum': return 'eth';
        case 'polygon': return 'polygon';
        case 'bsc': return 'bsc';
        case 'arbitrum': return 'arbitrum';
        case 'optimism': return 'optimism';
        case 'base': return 'base';
        default: return chainId;
    }
}

export function mapDexChain(chainId: string) {
    const normalized = chainId.toLowerCase();

    switch (normalized) {
        case 'eth':
        case 'ethereum':
            return { chainId: 'ethereum', chain: 'ethereum', chainName: 'Ethereum', chainFamily: 'evm' as const };
        case 'bsc':
            return { chainId: 'bsc', chain: 'bsc', chainName: 'BNB Chain', chainFamily: 'evm' as const };
        case 'base':
            return { chainId: 'base', chain: 'base', chainName: 'Base', chainFamily: 'evm' as const };
        case 'solana':
            return { chainId: 'solana', chain: 'solana', chainName: 'Solana', chainFamily: 'solana' as const };
        case 'polygon':
            return { chainId: 'polygon', chain: 'polygon', chainName: 'Polygon', chainFamily: 'evm' as const };
        case 'arbitrum':
            return { chainId: 'arbitrum', chain: 'arbitrum', chainName: 'Arbitrum', chainFamily: 'evm' as const };
        case 'optimism':
            return { chainId: 'optimism', chain: 'optimism', chainName: 'Optimism', chainFamily: 'evm' as const };
        default:
            return {
                chainId: normalized,
                chain: normalized,
                chainName: normalized.charAt(0).toUpperCase() + normalized.slice(1),
                chainFamily: toFamily(normalized, normalized),
            };
    }
}

export function primaryTokenScore(token: TokenSearchResult, query: string) {
    const queryTerms = tokenizeSearchInput(query);
    const symbol = normalizeAssetTerm(token.symbol);
    const name = normalizeAssetTerm(token.name);
    let score = 0;

    if (queryTerms.some((term) => symbol === term)) {
        score += 200;
    } else if (queryTerms.some((term) => symbol.includes(term))) {
        score += 120;
    }

    if (queryTerms.some((term) => name === term)) {
        score += 120;
    } else if (queryTerms.some((term) => name.includes(term))) {
        score += 60;
    }

    if (token.chainFamily === 'evm') {
        score += 20;
    }

    score += chainPriority(token.chainId) * 10;
    score += Math.min(80, Math.log10((token.totalHolders ?? 0) + 1) * 20);
    score += Math.min(80, Math.log10((token.totalLiquidityUsd ?? 0) + 1) * 10);
    score += Math.min(60, Math.log10((token.marketCap ?? 0) + 1) * 8);

    return score;
}

export function mapSearchResults(raw: Array<Record<string, unknown>>): TokenSearchResult[] {
    const unique = new Map<string, TokenSearchResult>();

    raw.forEach((item) => {
        const chainMeta = mapDexChain(String(item.chainId || ''));
        const baseToken = recordOfValues(item.baseToken);
        const tokenAddress = String(baseToken.address || '');
        const key = `${chainMeta.chainId}:${tokenAddress}`;

        if (!tokenAddress || unique.has(key) || !isSupportedChain(chainMeta.chainId, chainMeta.chainFamily)) {
            return;
        }

        unique.set(key, {
            tokenAddress,
            chainId: chainMeta.chainId,
            chain: chainMeta.chain,
            chainName: chainMeta.chainName,
            chainFamily: chainMeta.chainFamily,
            name: String(baseToken.name || ''),
            symbol: String(baseToken.symbol || ''),
            logo: typeof item.info === 'object' && item.info && typeof (item.info as Record<string, unknown>).imageUrl === 'string'
                ? String((item.info as Record<string, unknown>).imageUrl)
                : null,
            usdPrice: item.priceUsd == null ? null : Number(item.priceUsd),
            marketCap: item.marketCap == null ? null : Number(item.marketCap),
            fdv: item.fdv == null ? null : Number(item.fdv),
            totalLiquidityUsd: typeof item.liquidity === 'object' && item.liquidity
                ? Number((item.liquidity as Record<string, unknown>).usd ?? 0)
                : null,
            securityScore: null,
            totalHolders: null,
            isVerifiedContract: false,
            turnoverRatio: null,
            dexTrades: {
                h1: mapTradeWindow(typeof item.txns === 'object' && item.txns ? (item.txns as Record<string, unknown>).h1 : null),
                h6: mapTradeWindow(typeof item.txns === 'object' && item.txns ? (item.txns as Record<string, unknown>).h6 : null),
                h24: mapTradeWindow(typeof item.txns === 'object' && item.txns ? (item.txns as Record<string, unknown>).h24 : null),
            },
            dexPriceStats: {
                m5: mapPriceWindow(
                    typeof item.priceChange === 'object' && item.priceChange ? (item.priceChange as Record<string, unknown>).m5 : null,
                    typeof item.volume === 'object' && item.volume ? (item.volume as Record<string, unknown>).m5 : null
                ),
                h1: mapPriceWindow(
                    typeof item.priceChange === 'object' && item.priceChange ? (item.priceChange as Record<string, unknown>).h1 : null,
                    typeof item.volume === 'object' && item.volume ? (item.volume as Record<string, unknown>).h1 : null
                ),
                h6: mapPriceWindow(
                    typeof item.priceChange === 'object' && item.priceChange ? (item.priceChange as Record<string, unknown>).h6 : null,
                    typeof item.volume === 'object' && item.volume ? (item.volume as Record<string, unknown>).h6 : null
                ),
                h24: mapPriceWindow(
                    typeof item.priceChange === 'object' && item.priceChange ? (item.priceChange as Record<string, unknown>).h24 : null,
                    typeof item.volume === 'object' && item.volume ? (item.volume as Record<string, unknown>).h24 : null
                ),
            },
        });
    });

    return Array.from(unique.values())
        .sort((a, b) => {
            const marketCapDiff = (b.marketCap ?? 0) - (a.marketCap ?? 0);
            if (marketCapDiff !== 0) {
                return marketCapDiff;
            }
            return (b.totalLiquidityUsd ?? 0) - (a.totalLiquidityUsd ?? 0);
        })
        .slice(0, 10);
}

export function withDerivedMarketStats(token: TokenSearchResult): TokenSearchResult {
    const turnoverRatio = token.marketCap && token.marketCap > 0 && token.dexPriceStats.h24.volumeUsd !== null
        ? token.dexPriceStats.h24.volumeUsd / token.marketCap
        : null;

    return {
        ...token,
        turnoverRatio,
    };
}
