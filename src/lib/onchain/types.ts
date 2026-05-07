export type OnchainSourceMode = 'hybrid' | 'fallback';
export type OnchainMappingStatus = 'confirmed' | 'candidate' | 'unavailable';
export type AddressConfidence = 'official' | 'probable' | 'fallback' | 'unverified' | 'blocked';
export type AnalysisEligibilityLevel = 'analysis_allowed' | 'raw_only' | 'blocked';
export type AnalysisEligibilityCategory = 'A' | 'B' | 'C';
export type TokenIdentitySource = 'binance_alpha' | 'dex_screener' | 'futures_symbol' | 'manual' | 'unknown';
export type OnchainFallbackReason =
    | 'missing_moralis_api_key'
    | 'no_search_results'
    | 'unsupported_chain'
    | 'data_source_unconfirmed'
    | 'native_asset_unsupported'
    | 'metrics_unavailable'
    | 'upstream_request_failed';
export type ChainFamily = 'evm' | 'solana';
export type OnchainSearchScope = 'contracts' | 'alpha';
export type DexWindowKey = 'm5' | 'h1' | 'h6' | 'h24';

export interface DexTradeWindow {
    buys: number | null;
    sells: number | null;
    total: number | null;
}

export interface DexPriceWindow {
    priceChangePercent: number | null;
    volumeUsd: number | null;
}

export interface TokenSearchResult {
    tokenAddress: string;
    chainId: string;
    chain: string;
    chainName: string;
    chainFamily: ChainFamily;
    name: string;
    symbol: string;
    logo: string | null;
    usdPrice: number | null;
    marketCap: number | null;
    fdv?: number | null;
    totalLiquidityUsd: number | null;
    securityScore: number | null;
    totalHolders: number | null;
    isVerifiedContract: boolean;
    turnoverRatio: number | null;
    dexTrades: Record<Exclude<DexWindowKey, 'm5'>, DexTradeWindow>;
    dexPriceStats: Record<DexWindowKey, DexPriceWindow>;
}

export interface TokenIdentityCandidate {
    token: TokenSearchResult;
    source: TokenIdentitySource;
    matchType: 'exact_symbol' | 'exact_address' | 'futures_symbol' | 'symbol_fuzzy' | 'name_fuzzy' | 'unknown';
    score: number;
    evidence: string[];
    riskFlags: string[];
}

export interface HolderSupplyBucket {
    supply: number;
    supplyPercent: number;
}

export interface HolderChangeWindow {
    change: number;
    changePercent: number;
}

export interface HolderDistribution {
    whales: number;
    sharks: number;
    dolphins: number;
    fish: number;
    octopus: number;
    crabs: number;
    shrimps: number;
}

export interface HolderAcquisition {
    swap: number;
    transfer: number;
    airdrop: number;
}

export interface TokenHolderMetrics {
    totalHolders: number;
    holderSupply: {
        top10: HolderSupplyBucket;
        top25: HolderSupplyBucket;
        top50: HolderSupplyBucket;
        top100: HolderSupplyBucket;
        top250: HolderSupplyBucket;
        top500: HolderSupplyBucket;
    };
    holderChange: {
        '5min': HolderChangeWindow;
        '1h': HolderChangeWindow;
        '6h': HolderChangeWindow;
        '24h': HolderChangeWindow;
        '3d': HolderChangeWindow;
        '7d': HolderChangeWindow;
        '30d': HolderChangeWindow;
    };
    holdersByAcquisition: HolderAcquisition;
    holderDistribution: HolderDistribution;
}

export interface HistoricalHoldersPoint {
    timestamp: string;
    totalHolders: number;
    netHolderChange: number;
    holderPercentChange: number;
    newHoldersByAcquisition: HolderAcquisition;
    holdersIn: HolderDistribution;
    holdersOut: HolderDistribution;
}

export interface TopHolderItem {
    address: string;
    label: string | null;
    entity: string | null;
    percentage: number;
    balance: string | null;
    usdValue: string | null;
    isContract: boolean;
}

export type HolderAddressClass =
    | 'user_wallet'
    | 'lp_pool'
    | 'burn'
    | 'cex'
    | 'treasury'
    | 'vesting'
    | 'staking'
    | 'bridge'
    | 'router'
    | 'contract'
    | 'market_maker'
    | 'unknown';

export interface ClassifiedHolder {
    address: string;
    balance?: string | null;
    percentage: number | null;
    label?: string | null;
    entity?: string | null;
    isContract?: boolean | null;
    class: HolderAddressClass;
    confidence: 'high' | 'medium' | 'low';
    reasons: string[];
}

export interface HolderConcentrationAnalysis {
    rawTop1: number | null;
    rawTop5: number | null;
    rawTop10: number | null;
    floatTop1: number | null;
    floatTop5: number | null;
    floatTop10: number | null;
    excludedSharePercent: number;
    unknownSharePercent: number;
    classifiedHolders: ClassifiedHolder[];
    excludedTopHolders: ClassifiedHolder[];
    unknownTopHolders: ClassifiedHolder[];
    warnings: string[];
}

export interface SupplyBreakdown {
    totalSupply: number | null;
    circulatingSupply: number | null;
    burnedSupply: number | null;
    lockedOrInfrastructureSupply: number | null;
    cexSupply: number | null;
    unknownTopHolderSupply: number | null;
    estimatedFloatSupply: number | null;
    confidence: 'high' | 'medium' | 'low';
    warnings: string[];
    evidence: string[];
}

export interface StructureSummaryCard {
    title: string;
    value: string;
    description: string;
}

export interface OnchainDataQuality {
    confidence: '高' | '中' | '低';
    summary: string;
    topHoldersCount: number;
    historicalDays: number;
    topHolderCoveragePercent: number | null;
    flaggedTopHolderSharePercent: number;
    warnings: string[];
}

export interface AddressIdentity {
    symbol: string;
    chain: string;
    address: string | null;
    confidence: AddressConfidence;
    source: TokenIdentitySource;
    evidence: string[];
    riskFlags: string[];
}

export interface TokenIdentityResolution {
    query: string;
    normalizedSymbol: string;
    chain: string | null;
    address: string | null;
    confidence: AddressConfidence;
    source: TokenIdentitySource;
    evidence: string[];
    riskFlags: string[];
    candidates: TokenIdentityCandidate[];
}

export interface AnalysisEligibility {
    level: AnalysisEligibilityLevel;
    category: AnalysisEligibilityCategory;
    reasons: string[];
    requiredManualChecks: string[];
}

export interface StructureObservation {
    concentrationLevel: '原始地址高度集中' | '原始地址中度集中' | '原始地址相对分散';
    distributionLevel: '头部集中' | '中段扎实' | '长尾分散';
    trendLevel: '地址数量扩张' | '地址数量回落' | '地址数量稳定';
    summaryCards: StructureSummaryCard[];
    insights: string[];
}

export interface TokenResearchPayload {
    generatedAt: number;
    query: string;
    scope: OnchainSearchScope;
    sourceMode: OnchainSourceMode;
    mappingStatus: OnchainMappingStatus;
    fallbackReason?: OnchainFallbackReason;
    identityResolution: TokenIdentityResolution;
    identity: AddressIdentity;
    eligibility: AnalysisEligibility;
    searchResults: TokenSearchResult[];
    selectedToken: TokenSearchResult | null;
    metrics: TokenHolderMetrics | null;
    historical: HistoricalHoldersPoint[];
    topHolders: TopHolderItem[];
    holderConcentration: HolderConcentrationAnalysis;
    supplyBreakdown: SupplyBreakdown;
    dataQuality: OnchainDataQuality;
    analysis: StructureObservation | null;
    notes: string[];
}
