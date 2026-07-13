import { buildOnchainDataQuality, buildStructureObservation } from './analysis.ts';
import { buildHolderConcentration } from './addressClassifier.ts';
import { applySupplyToHolderConcentration, buildSupplyBreakdown } from './supplyNormalizer.ts';
import {
    chainPriority,
    normalizeAssetTerm,
    tokenizeSearchInput,
} from './identity.ts';
import { fetchBinanceJson } from '../binanceApi.ts';
import { logger } from '../logger.ts';
import { readOnchainEnv } from '../env.ts';
import {
    buildFallbackSourceStatuses,
    errorMessage,
    settleOnchainSource,
    sourceStateOf,
    type SettledOnchainSource,
} from './providerStatus.ts';
import {
    applyEligibilityToHolderConcentration,
    buildTokenIdentityResolution,
    buildTokenEligibility,
    identityFromResolution,
    resolveOnchainMappingStatus,
} from './tokenEligibility.ts';
export {
    applyEligibilityToHolderConcentration,
    buildAddressIdentity,
    buildTokenEligibility,
    resolveOnchainMappingStatus,
} from './tokenEligibility.ts';
import type {
    DexTradeWindow,
    HistoricalHoldersPoint,
    OnchainFallbackReason,
    OnchainSearchScope,
    TokenHolderMetrics,
    TokenResearchPayload,
    TokenSearchResult,
    TopHolderItem,
} from './types';

const SERVER_ENV = readOnchainEnv();
const MORALIS_API_KEY = SERVER_ENV.moralisApiKey;
const MORALIS_EVM_BASE = 'https://deep-index.moralis.io/api/v2.2';
const MORALIS_SOLANA_BASE = 'https://solana-gateway.moralis.io';
const DEX_SCREENER_BASE = 'https://api.dexscreener.com/latest/dex';
const DEFAULT_QUERY = 'PEPE';
const SOLANA_NETWORK = SERVER_ENV.solanaNetwork;
const MIN_HOLDER_COUNT = 100;
const MIN_CANDIDATE_MARKET_CAP = 2_000_000;
const MIN_CANDIDATE_LIQUIDITY = 1;
const NATIVE_CONTRACT_ASSETS = new Set([
    'BTC',
    'ETH',
    'SOL',
    'BNB',
    'XRP',
    'ADA',
    'DOGE',
    'TRX',
    'TON',
    'AVAX',
    'DOT',
    'LTC',
    'BCH',
]);
const STABLE_CONTRACT_ASSETS = new Set([
    'USDT',
    'USDC',
    'FDUSD',
    'TUSD',
    'DAI',
    'USDE',
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

import {
    emptyPriceWindow,
    emptyTradeWindow,
    parseNumber,
    parseOptionalNumber,
    isAddressLikeQuery,
    isSupportedOnchainToken,
    mapHolderDistribution,
    mapAcquisition,
    mapSupplyBucket,
    recordOfValues,
    recordOfRecords,
    normalizeAcquisitionMix,
    filterAndSortSearchResults,
    hasTokenTerm,
    mapHolderChange,
    mapPriceWindow,
    mapTradeWindow,
    moralisChainParam,
    mapDexChain,
    mapSearchResults,
    primaryTokenScore,
    withDerivedMarketStats,
} from './providerAdapters.ts';
export {
    filterAndSortSearchResults,
    normalizeAcquisitionMix,
} from './providerAdapters.ts';

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
        const cexCoin = normalizeAssetTerm(item.cexCoinName || '');
        const symbol = normalizeAssetTerm(item.symbol || '');
        const isOfficialAlphaOnly = Boolean(item.alphaId) && cexCoin.length === 0;

        return Array.from(officialTerms).some((term) => (
            (cexCoin.length > 0 && cexCoin === term)
            || (isOfficialAlphaOnly && symbol.length > 0 && symbol === term)
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
        fdv: null,
        totalLiquidityUsd: item.liquidity == null ? null : parseNumber(item.liquidity),
        securityScore: null,
        totalHolders: item.holders == null ? null : parseNumber(item.holders),
        isVerifiedContract: true,
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

export function buildCandidateTokenResults(
    searchResults: TokenSearchResult[],
    matchedBaseAssets: string[],
    query: string
) {
    const normalizedTerms = new Set(
        (matchedBaseAssets.length > 0 ? matchedBaseAssets : [query]).flatMap((asset) => tokenizeSearchInput(asset))
    );

    return searchResults
        .filter((token) => {
            const symbol = normalizeAssetTerm(token.symbol);
            const name = normalizeAssetTerm(token.name);
            const marketCap = token.marketCap ?? 0;
            const liquidity = token.totalLiquidityUsd ?? 0;
            const holders = token.totalHolders ?? 0;
            const identityMatches = Array.from(normalizedTerms).some((term) => (
                symbol === term
                || name === term
                || symbol.includes(term)
                || name.includes(term)
            ));

            return (
                identityMatches
                && isSupportedOnchainToken(token)
                && marketCap >= MIN_CANDIDATE_MARKET_CAP
                && liquidity >= MIN_CANDIDATE_LIQUIDITY
                && holders >= MIN_HOLDER_COUNT
            );
        })
        .sort((a, b) => {
            const marketCapDiff = (b.marketCap ?? 0) - (a.marketCap ?? 0);
            if (marketCapDiff !== 0) {
                return marketCapDiff;
            }

            const liquidityDiff = (b.totalLiquidityUsd ?? 0) - (a.totalLiquidityUsd ?? 0);
            if (liquidityDiff !== 0) {
                return liquidityDiff;
            }

            const holderDiff = (b.totalHolders ?? 0) - (a.totalHolders ?? 0);
            if (holderDiff !== 0) {
                return holderDiff;
            }

            return chainPriority(b.chainId) - chainPriority(a.chainId);
        });
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

async function hydrateDexDetails(
    token: TokenSearchResult,
): Promise<SettledOnchainSource<TokenSearchResult>> {
    try {
        const chain = token.chainId === 'ethereum'
            ? 'eth'
            : token.chainId;
        const url = `https://api.dexscreener.com/token-pairs/v1/${encodeURIComponent(chain)}/${encodeURIComponent(token.tokenAddress)}`;
        const pairs = await fetchDexScreenerJson<Array<Record<string, unknown>>>(url);

        if (!Array.isArray(pairs) || pairs.length === 0) {
            return { status: 'empty', data: token };
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
            : token.marketCap;
        const fdv = fdvCandidates.length > 0 ? Math.max(...fdvCandidates) : token.fdv ?? null;
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
            status: 'ok',
            data: {
                ...token,
                name: String(dominantBaseToken.name || token.name),
                symbol: String(dominantBaseToken.symbol || token.symbol),
                logo: typeof dominantInfo.imageUrl === 'string' ? dominantInfo.imageUrl : token.logo,
                usdPrice: parseOptionalNumber(dominantPair.priceUsd) ?? token.usdPrice,
                marketCap,
                fdv,
                totalLiquidityUsd,
                turnoverRatio,
                dexTrades: {
                    h1: aggregateTrades('h1'),
                    h6: aggregateTrades('h6'),
                    h24: aggregateTrades('h24'),
                },
                dexPriceStats,
            },
        };
    } catch (error) {
        return { status: 'failed', data: token, error: errorMessage(error) };
    }
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
    const universe = await fetchBinanceContractUniverse();
    const officialUniverse = await fetchBinanceAlphaUniverse().catch(() => []);
    if (isAddressLikeQuery(query)) {
        const directOfficialMatches = matchOfficialAlphaTokenByAddress(officialUniverse, query).map(mapAlphaTokenToSearchResult);
        if (directOfficialMatches.length > 0) {
            return filterAndSortSearchResults(directOfficialMatches, 0);
        }

        return enrichSearchResultsWithHolderCounts(await searchTokens(query));
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
    const enriched = await enrichSearchResultsWithHolderCounts(rawResults);
    return buildCandidateTokenResults(enriched.length > 0 ? enriched : rawResults, matchedAssets, query).slice(0, 5);
}

async function buildAlphaSearchResults(query: string) {
    const universe = await fetchBinanceAlphaUniverse();
    const matched = isAddressLikeQuery(query)
        ? matchOfficialAlphaTokenByAddress(universe, query)
        : matchOfficialAlphaTokens(universe, [query], query);
    const mapped = matched.map(mapAlphaTokenToSearchResult);

    const filtered = filterAndSortSearchResults(mapped);
    return filtered.length > 0 ? filtered : filterAndSortSearchResults(mapped, 0);
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
    overrides?: Partial<Pick<TokenResearchPayload, 'searchResults' | 'selectedToken' | 'notes' | 'sourceStatuses'>>
): TokenResearchPayload {
    const selectedToken = overrides?.selectedToken ?? null;
    const searchResults = overrides?.searchResults ?? (selectedToken ? [selectedToken] : []);
    const identityResolution = buildTokenIdentityResolution({
        token: selectedToken,
        scope,
        query,
        searchResults,
    });
    const identity = identityFromResolution(
        identityResolution,
        selectedToken ? resolveOnchainMappingStatus(scope, selectedToken) : 'unavailable',
        selectedToken
    );
    const dataQuality = buildOnchainDataQuality(null, [], []);
    const rawHolderConcentration = buildHolderConcentration([]);
    const supplyBreakdown = buildSupplyBreakdown({
        token: selectedToken,
        holderConcentration: rawHolderConcentration,
    });
    const supplyAdjustedHolderConcentration = applySupplyToHolderConcentration(rawHolderConcentration, supplyBreakdown);
    const eligibility = buildTokenEligibility({
        token: selectedToken,
        identity,
        mappingStatus: 'unavailable',
        metrics: null,
        dataQuality,
        holderConcentration: supplyAdjustedHolderConcentration,
        supplyBreakdown,
    });
    const holderConcentration = applyEligibilityToHolderConcentration(supplyAdjustedHolderConcentration, eligibility);
    const notes = overrides?.notes ?? [
        reason === 'missing_moralis_api_key'
            ? '当前没有配置 MORALIS_API_KEY，所以链上真实指标还没有启用。'
            : reason === 'no_search_results'
                ? '这次没有检索到匹配的链上主地址，请换一个币种名、符号或合约地址再试。'
                : reason === 'unsupported_chain'
                    ? '候选地址已经找到，但这条链当前不在可用的链上 holder 追踪支持范围内。'
                : reason === 'data_source_unconfirmed'
                    ? '已找到币安合约标的，但无法从可验证来源确认对应链和 token contract address，所以这次不展示链上结构观察。'
                    : reason === 'native_asset_unsupported'
                        ? '该标的是原生币或稳定币合约，不能直接套用 ERC20/BEP20/Solana token holder 逻辑生成链上结构观察。'
                        : reason === 'metrics_unavailable'
                            ? '候选地址已经找到，但持币结构指标暂时拉取失败，所以这次不展示链上结构观察。'
                                : '链上数据源暂时不可用，请稍后重试。'
    ];

    return {
        generatedAt: Date.now(),
        query,
        scope,
        sourceMode: 'fallback',
        mappingStatus: 'unavailable',
        fallbackReason: reason,
        sourceStatuses: overrides?.sourceStatuses ?? buildFallbackSourceStatuses(reason),
        identityResolution,
        identity,
        eligibility,
        searchResults,
        selectedToken,
        metrics: null,
        historical: [],
        topHolders: [],
        holderConcentration,
        supplyBreakdown,
        dataQuality,
        analysis: null,
        notes,
    };
}

export function getFallbackBannerMessage(reason?: OnchainFallbackReason) {
    switch (reason) {
        case 'missing_moralis_api_key':
            return '当前没有生成真实链上结果：尚未配置 MORALIS_API_KEY，所以 holder metrics、Top holders 和筹码分布还没有启用。';
        case 'no_search_results':
            return '当前没有拿到可用链上结果：这次没有检索到匹配的链上标的，请换一个币种名、符号或合约地址再试。';
        case 'unsupported_chain':
            return '当前没有生成链上结构观察：候选地址已经找到，但这条链暂时不支持链上持币结构追踪。';
        case 'data_source_unconfirmed':
            return '数据源待确认：已匹配到币安合约标的，但暂时无法从可验证来源确认对应链和 token contract address，本次不会展示可能误导的筹码分布。';
        case 'native_asset_unsupported':
            return '当前没有生成链上结构观察：该标的是原生币或稳定币合约，不能强行套用 ERC20/BEP20/Solana token holder 地址分布。';
        case 'metrics_unavailable':
            return '当前没有生成链上结构观察：目标币已定位，但持币结构数据暂时拉取失败，请稍后重试。';
        case 'upstream_request_failed':
        default:
            return '当前没有生成链上结构观察：链上数据源暂时不可用或请求失败，请稍后重试，或检查链上数据配置。';
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
        if (scope === 'contracts' && hasTokenTerm(normalizedQuery, NATIVE_CONTRACT_ASSETS)) {
            return fallbackPayload(query, scope, 'native_asset_unsupported');
        }
        if (scope === 'contracts' && hasTokenTerm(normalizedQuery, STABLE_CONTRACT_ASSETS)) {
            return fallbackPayload(query, scope, 'data_source_unconfirmed', {
                notes: [
                    '已识别为稳定币合约标的，当前链上筹码观察不直接复用跨链稳定币合约地址。',
                    '稳定币需要单独确认发行链、合约版本和交易所储备地址后才能生成可靠筹码分布。',
                ],
            });
        }
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
            return fallbackPayload(query, scope, scope === 'contracts' ? 'data_source_unconfirmed' : 'no_search_results', { searchResults });
        }
        const dexSource = await hydrateDexDetails(selectedToken);
        const selectedTokenWithDex = dexSource.data;
        const mappingStatus = resolveOnchainMappingStatus(scope, selectedTokenWithDex);
        const identityResolution = buildTokenIdentityResolution({
            token: selectedTokenWithDex,
            scope,
            query: normalizedQuery,
            searchResults,
        });
        const identity = identityFromResolution(identityResolution, mappingStatus, selectedTokenWithDex);
        if (!isSupportedOnchainToken(selectedTokenWithDex)) {
            return fallbackPayload(query, scope, 'unsupported_chain', {
                searchResults,
                selectedToken: selectedTokenWithDex,
                notes: [
                    `已锁定候选地址 ${selectedTokenWithDex.symbol}（${selectedTokenWithDex.chainName}），但这条链当前不支持链上 holder 指标。`,
                    '目前仅支持 EVM 主流链与 Solana 的持币结构追踪，其余链会先保留检索结果但不输出链上结构观察。',
                ],
            });
        }

        const [metricsSource, historySource, topHoldersSource] = await Promise.all([
            fetchMetrics(selectedTokenWithDex).then(
                (data) => ({ status: 'ok' as const, data }),
                (error: unknown) => {
                logger.error('Failed to fetch onchain holder metrics', error as Error, {
                    query: normalizedQuery,
                    chainId: selectedTokenWithDex.chainId,
                    tokenAddress: selectedTokenWithDex.tokenAddress,
                });
                return { status: 'failed' as const, data: null, error: error instanceof Error ? error.message : String(error) };
            }),
            fetchHistorical(selectedTokenWithDex).then(
                (data) => settleOnchainSource(data),
                (error: unknown) => {
                logger.warn('Failed to fetch onchain holder history', {
                    query: normalizedQuery,
                    chainId: selectedTokenWithDex.chainId,
                    tokenAddress: selectedTokenWithDex.tokenAddress,
                    error: error instanceof Error ? error.message : String(error),
                });
                return settleOnchainSource<HistoricalHoldersPoint[]>([], error);
            }),
            fetchTopHolders(selectedTokenWithDex).then(
                (data) => settleOnchainSource(data),
                (error: unknown) => {
                logger.warn('Failed to fetch onchain top holders', {
                    query: normalizedQuery,
                    chainId: selectedTokenWithDex.chainId,
                    tokenAddress: selectedTokenWithDex.tokenAddress,
                    error: error instanceof Error ? error.message : String(error),
                });
                return settleOnchainSource<TopHolderItem[]>([], error);
            }),
        ]);

        const metricsResult = metricsSource.data;
        const historical = historySource.data;
        const topHolders = topHoldersSource.data;

        if (!metricsResult) {
            return fallbackPayload(query, scope, 'metrics_unavailable', {
                searchResults,
                selectedToken: selectedTokenWithDex,
                notes: [
                    `已锁定主地址 ${selectedTokenWithDex.symbol}（${selectedTokenWithDex.chainName}），但这次没有拿到 holder metrics。`,
                    '页面会保留候选地址与市场快照，不再伪造筹码结构和 Top holders 数据。',
                ],
                sourceStatuses: {
                    dex: sourceStateOf(dexSource),
                    metrics: { status: 'failed', ...('error' in metricsSource && typeof metricsSource.error === 'string' ? { error: metricsSource.error } : {}) },
                    history: {
                        status: historySource.status,
                        ...(historySource.error ? { error: historySource.error } : {}),
                    },
                    topHolders: {
                        status: topHoldersSource.status,
                        ...(topHoldersSource.error ? { error: topHoldersSource.error } : {}),
                    },
                },
            });
        }

        const dataQuality = buildOnchainDataQuality(metricsResult, historical, topHolders);
        const rawHolderConcentration = buildHolderConcentration(topHolders);
        const supplyBreakdown = buildSupplyBreakdown({
            token: selectedTokenWithDex,
            holderConcentration: rawHolderConcentration,
        });
        const supplyAdjustedHolderConcentration = applySupplyToHolderConcentration(rawHolderConcentration, supplyBreakdown);
        const eligibility = buildTokenEligibility({
            token: selectedTokenWithDex,
            identity,
            mappingStatus,
            metrics: metricsResult,
            dataQuality,
            holderConcentration: supplyAdjustedHolderConcentration,
            supplyBreakdown,
        });
        const holderConcentration = applyEligibilityToHolderConcentration(supplyAdjustedHolderConcentration, eligibility);
        const notes: string[] = [
            mappingStatus === 'candidate'
                ? '当前结果来自候选筛选：未拿到官方确认地址，本阶段只展示原始数据，不生成链上结构观察。'
                : scope === 'alpha'
                ? '当前模式聚焦 Binance Alpha 币种，并围绕可识别地址做链上筹码结构观察。'
                : '当前模式聚焦 Binance 合约币种；合约 universe 只能证明交易标的存在，链上地址仍需独立确认。',
            mappingStatus === 'candidate'
                ? `候选硬过滤要求市值不低于 $${MIN_CANDIDATE_MARKET_CAP.toLocaleString('en-US')}、流动性大于 0、持币人数不少于 ${MIN_HOLDER_COUNT}，排序优先级为市值、流动性、持币人数。`
                : '主地址优先使用币安官方可识别地址；若官方地址缺失，则不输出链上结构观察。',
            '搜索与价格快照来自 DEX Screener，筹码与持币结构来自 Moralis holders、historical holders 和 owners。',
            mappingStatus === 'candidate'
                ? '候选结果不是官方确认地址，请结合合约地址、链、成交池和项目公告二次确认。'
                : `候选结果已按持币地址数从高到低排序，并优先过滤掉持币地址少于 ${MIN_HOLDER_COUNT} 的低相关币。`,
        ];
        if (historySource.status === 'failed') {
            notes.push('历史持币数据加载失败，当前仅显示最新快照。');
        }

        return {
            generatedAt: Date.now(),
            query,
            scope,
            sourceMode: 'hybrid',
            mappingStatus,
            sourceStatuses: {
                dex: sourceStateOf(dexSource),
                metrics: {
                    status: metricsSource.status,
                    ...('error' in metricsSource && typeof metricsSource.error === 'string'
                        ? { error: metricsSource.error }
                        : {}),
                },
                history: { status: historySource.status, ...(historySource.error ? { error: historySource.error } : {}) },
                topHolders: { status: topHoldersSource.status, ...(topHoldersSource.error ? { error: topHoldersSource.error } : {}) },
            },
            identityResolution,
            identity,
            eligibility,
            searchResults,
            selectedToken: selectedTokenWithDex,
            metrics: metricsResult,
            historical,
            topHolders,
            holderConcentration,
            supplyBreakdown,
            dataQuality,
            analysis: eligibility.level === 'analysis_allowed'
                ? buildStructureObservation(metricsResult, historical, holderConcentration)
                : null,
            notes,
        };
    } catch {
        return fallbackPayload(query, scope, 'upstream_request_failed');
    }
}
