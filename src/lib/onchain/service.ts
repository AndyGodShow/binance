import { buildChipAnalysis } from './analysis';
import { fetchBinanceJson } from '@/lib/binanceApi';
import { logger } from '@/lib/logger';
import type {
    ChainFamily,
    DexPriceWindow,
    DexTradeWindow,
    HistoricalHoldersPoint,
    HolderAcquisition,
    HolderDistribution,
    OnchainFallbackReason,
    OnchainSearchScope,
    HolderSupplyBucket,
    TokenHolderMetrics,
    TokenResearchPayload,
    TokenSearchResult,
    TopHolderItem,
} from './types';

const MORALIS_API_KEY = process.env.MORALIS_API_KEY;
const MORALIS_EVM_BASE = 'https://deep-index.moralis.io/api/v2.2';
const MORALIS_SOLANA_BASE = 'https://solana-gateway.moralis.io';
const DEX_SCREENER_BASE = 'https://api.dexscreener.com/latest/dex';
const DEFAULT_QUERY = 'PEPE';
const SOLANA_NETWORK = process.env.SOLANA_NETWORK ?? 'mainnet';
const MIN_HOLDER_COUNT = 100;
const SUPPORTED_EVM_CHAINS = new Set([
    'ethereum',
    'bsc',
    'base',
    'polygon',
    'arbitrum',
    'optimism',
    'avalanche',
    'fantom',
    'cronos',
]);

interface BinanceContractSymbol {
    symbol: string;
    baseAsset: string;
    quoteAsset: string;
    contractType: string;
    status: string;
}

interface BinanceExchangeInfoResponse {
    symbols: BinanceContractSymbol[];
}

export interface BinanceAlphaToken {
    chainId: string;
    chainName: string;
    contractAddress: string;
    name: string;
    symbol: string;
    iconUrl?: string | null;
    price?: string | null;
    marketCap?: string | null;
    liquidity?: string | null;
    holders?: string | null;
    alphaId?: string | null;
    cexCoinName?: string | null;
}

interface BinanceAlphaResponse {
    data?: BinanceAlphaToken[];
}

function moralisHeaders() {
    return {
        'X-API-Key': MORALIS_API_KEY ?? '',
    };
}

async function fetchMoralisJson<T>(url: string): Promise<T> {
    const res = await fetch(url, {
        headers: moralisHeaders(),
        next: { revalidate: 300 },
    } as RequestInit & { next?: { revalidate?: number } });

    if (!res.ok) {
        throw new Error(`Moralis request failed: ${res.status}`);
    }

    return res.json() as Promise<T>;
}

async function fetchDexScreenerJson<T>(url: string): Promise<T> {
    const res = await fetch(url, {
        next: { revalidate: 180 },
    } as RequestInit & { next?: { revalidate?: number } });

    if (!res.ok) {
        throw new Error(`DEX Screener request failed: ${res.status}`);
    }

    return res.json() as Promise<T>;
}

function parseNumber(value: string | number | null | undefined) {
    const num = Number(value ?? 0);
    return Number.isFinite(num) ? num : 0;
}

function parseOptionalNumber(value: unknown) {
    if (value === null || value === undefined || value === '') {
        return null;
    }

    const num = Number(value);
    return Number.isFinite(num) ? num : null;
}

function emptyTradeWindow(): DexTradeWindow {
    return { buys: null, sells: null, total: null };
}

function emptyPriceWindow(): DexPriceWindow {
    return { priceChangePercent: null, volumeUsd: null };
}

function mapTradeWindow(raw: unknown): DexTradeWindow {
    const obj = recordOfValues(raw);
    const buys = parseOptionalNumber(obj.buys);
    const sells = parseOptionalNumber(obj.sells);

    return {
        buys,
        sells,
        total: buys === null && sells === null ? null : (buys ?? 0) + (sells ?? 0),
    };
}

function mapPriceWindow(rawPriceChange: unknown, rawVolume: unknown): DexPriceWindow {
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

function isAddressLikeQuery(query: string) {
    const trimmed = query.trim();
    return /^0x[a-fA-F0-9]{40}$/.test(trimmed) || /^[1-9A-HJ-NP-Za-km-z]{32,64}$/.test(trimmed) || /^T[A-Za-z1-9]{25,}$/.test(trimmed);
}

function isSupportedOnchainToken(token: TokenSearchResult) {
    return token.chainFamily === 'solana' || SUPPORTED_EVM_CHAINS.has(token.chainId);
}

function isSupportedChain(chainId: string, chainFamily: ChainFamily) {
    return chainFamily === 'solana' || SUPPORTED_EVM_CHAINS.has(chainId);
}

function mapHolderDistribution(input: Record<string, string | number | null | undefined>): HolderDistribution {
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

function mapAcquisition(input: Record<string, string | number | null | undefined>): HolderAcquisition {
    return {
        swap: parseNumber(input.swap),
        transfer: parseNumber(input.transfer),
        airdrop: parseNumber(input.airdrop),
    };
}

function mapSupplyBucket(input: Record<string, string | number | null | undefined>): HolderSupplyBucket {
    return {
        supply: parseNumber(input.supply),
        supplyPercent: parseNumber(input.supplyPercent),
    };
}

function recordOfValues(value: unknown): Record<string, string | number | null | undefined> {
    return (value && typeof value === 'object' ? value : {}) as Record<string, string | number | null | undefined>;
}

function recordOfRecords(value: unknown): Record<string, Record<string, string | number | null | undefined>> {
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

function normalizeAssetTerm(value: string) {
    return value.trim().toUpperCase();
}

function stripLeadingMultiplier(value: string) {
    return value.replace(/^\d+/, '');
}

function tokenizeSearchInput(query: string) {
    const normalized = normalizeAssetTerm(query);
    const strippedQuote = normalized.replace(/(USDT|USDC|FDUSD)$/i, '');
    const strippedMultiplier = stripLeadingMultiplier(strippedQuote);
    return Array.from(new Set([normalized, strippedQuote, strippedMultiplier].filter(Boolean))) as string[];
}

function mapHolderChangeWindow(raw: unknown): { change: number; changePercent: number } {
    const obj = recordOfValues(raw);
    return {
        change: parseNumber(obj.change),
        changePercent: parseNumber(obj.changePercent),
    };
}

function mapHolderChange(raw: unknown): TokenHolderMetrics['holderChange'] {
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

function moralisChainParam(chainId: string): string {
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

function mapDexChain(chainId: string) {
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

function chainPriority(chainId: string) {
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

function primaryTokenScore(token: TokenSearchResult, query: string) {
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

function mapSearchResults(raw: Array<Record<string, unknown>>): TokenSearchResult[] {
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
            marketCap: item.marketCap == null
                ? (item.fdv == null ? null : Number(item.fdv))
                : Number(item.marketCap),
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

function withDerivedMarketStats(token: TokenSearchResult): TokenSearchResult {
    const turnoverRatio = token.marketCap && token.marketCap > 0 && token.dexPriceStats.h24.volumeUsd !== null
        ? token.dexPriceStats.h24.volumeUsd / token.marketCap
        : null;

    return {
        ...token,
        turnoverRatio,
    };
}

async function fetchCandidateHolderCount(token: TokenSearchResult): Promise<number | null> {
    try {
        if (token.chainFamily === 'solana') {
            const url = `${MORALIS_SOLANA_BASE}/token/${SOLANA_NETWORK}/holders/${token.tokenAddress}`;
            const json = await fetchMoralisJson<Record<string, unknown>>(url);
            return parseNumber(json.totalHolders as string | number | null | undefined);
        }

        const chain = moralisChainParam(token.chainId);
        const url = `${MORALIS_EVM_BASE}/erc20/${token.tokenAddress}/holders?chain=${encodeURIComponent(chain)}`;
        const json = await fetchMoralisJson<Record<string, unknown>>(url);
        return parseNumber(json.totalHolders as string | number | null | undefined);
    } catch {
        return null;
    }
}

export function resolveSelectedToken(
    searchResults: TokenSearchResult[],
    tokenAddress?: string | null,
    chainId?: string | null,
    query = DEFAULT_QUERY
) {
    if (!tokenAddress || !chainId) {
        return pickPrimaryToken(searchResults, query);
    }

    const normalizedAddress = tokenAddress.toLowerCase();
    const normalizedChainId = chainId.toLowerCase();

    return searchResults.find((token) => (
        token.tokenAddress.toLowerCase() === normalizedAddress
        && token.chainId.toLowerCase() === normalizedChainId
    )) ?? pickPrimaryToken(searchResults, query);
}

async function fetchBinanceContractUniverse() {
    const response = await fetchBinanceJson<BinanceExchangeInfoResponse>('/fapi/v1/exchangeInfo?v=2', {
        revalidate: 3600,
    });

    return response.symbols
        .filter((item) => (
            (item.contractType === 'PERPETUAL' || item.contractType === 'TRADIFI_PERPETUAL')
            && item.status === 'TRADING'
            && (item.quoteAsset === 'USDT' || item.quoteAsset === 'USDC')
        ))
        .map((item) => ({
            symbol: item.symbol,
            baseAsset: item.baseAsset,
        }));
}

async function fetchBinanceAlphaUniverse() {
    const response = await fetch('https://www.binance.com/bapi/defi/v1/public/wallet-direct/buw/wallet/cex/alpha/all/token/list', {
        next: { revalidate: 300 },
    } as RequestInit & { next?: { revalidate?: number } });

    if (!response.ok) {
        throw new Error(`Binance alpha list failed: ${response.status}`);
    }

    const json = await response.json() as BinanceAlphaResponse;
    return json.data ?? [];
}

function mapAlphaChain(chainId: string, chainName: string) {
    if (chainId === '1') {
        return { chainId: 'ethereum', chain: 'ethereum', chainName: 'Ethereum', chainFamily: 'evm' as const };
    }
    if (chainId === '56') {
        return { chainId: 'bsc', chain: 'bsc', chainName: 'BNB Chain', chainFamily: 'evm' as const };
    }
    if (chainId === '8453') {
        return { chainId: 'base', chain: 'base', chainName: 'Base', chainFamily: 'evm' as const };
    }
    if (chainId === '137') {
        return { chainId: 'polygon', chain: 'polygon', chainName: 'Polygon', chainFamily: 'evm' as const };
    }
    if (chainId === '42161') {
        return { chainId: 'arbitrum', chain: 'arbitrum', chainName: 'Arbitrum', chainFamily: 'evm' as const };
    }
    if (chainId === '10') {
        return { chainId: 'optimism', chain: 'optimism', chainName: 'Optimism', chainFamily: 'evm' as const };
    }
    if (chainId === 'CT_501' || chainName.toLowerCase().includes('solana')) {
        return { chainId: 'solana', chain: 'solana', chainName: 'Solana', chainFamily: 'solana' as const };
    }

    return mapDexChain(chainName.toLowerCase());
}

export function matchOfficialAlphaTokens(
    universe: BinanceAlphaToken[],
    matchedBaseAssets: string[],
    query: string
) {
    const officialTerms = new Set(
        [...matchedBaseAssets, query].flatMap((asset) => tokenizeSearchInput(asset))
    );

    return universe.filter((item) => {
        const symbol = normalizeAssetTerm(item.symbol || '');
        const cexCoin = normalizeAssetTerm(item.cexCoinName || '');

        return Array.from(officialTerms).some((term) => (
            symbol === term
            || cexCoin === term
        ));
    }).sort((a, b) => {
        const aMeta = mapAlphaChain(a.chainId, a.chainName);
        const bMeta = mapAlphaChain(b.chainId, b.chainName);
        const cexDiff = Number(normalizeAssetTerm(b.cexCoinName || '') === normalizeAssetTerm(query))
            - Number(normalizeAssetTerm(a.cexCoinName || '') === normalizeAssetTerm(query));
        if (cexDiff !== 0) {
            return cexDiff;
        }

        const symbolDiff = Number(normalizeAssetTerm(b.symbol || '') === normalizeAssetTerm(query))
            - Number(normalizeAssetTerm(a.symbol || '') === normalizeAssetTerm(query));
        if (symbolDiff !== 0) {
            return symbolDiff;
        }

        return chainPriority(bMeta.chainId) - chainPriority(aMeta.chainId);
    });
}

function matchOfficialAlphaTokenByAddress(universe: BinanceAlphaToken[], query: string) {
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) {
        return [];
    }

    return universe.filter((item) => item.contractAddress.toLowerCase() === normalizedQuery);
}

function mapAlphaTokenToSearchResult(item: BinanceAlphaToken): TokenSearchResult {
    const chainMeta = mapAlphaChain(item.chainId, item.chainName);
    return {
        tokenAddress: item.contractAddress,
        chainId: chainMeta.chainId,
        chain: chainMeta.chain,
        chainName: chainMeta.chainName,
        chainFamily: chainMeta.chainFamily,
        name: item.name,
        symbol: item.symbol,
        logo: item.iconUrl ?? null,
        usdPrice: item.price == null ? null : parseNumber(item.price),
        marketCap: item.marketCap == null ? null : parseNumber(item.marketCap),
        totalLiquidityUsd: item.liquidity == null ? null : parseNumber(item.liquidity),
        securityScore: null,
        totalHolders: item.holders == null ? null : parseNumber(item.holders),
        isVerifiedContract: false,
        turnoverRatio: null,
        dexTrades: {
            h1: emptyTradeWindow(),
            h6: emptyTradeWindow(),
            h24: emptyTradeWindow(),
        },
        dexPriceStats: {
            m5: emptyPriceWindow(),
            h1: emptyPriceWindow(),
            h6: emptyPriceWindow(),
            h24: emptyPriceWindow(),
        },
    };
}

async function searchTokens(query: string): Promise<TokenSearchResult[]> {
    const url = `${DEX_SCREENER_BASE}/search/?q=${encodeURIComponent(query)}`;
    const json = await fetchDexScreenerJson<{ pairs?: Array<Record<string, unknown>> }>(url);
    return mapSearchResults(json.pairs ?? []).map(withDerivedMarketStats);
}

async function searchByTerms(terms: string[]) {
    const results = await Promise.all(terms.map((term) => searchTokens(term).catch(() => [])));
    const deduped = new Map<string, TokenSearchResult>();
    results.flat().forEach((token) => {
        deduped.set(`${token.chainId}:${token.tokenAddress.toLowerCase()}`, token);
    });
    return Array.from(deduped.values());
}

async function enrichSearchResultsWithHolderCounts(searchResults: TokenSearchResult[]) {
    const prioritized = [...searchResults]
        .filter(isSupportedOnchainToken)
        .sort((a, b) => {
            const marketCapDiff = (b.marketCap ?? 0) - (a.marketCap ?? 0);
            if (marketCapDiff !== 0) {
                return marketCapDiff;
            }

            return (b.totalLiquidityUsd ?? 0) - (a.totalLiquidityUsd ?? 0);
        })
        .slice(0, 6);

    const enriched = await Promise.all(
        prioritized.map(async (token) => ({
            ...token,
            totalHolders: await fetchCandidateHolderCount(token),
        }))
    );

    const filtered = filterAndSortSearchResults(enriched);
    return filtered.length > 0 ? filtered : filterAndSortSearchResults(enriched, 0);
}

async function hydrateDexDetails(token: TokenSearchResult): Promise<TokenSearchResult> {
    try {
        const chain = token.chainId === 'ethereum'
            ? 'eth'
            : token.chainId;
        const url = `https://api.dexscreener.com/token-pairs/v1/${encodeURIComponent(chain)}/${encodeURIComponent(token.tokenAddress)}`;
        const pairs = await fetchDexScreenerJson<Array<Record<string, unknown>>>(url);

        if (!Array.isArray(pairs) || pairs.length === 0) {
            return token;
        }

        const normalizedAddress = token.tokenAddress.toLowerCase();
        const relevantPairs = pairs.filter((pair) => {
            const baseToken = recordOfValues(pair.baseToken);
            return String(baseToken.address || '').toLowerCase() === normalizedAddress;
        });
        const poolSet = relevantPairs.length > 0 ? relevantPairs : pairs;

        const dominantPair = [...poolSet].sort((a, b) => (
            parseNumber(recordOfValues(a.liquidity).usd) < parseNumber(recordOfValues(b.liquidity).usd) ? 1 : -1
        ))[0];

        const aggregateTrades = (window: 'h1' | 'h6' | 'h24'): DexTradeWindow => {
            const summed = poolSet.reduce<{ buys: number; sells: number }>((acc, pair) => {
                const txns = recordOfRecords(pair.txns);
                const trade = mapTradeWindow(txns[window]);
                return {
                    buys: acc.buys + (trade.buys ?? 0),
                    sells: acc.sells + (trade.sells ?? 0),
                };
            }, { buys: 0, sells: 0 });

            return {
                buys: summed.buys,
                sells: summed.sells,
                total: summed.buys + summed.sells,
            };
        };

        const aggregateVolume = (window: 'm5' | 'h1' | 'h6' | 'h24') => (
            poolSet.reduce((sum, pair) => {
                const volume = recordOfValues(pair.volume);
                return sum + parseNumber(volume[window]);
            }, 0)
        );

        const dominantPriceChange = recordOfValues(dominantPair.priceChange);
        const dominantBaseToken = recordOfValues(dominantPair.baseToken);
        const dominantInfo = recordOfValues(dominantPair.info);
        const totalLiquidityUsd = poolSet.reduce((sum, pair) => {
            const liquidity = recordOfValues(pair.liquidity);
            return sum + parseNumber(liquidity.usd);
        }, 0);
        const marketCapCandidates = poolSet
            .map((pair) => parseOptionalNumber((pair as Record<string, unknown>).marketCap))
            .filter((value): value is number => value !== null && value > 0);
        const fdvCandidates = poolSet
            .map((pair) => parseOptionalNumber((pair as Record<string, unknown>).fdv))
            .filter((value): value is number => value !== null && value > 0);
        const marketCap = marketCapCandidates.length > 0
            ? Math.max(...marketCapCandidates)
            : (fdvCandidates.length > 0 ? Math.max(...fdvCandidates) : token.marketCap);
        const dexPriceStats = {
            m5: mapPriceWindow(dominantPriceChange.m5, aggregateVolume('m5')),
            h1: mapPriceWindow(dominantPriceChange.h1, aggregateVolume('h1')),
            h6: mapPriceWindow(dominantPriceChange.h6, aggregateVolume('h6')),
            h24: mapPriceWindow(dominantPriceChange.h24, aggregateVolume('h24')),
        };
        const turnoverRatio = marketCap && marketCap > 0 && dexPriceStats.h24.volumeUsd !== null
            ? dexPriceStats.h24.volumeUsd / marketCap
            : null;

        return {
            ...token,
            name: String(dominantBaseToken.name || token.name),
            symbol: String(dominantBaseToken.symbol || token.symbol),
            logo: typeof dominantInfo.imageUrl === 'string' ? dominantInfo.imageUrl : token.logo,
            usdPrice: parseOptionalNumber(dominantPair.priceUsd) ?? token.usdPrice,
            marketCap,
            totalLiquidityUsd,
            turnoverRatio,
            dexTrades: {
                h1: aggregateTrades('h1'),
                h6: aggregateTrades('h6'),
                h24: aggregateTrades('h24'),
            },
            dexPriceStats,
        };
    } catch {
        return token;
    }
}

function filterContractCandidates(
    searchResults: TokenSearchResult[],
    matchedBaseAssets: string[],
    query: string
) {
    if (matchedBaseAssets.length === 0) {
        return [...searchResults].sort((a, b) => primaryTokenScore(b, query) - primaryTokenScore(a, query));
    }

    const normalizedTerms = new Set(
        matchedBaseAssets.flatMap((asset) => tokenizeSearchInput(asset))
    );

    const filtered = searchResults.filter((token) => {
        const symbol = normalizeAssetTerm(token.symbol);
        const name = normalizeAssetTerm(token.name);
        return Array.from(normalizedTerms).some((term) => (
            symbol === term
            || symbol.includes(term)
            || name.includes(term)
        ));
    });

    return filtered.sort((a, b) => {
        const scoreDiff = primaryTokenScore(b, query) - primaryTokenScore(a, query);
        if (scoreDiff !== 0) {
            return scoreDiff;
        }

        const chainDiff = chainPriority(b.chainId) - chainPriority(a.chainId);
        if (chainDiff !== 0) {
            return chainDiff;
        }
        const holderDiff = (b.totalHolders ?? -1) - (a.totalHolders ?? -1);
        if (holderDiff !== 0) {
            return holderDiff;
        }
        const marketCapDiff = (b.marketCap ?? 0) - (a.marketCap ?? 0);
        if (marketCapDiff !== 0) {
            return marketCapDiff;
        }
        return (b.totalLiquidityUsd ?? 0) - (a.totalLiquidityUsd ?? 0);
    });
}

export function pickPrimaryToken(searchResults: TokenSearchResult[], query: string) {
    if (searchResults.length === 0) {
        return null;
    }

    return [...searchResults].sort((a, b) => {
        const scoreDiff = primaryTokenScore(b, query) - primaryTokenScore(a, query);
        if (scoreDiff !== 0) {
            return scoreDiff;
        }

        const holderDiff = (b.totalHolders ?? -1) - (a.totalHolders ?? -1);
        if (holderDiff !== 0) {
            return holderDiff;
        }

        const liquidityDiff = (b.totalLiquidityUsd ?? 0) - (a.totalLiquidityUsd ?? 0);
        if (liquidityDiff !== 0) {
            return liquidityDiff;
        }

        return (b.marketCap ?? 0) - (a.marketCap ?? 0);
    })[0] ?? null;
}

async function buildContractSearchResults(query: string) {
    try {
        const universe = await fetchBinanceContractUniverse();
        const officialUniverse = await fetchBinanceAlphaUniverse().catch(() => []);
        if (isAddressLikeQuery(query)) {
            const directOfficialMatches = matchOfficialAlphaTokenByAddress(officialUniverse, query).map(mapAlphaTokenToSearchResult);
            if (directOfficialMatches.length > 0) {
                return filterAndSortSearchResults(directOfficialMatches, 0);
            }
        }

        const terms = tokenizeSearchInput(query);
        const fuzzyMatches = universe.filter((item) => terms.some((term) => normalizeAssetTerm(item.baseAsset).includes(term)));
        const matches = universe.filter((item) => {
            const base = normalizeAssetTerm(item.baseAsset);
            const symbol = normalizeAssetTerm(item.symbol);
            return terms.some((term) => base === term || symbol === term || base.includes(term));
        });

        const matchedAssets: string[] = (matches.length > 0 ? matches : fuzzyMatches.slice(0, 6)).map((item) => item.baseAsset);
        const officialMatches = matchOfficialAlphaTokens(officialUniverse, matchedAssets, query);
        if (officialMatches.length > 0) {
            const officialCandidates = filterAndSortSearchResults(
                officialMatches
                    .map(mapAlphaTokenToSearchResult)
                    .filter(isSupportedOnchainToken),
                0
            );
            if (officialCandidates.length > 0) {
                return officialCandidates;
            }
        }

        const searchTerms: string[] = Array.from(new Set(matchedAssets.flatMap((asset) => tokenizeSearchInput(asset))));

        const rawResults = await searchByTerms(searchTerms.length > 0 ? searchTerms.slice(0, 6) : [query]);
        const prefiltered = filterContractCandidates(rawResults, matchedAssets, query);
        const enrichmentBase = prefiltered.length > 0 ? prefiltered : rawResults;
        const enriched = await enrichSearchResultsWithHolderCounts(enrichmentBase);
        const filtered = filterContractCandidates(enriched, matchedAssets, query);
        return filtered.length > 0 ? filtered : enrichmentBase.slice(0, 10);
    } catch {
        return enrichSearchResultsWithHolderCounts(await searchTokens(query));
    }
}

async function buildAlphaSearchResults(query: string) {
    try {
        const universe = await fetchBinanceAlphaUniverse();
        const matched = isAddressLikeQuery(query)
            ? matchOfficialAlphaTokenByAddress(universe, query)
            : matchOfficialAlphaTokens(universe, [query], query);
        const mapped = matched.map(mapAlphaTokenToSearchResult);

        const filtered = filterAndSortSearchResults(mapped);
        return filtered.length > 0 ? filtered : filterAndSortSearchResults(mapped, 0);
    } catch {
        return enrichSearchResultsWithHolderCounts(await searchTokens(query));
    }
}

async function fetchMetrics(token: TokenSearchResult): Promise<TokenHolderMetrics> {
    if (token.chainFamily === 'solana') {
        const url = `${MORALIS_SOLANA_BASE}/token/${SOLANA_NETWORK}/holders/${token.tokenAddress}`;
        const json = await fetchMoralisJson<Record<string, unknown>>(url);
        const holderSupply = recordOfRecords(json.holderSupply);

        return {
            totalHolders: parseNumber(json.totalHolders as string | number | null | undefined),
            holderSupply: {
                top10: mapSupplyBucket(holderSupply.top10),
                top25: mapSupplyBucket(holderSupply.top25),
                top50: mapSupplyBucket(holderSupply.top50),
                top100: mapSupplyBucket(holderSupply.top100),
                top250: mapSupplyBucket(holderSupply.top250),
                top500: mapSupplyBucket(holderSupply.top500),
            },
            holderChange: mapHolderChange(json.holderChange),
            holdersByAcquisition: normalizeAcquisitionMix(mapAcquisition(recordOfValues(json.holdersByAcquisition))),
            holderDistribution: mapHolderDistribution(recordOfValues(json.holderDistribution)),
        };
    }

    const chain = moralisChainParam(token.chainId);
    const url = `${MORALIS_EVM_BASE}/erc20/${token.tokenAddress}/holders?chain=${encodeURIComponent(chain)}`;
    const json = await fetchMoralisJson<Record<string, unknown>>(url);
    const holderSupply = recordOfRecords(json.holderSupply);

    return {
        totalHolders: parseNumber(json.totalHolders as string | number | null | undefined),
        holderSupply: {
            top10: mapSupplyBucket(holderSupply.top10),
            top25: mapSupplyBucket(holderSupply.top25),
            top50: mapSupplyBucket(holderSupply.top50),
            top100: mapSupplyBucket(holderSupply.top100),
            top250: mapSupplyBucket(holderSupply.top250),
            top500: mapSupplyBucket(holderSupply.top500),
        },
        holderChange: mapHolderChange(json.holderChange),
        holdersByAcquisition: normalizeAcquisitionMix(mapAcquisition(recordOfValues(json.holdersByAcquisition))),
        holderDistribution: mapHolderDistribution(recordOfValues(json.holderDistribution)),
    };
}

async function fetchHistorical(token: TokenSearchResult): Promise<HistoricalHoldersPoint[]> {
    const fromDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const toDate = new Date().toISOString();

    if (token.chainFamily === 'solana') {
        const url = `${MORALIS_SOLANA_BASE}/token/${SOLANA_NETWORK}/holders/${token.tokenAddress}/historical?fromDate=${encodeURIComponent(fromDate)}&toDate=${encodeURIComponent(toDate)}&timeFrame=1d&limit=30`;
        const json = await fetchMoralisJson<{ result?: Array<Record<string, unknown>> }>(url);
        return (json.result ?? []).map(mapHistoricalPoint).filter((point) => point.totalHolders > 0);
    }

    const chain = moralisChainParam(token.chainId);
    const url = `${MORALIS_EVM_BASE}/erc20/${token.tokenAddress}/holders/historical?chain=${encodeURIComponent(chain)}&fromDate=${encodeURIComponent(fromDate)}&toDate=${encodeURIComponent(toDate)}&timeFrame=1d&limit=30`;
    const json = await fetchMoralisJson<{ result?: Array<Record<string, unknown>> }>(url);
    return (json.result ?? []).map(mapHistoricalPoint).filter((point) => point.totalHolders > 0);
}

function mapHistoricalPoint(item: Record<string, unknown>): HistoricalHoldersPoint {
    return {
        timestamp: String(item.timestamp || ''),
        totalHolders: parseNumber(item.totalHolders as string | number | null | undefined),
        netHolderChange: parseNumber(item.netHolderChange as string | number | null | undefined),
        holderPercentChange: parseNumber(item.holderPercentChange as string | number | null | undefined),
        newHoldersByAcquisition: mapAcquisition(recordOfValues(item.newHoldersByAcquisition)),
        holdersIn: mapHolderDistribution(recordOfValues(item.holdersIn)),
        holdersOut: mapHolderDistribution(recordOfValues(item.holdersOut)),
    };
}

async function fetchTopHolders(token: TokenSearchResult): Promise<TopHolderItem[]> {
    if (token.chainFamily === 'solana') {
        const url = `${MORALIS_SOLANA_BASE}/token/${SOLANA_NETWORK}/${token.tokenAddress}/top-holders?limit=10`;
        const json = await fetchMoralisJson<{ result?: Array<Record<string, unknown>> }>(url);
        return (json.result ?? []).slice(0, 10).map((item) => ({
            address: String(item.ownerAddress || item.address || ''),
            label: null,
            entity: null,
            percentage: parseNumber((item.percentageRelativeToTotalSupply ?? item.percentage_relative_to_total_supply) as string | number | null | undefined),
            balance: item.balanceFormatted == null ? null : String(item.balanceFormatted),
            usdValue: item.usdValue == null ? null : String(item.usdValue),
            isContract: Boolean(item.isContract),
        }));
    }

    const chain = moralisChainParam(token.chainId);
    const url = `${MORALIS_EVM_BASE}/erc20/${token.tokenAddress}/owners?chain=${encodeURIComponent(chain)}&limit=10`;
    const json = await fetchMoralisJson<{ result?: Array<Record<string, unknown>> }>(url);
    return (json.result ?? []).slice(0, 10).map((item) => ({
        address: String(item.owner_address || ''),
        label: item.owner_address_label == null ? null : String(item.owner_address_label),
        entity: item.entity == null ? null : String(item.entity),
        percentage: parseNumber(item.percentage_relative_to_total_supply as string | number | null | undefined),
        balance: item.balance_formatted == null ? null : String(item.balance_formatted),
        usdValue: item.usd_value == null ? null : String(item.usd_value),
        isContract: Boolean(item.is_contract),
    }));
}

function fallbackPayload(
    query: string,
    scope: OnchainSearchScope,
    reason: OnchainFallbackReason,
    overrides?: Partial<Pick<TokenResearchPayload, 'searchResults' | 'selectedToken' | 'notes'>>
): TokenResearchPayload {
    const selectedToken = overrides?.selectedToken ?? null;
    const searchResults = overrides?.searchResults ?? (selectedToken ? [selectedToken] : []);
    const notes = overrides?.notes ?? [
        reason === 'missing_moralis_api_key'
            ? '当前没有配置 MORALIS_API_KEY，所以链上真实指标还没有启用。'
            : reason === 'no_search_results'
                ? '这次没有检索到匹配的链上主地址，请换一个币种名、符号或合约地址再试。'
                : reason === 'unsupported_chain'
                    ? '主地址已经找到，但这条链当前不在可用的链上控筹支持范围内。'
                    : reason === 'metrics_unavailable'
                        ? '主地址已经找到，但持币结构指标暂时拉取失败，所以这次不展示控筹结论。'
                        : '链上数据源暂时不可用，请稍后重试。'
    ];

    return {
        generatedAt: Date.now(),
        query,
        scope,
        sourceMode: 'fallback',
        fallbackReason: reason,
        searchResults,
        selectedToken,
        metrics: null,
        historical: [],
        topHolders: [],
        analysis: null,
        notes,
    };
}

export function getFallbackBannerMessage(reason?: OnchainFallbackReason) {
    switch (reason) {
        case 'missing_moralis_api_key':
            return '当前显示的是回退样本数据：尚未配置 MORALIS_API_KEY，所以链上真实数据还没有启用。';
        case 'no_search_results':
            return '当前没有拿到可用链上结果：这次没有检索到匹配的链上标的，请换一个币种名、符号或合约地址再试。';
        case 'unsupported_chain':
            return '当前没有生成控筹结果：主地址已经找到，但这条链暂时不支持链上持币结构追踪。';
        case 'metrics_unavailable':
            return '当前没有生成控筹结果：目标币已定位，但持币结构数据暂时拉取失败，请稍后重试。';
        case 'upstream_request_failed':
        default:
            return '当前没有生成控筹结果：链上数据源暂时不可用或请求失败，请稍后重试，或检查链上数据配置。';
    }
}

export async function buildTokenResearchPayload(
    query = DEFAULT_QUERY,
    selection?: { tokenAddress?: string | null; chainId?: string | null },
    scope: OnchainSearchScope = 'contracts'
): Promise<TokenResearchPayload> {
    if (!MORALIS_API_KEY) {
        return fallbackPayload(query, scope, 'missing_moralis_api_key');
    }

    try {
        const normalizedQuery = query || DEFAULT_QUERY;
        const searchResults = scope === 'alpha'
            ? await buildAlphaSearchResults(normalizedQuery)
            : await buildContractSearchResults(normalizedQuery);
        const selectedToken = resolveSelectedToken(
            searchResults,
            selection?.tokenAddress,
            selection?.chainId,
            normalizedQuery
        );
        if (!selectedToken) {
            return fallbackPayload(query, scope, 'no_search_results', { searchResults });
        }
        const selectedTokenWithDex = await hydrateDexDetails(selectedToken);
        if (!isSupportedOnchainToken(selectedTokenWithDex)) {
            return fallbackPayload(query, scope, 'unsupported_chain', {
                searchResults,
                selectedToken: selectedTokenWithDex,
                notes: [
                    `已锁定主地址 ${selectedTokenWithDex.symbol}（${selectedTokenWithDex.chainName}），但这条链当前不支持链上控筹指标。`,
                    '目前仅支持 EVM 主流链与 Solana 的持币结构追踪，其余链会先保留检索结果但不输出控筹结论。',
                ],
            });
        }

        const [metricsResult, historicalResult, topHolders] = await Promise.all([
            fetchMetrics(selectedTokenWithDex).catch((error) => {
                logger.error('Failed to fetch onchain holder metrics', error as Error, {
                    query: normalizedQuery,
                    chainId: selectedTokenWithDex.chainId,
                    tokenAddress: selectedTokenWithDex.tokenAddress,
                });
                return null;
            }),
            fetchHistorical(selectedTokenWithDex).catch((error) => {
                logger.warn('Failed to fetch onchain holder history', {
                    query: normalizedQuery,
                    chainId: selectedTokenWithDex.chainId,
                    tokenAddress: selectedTokenWithDex.tokenAddress,
                    error: error instanceof Error ? error.message : String(error),
                });
                return null;
            }),
            fetchTopHolders(selectedTokenWithDex).catch((error) => {
                logger.warn('Failed to fetch onchain top holders', {
                    query: normalizedQuery,
                    chainId: selectedTokenWithDex.chainId,
                    tokenAddress: selectedTokenWithDex.tokenAddress,
                    error: error instanceof Error ? error.message : String(error),
                });
                return [];
            }),
        ]);

        if (!metricsResult) {
            return fallbackPayload(query, scope, 'metrics_unavailable', {
                searchResults,
                selectedToken: selectedTokenWithDex,
                notes: [
                    `已锁定主地址 ${selectedTokenWithDex.symbol}（${selectedTokenWithDex.chainName}），但这次没有拿到 holder metrics。`,
                    '页面会保留主地址与市场快照，不再伪造控筹、持仓和 Top holders 数据。',
                ],
            });
        }

        const historical = historicalResult ?? [];
        const notes: string[] = [
            scope === 'alpha'
                ? '当前模式聚焦 Binance Alpha 币种，并优先围绕官方可识别的主地址做单地址追踪。'
                : '当前模式聚焦 Binance 合约币种，会先锁定一个主地址，再围绕该地址追踪控筹和持币结构。',
            '主地址优先使用币安官方可识别地址；若官方地址缺失，则退回流动性、持币人数与链优先级综合判定。',
            '搜索与价格快照来自 DEX Screener，筹码与持币结构来自 Moralis holders、historical holders 和 owners。',
            `候选结果已按持币地址数从高到低排序，并优先过滤掉持币地址少于 ${MIN_HOLDER_COUNT} 的低相关币。`,
        ];
        if (!historicalResult) {
            notes.push('历史持币数据加载失败，当前仅显示最新快照。');
        }

        return {
            generatedAt: Date.now(),
            query,
            scope,
            sourceMode: 'hybrid',
            searchResults,
            selectedToken: selectedTokenWithDex,
            metrics: metricsResult,
            historical,
            topHolders,
            analysis: buildChipAnalysis(metricsResult, historical),
            notes,
        };
    } catch {
        return fallbackPayload(query, scope, 'upstream_request_failed');
    }
}
