export interface KlineData {
    openTime: number;          // 开盘时间
    open: string;              // 开盘价
    high: string;              // 最高价
    low: string;               // 最低价
    close: string;             // 收盘价
    volume: string;            // 成交量
    closeTime: number;         // 收盘时间
    quoteVolume: string;       // 成交额
    trades: number;            // 成交笔数
    takerBuyVolume: string;    // 主动买入成交量
    takerBuyQuoteVolume: string; // 主动买入成交额
    openInterest?: string;     // 持仓量 (Real)
    openInterestValue?: string; // 持仓金额 (Real)
    fundingRate?: string;      // 资金费率 (Real)
    openInterestSource?: 'exact' | 'forward-fill';
    fundingRateSource?: 'exact' | 'forward-fill';
}

export type BinanceKlineRow = [
    number,
    string,
    string,
    string,
    string,
    string,
    number,
    string,
    number,
    string,
    string,
    ...unknown[]
];

export interface LocalOpenInterestPoint {
    timestamp: number;
    openInterest: string;
    openInterestValue?: string;
}

export interface ApiOpenInterestPoint {
    timestamp: number;
    sumOpenInterest: string;
    sumOpenInterestValue?: string;
}

export type OpenInterestPoint = LocalOpenInterestPoint | ApiOpenInterestPoint;

export interface FundingRatePoint {
    fundingTime: number;
    fundingRate: string;
}

export interface NormalizedOpenInterestPoint {
    timestamp: number;
    openInterest: string;
    openInterestValue?: string;
}

export interface OpenInterestDiagnostics {
    source: 'local+api' | 'api' | 'local' | 'coinalyze' | 'none';
    localPoints: number;
    apiPoints: number;
    coinalyzePoints: number;
    mergedPoints: number;
    requestedStartTime: number;
    requestedEndTime: number;
    earliestPointTime?: number;
    latestPointTime?: number;
}

export interface AuxiliaryMergeStats {
    exactMatches: number;
    forwardFilledMatches: number;
    missingMatches: number;
}

export interface FundingDiagnostics extends AuxiliaryMergeStats {
    points: number;
}

export interface KlineArchiveDiagnostics {
    source: 'api' | 'local' | 'local+api';
    usedLocalArchive: boolean;
    fullyCoveredByLocalArchive: boolean;
    archiveReadiness: 'ready' | 'exploratory-only' | 'not-ready' | 'unavailable';
    localBars: number;
    apiBars: number;
}

export interface OpenInterestMergeResult {
    entries: NormalizedOpenInterestPoint[];
    diagnostics: OpenInterestDiagnostics;
}

export interface FundingMergeResult {
    entries: FundingRatePoint[];
    diagnostics: FundingDiagnostics;
}

export interface EmptyAuxiliaryDiagnostics {
    openInterest: OpenInterestDiagnostics;
    fundingRate: FundingDiagnostics;
}

export const OI_MAX_LIMIT = 500;
export const OI_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

export function buildEmptyAuxiliaryDiagnostics(startTs: number, endTs: number): EmptyAuxiliaryDiagnostics {
    return {
        openInterest: {
            source: 'none',
            localPoints: 0,
            apiPoints: 0,
            coinalyzePoints: 0,
            mergedPoints: 0,
            requestedStartTime: startTs,
            requestedEndTime: endTs,
        },
        fundingRate: {
            points: 0,
            exactMatches: 0,
            forwardFilledMatches: 0,
            missingMatches: 0,
        },
    };
}

export function buildKlineArchiveDiagnostics(input?: Partial<KlineArchiveDiagnostics>): KlineArchiveDiagnostics {
    return {
        source: input?.source ?? 'api',
        usedLocalArchive: input?.usedLocalArchive ?? false,
        fullyCoveredByLocalArchive: input?.fullyCoveredByLocalArchive ?? false,
        archiveReadiness: input?.archiveReadiness ?? 'unavailable',
        localBars: input?.localBars ?? 0,
        apiBars: input?.apiBars ?? 0,
    };
}

export function isObjectRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
}

export function isBinanceKlineRow(value: unknown): value is BinanceKlineRow {
    return Array.isArray(value) &&
        value.length >= 11 &&
        typeof value[0] === 'number' &&
        typeof value[1] === 'string' &&
        typeof value[2] === 'string' &&
        typeof value[3] === 'string' &&
        typeof value[4] === 'string' &&
        typeof value[5] === 'string' &&
        typeof value[6] === 'number' &&
        typeof value[7] === 'string' &&
        typeof value[8] === 'number' &&
        typeof value[9] === 'string' &&
        typeof value[10] === 'string';
}

export function isLocalOpenInterestPoint(value: unknown): value is LocalOpenInterestPoint {
    return isObjectRecord(value) &&
        typeof value.timestamp === 'number' &&
        typeof value.openInterest === 'string';
}

export function isApiOpenInterestPoint(value: unknown): value is ApiOpenInterestPoint {
    return isObjectRecord(value) &&
        typeof value.timestamp === 'number' &&
        typeof value.sumOpenInterest === 'string';
}

export function isFundingRatePoint(value: unknown): value is FundingRatePoint {
    return isObjectRecord(value) &&
        typeof value.fundingTime === 'number' &&
        typeof value.fundingRate === 'string';
}

export function normalizeOpenInterestPoint(point: OpenInterestPoint): NormalizedOpenInterestPoint {
    if ('openInterest' in point) {
        return {
            timestamp: point.timestamp,
            openInterest: point.openInterest,
            openInterestValue: point.openInterestValue
        };
    }

    return {
        timestamp: point.timestamp,
        openInterest: point.sumOpenInterest,
        openInterestValue: point.sumOpenInterestValue
    };
}

export function getOpenInterestPeriodMs(period: string): number | null {
    const periodMs: Record<string, number> = {
        '5m': 5 * 60 * 1000,
        '15m': 15 * 60 * 1000,
        '30m': 30 * 60 * 1000,
        '1h': 60 * 60 * 1000,
        '2h': 2 * 60 * 60 * 1000,
        '4h': 4 * 60 * 60 * 1000,
        '6h': 6 * 60 * 60 * 1000,
        '12h': 12 * 60 * 60 * 1000,
        '1d': 24 * 60 * 60 * 1000,
    };

    return periodMs[period] ?? null;
}

export function mergeNormalizedOpenInterestData(
    ...datasets: NormalizedOpenInterestPoint[][]
): NormalizedOpenInterestPoint[] {
    const merged = new Map<number, NormalizedOpenInterestPoint>();

    datasets.forEach((dataset) => {
        dataset.forEach((point) => {
            merged.set(point.timestamp, point);
        });
    });

    return Array.from(merged.values()).sort((a, b) => a.timestamp - b.timestamp);
}

export function isTimestampExactMatch(pointTimestamp: number, targetTimestamp: number, periodMs: number | null): boolean {
    if (!Number.isFinite(pointTimestamp) || !Number.isFinite(targetTimestamp)) {
        return false;
    }

    if (!periodMs || periodMs <= 0) {
        return pointTimestamp === targetTimestamp;
    }

    return Math.abs(targetTimestamp - pointTimestamp) <= Math.min(60_000, Math.floor(periodMs / 3));
}

export function mergeFundingData(localFunding: unknown[], apiFunding: unknown[]): FundingMergeResult {
    const normalizedFundingData = [
        ...apiFunding.filter(isFundingRatePoint),
        ...localFunding.filter(isFundingRatePoint),
    ]
        .map((point) => ({
            fundingTime: point.fundingTime,
            fundingRate: point.fundingRate,
        }))
        .sort((a, b) => a.fundingTime - b.fundingTime);

    const dedupedFundingMap = new Map<number, FundingRatePoint>();
    normalizedFundingData.forEach((point) => {
        dedupedFundingMap.set(point.fundingTime, point);
    });

    return {
        entries: Array.from(dedupedFundingMap.values()).sort((a, b) => a.fundingTime - b.fundingTime),
        diagnostics: {
            points: dedupedFundingMap.size,
            exactMatches: 0,
            forwardFilledMatches: 0,
            missingMatches: 0,
        },
    };
}

export function mergeOpenInterestData(params: {
    startTs: number;
    endTs: number;
    localOi: unknown[];
    apiOi: unknown[];
    coinalyzeOi: NormalizedOpenInterestPoint[];
}): OpenInterestMergeResult {
    const normalizedLocalOiData = params.localOi
        .filter(isLocalOpenInterestPoint)
        .map(normalizeOpenInterestPoint)
        .sort((a, b) => a.timestamp - b.timestamp);

    const normalizedApiOiData = params.apiOi
        .filter(isApiOpenInterestPoint)
        .map(normalizeOpenInterestPoint)
        .sort((a, b) => a.timestamp - b.timestamp);

    const normalizedOiData = mergeNormalizedOpenInterestData(
        params.coinalyzeOi,
        normalizedApiOiData,
        normalizedLocalOiData
    );

    return {
        entries: normalizedOiData,
        diagnostics: {
            source:
                normalizedLocalOiData.length > 0 && normalizedApiOiData.length > 0 ? 'local+api'
                    : normalizedLocalOiData.length > 0 ? 'local'
                        : normalizedApiOiData.length > 0 ? 'api'
                            : params.coinalyzeOi.length > 0 ? 'coinalyze'
                                : 'none',
            localPoints: normalizedLocalOiData.length,
            apiPoints: normalizedApiOiData.length,
            coinalyzePoints: params.coinalyzeOi.length,
            mergedPoints: normalizedOiData.length,
            requestedStartTime: params.startTs,
            requestedEndTime: params.endTs,
            earliestPointTime: normalizedOiData[0]?.timestamp,
            latestPointTime: normalizedOiData[normalizedOiData.length - 1]?.timestamp,
        },
    };
}
