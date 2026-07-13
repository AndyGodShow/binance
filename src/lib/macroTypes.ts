export interface MacroSourceAsset {
    symbol: string;
    label: string;
    market: string;
    price: number;
    changePercent: number;
    performance?: MacroAssetPerformance;
    dataTimestamp?: string;
    session?: MacroAssetSession;
}

export interface MacroAssetPerformance {
    year?: number;
    month?: number;
    week?: number;
    day?: number;
}

export interface MacroAssetSession {
    state: 'pre' | 'post';
    label: string;
    price: number;
    changePercent: number;
    dataTimestamp?: string;
}

export const BTC_LONG_SHORT_RATIO_PERIOD = '15m';

export interface FearGreedSnapshot {
    value: number;
    valueText?: string;
    timestamp?: string;
    nextUpdateSeconds?: number;
}

export interface BtcSnapshot {
    price: number;
    changePercent: number;
    high24h: number;
    low24h: number;
    fundingRate: number;
    longShortRatio: number;
    dataTimestamp?: string;
    fundingTimestamp?: string;
    nextFundingTimestamp?: string;
    longShortRatioTimestamp?: string;
}

export interface EthBtcSnapshot {
    price: number;
    changePercent: number;
    dataTimestamp?: string;
}

export interface BtcEtfFlowEntry {
    symbol: string;
    netInflowUsdMillion: number;
}

export interface BtcEtfFlowSnapshot {
    date: string;
    totalNetInflowUsdMillion: number;
    btcPrice?: number;
    provider?: string;
    flows: BtcEtfFlowEntry[];
    rolling7dNetInflowUsdMillion: number;
    rolling7dPositiveDays: number;
    rolling7dNegativeDays: number;
}

export interface MacroSourcePayload {
    updatedAt: string;
    assets: Record<string, MacroSourceAsset>;
    usEquities?: Record<string, MacroSourceAsset>;
    hkEquities?: Record<string, MacroSourceAsset>;
    aShareEquities?: Record<string, MacroSourceAsset>;
    fearGreed: FearGreedSnapshot;
    btc: BtcSnapshot;
    ethBtc: EthBtcSnapshot;
    etfFlow?: BtcEtfFlowSnapshot;
}

export interface MacroBoardItem {
    symbol: string;
    displaySymbol: string;
    market: string;
    price: number;
    changePercent: number;
    performance?: MacroAssetPerformance;
    session?: MacroAssetSession;
}

export interface MacroBoardGroup {
    title: string;
    items: MacroBoardItem[];
}

export interface MacroMonitorCard {
    label: string;
    value: number;
    valueText: string;
    hint: string;
    statusLabel: string;
    tone: 'positive' | 'negative' | 'neutral';
    deltaText?: string;
}

export interface MacroSourceStatus {
    key: string;
    label: string;
    provider: string;
    status: 'live' | 'fallback' | 'unavailable';
    detail?: string;
    errorKind?: 'timeout' | 'upstream_error' | 'empty_response' | 'invalid_response' | 'unknown';
    updatedAt?: number;
    dataTimestamp?: string;
    latencyMs?: number;
    freshness?: 'realtime' | 'intraday' | 'daily' | 'stale' | 'unknown';
}

export interface MacroUsEquityGroupSummary {
    title: string;
    averageChangePercent: number;
    advancers: number;
    decliners: number;
    totalCount: number;
}

export interface MacroUsEquitiesDashboard {
    groups: MacroBoardGroup[];
    summary: {
        totalCount: number;
        advancers: number;
        decliners: number;
        averageChangePercent: number;
        strongest?: MacroBoardItem;
        weakest?: MacroBoardItem;
        strongestGroup?: MacroUsEquityGroupSummary;
        weakestGroup?: MacroUsEquityGroupSummary;
    };
    session?: {
        label: string;
        state: 'pre' | 'post';
        activeCount: number;
        dataTimestamp?: string;
    };
}

export type MacroEquityObserverDashboard = MacroUsEquitiesDashboard;

export type MacroFreshnessTarget = 'realtime' | 'intraday' | 'daily';
