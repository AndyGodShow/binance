export type OnchainSourceMode = 'hybrid' | 'fallback';
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
    totalLiquidityUsd: number | null;
    securityScore: number | null;
    totalHolders: number | null;
    isVerifiedContract: boolean;
    turnoverRatio: number | null;
    dexTrades: Record<Exclude<DexWindowKey, 'm5'>, DexTradeWindow>;
    dexPriceStats: Record<DexWindowKey, DexPriceWindow>;
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

export interface ChipScoreBreakdownItem {
    id: string;
    label: string;
    score: number;
    value: string;
    rationale: string;
    tone: 'positive' | 'negative' | 'neutral';
}

export interface ChipSummaryCard {
    title: string;
    value: string;
    description: string;
}

export interface ChipAnalysis {
    chipScore: number;
    controlLevel: '高度控筹' | '中度集中' | '相对分散';
    distributionLevel: '头部集中' | '中段扎实' | '长尾分散';
    trendLevel: '持续扩散' | '温和扩散' | '趋于稳定' | '可能派发';
    breakdown: ChipScoreBreakdownItem[];
    summaryCards: ChipSummaryCard[];
    insights: string[];
}

export interface TokenResearchPayload {
    generatedAt: number;
    query: string;
    scope: OnchainSearchScope;
    sourceMode: OnchainSourceMode;
    searchResults: TokenSearchResult[];
    selectedToken: TokenSearchResult | null;
    metrics: TokenHolderMetrics | null;
    historical: HistoricalHoldersPoint[];
    topHolders: TopHolderItem[];
    analysis: ChipAnalysis | null;
    notes: string[];
}
