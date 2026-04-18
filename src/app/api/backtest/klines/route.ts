import { NextRequest, NextResponse } from 'next/server';
import { dataCollector } from '@/lib/services/dataCollector';
import { fetchBinanceJson } from '@/lib/binanceApi';
import { fetchBinanceKlines } from '@/lib/binanceKlineFetcher';
import { fetchCoinalyzeOpenInterestHistory } from '@/lib/coinalyze';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';

// K线数据接口
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

type BinanceKlineRow = [
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

interface LocalOpenInterestPoint {
    timestamp: number;
    openInterest: string;
    openInterestValue?: string;
}

interface ApiOpenInterestPoint {
    timestamp: number;
    sumOpenInterest: string;
    sumOpenInterestValue?: string;
}

type OpenInterestPoint = LocalOpenInterestPoint | ApiOpenInterestPoint;

interface FundingRatePoint {
    fundingTime: number;
    fundingRate: string;
}

interface NormalizedOpenInterestPoint {
    timestamp: number;
    openInterest: string;
    openInterestValue?: string;
}

interface OpenInterestDiagnostics {
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

interface AuxiliaryMergeStats {
    exactMatches: number;
    forwardFilledMatches: number;
    missingMatches: number;
}

interface FundingDiagnostics extends AuxiliaryMergeStats {
    points: number;
}

interface OpenInterestMergeResult {
    entries: NormalizedOpenInterestPoint[];
    diagnostics: OpenInterestDiagnostics;
}

interface FundingMergeResult {
    entries: FundingRatePoint[];
    diagnostics: FundingDiagnostics;
}

interface EmptyAuxiliaryDiagnostics {
    openInterest: OpenInterestDiagnostics;
    fundingRate: FundingDiagnostics;
}

const OI_MAX_LIMIT = 500;
const OI_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

function buildEmptyAuxiliaryDiagnostics(startTs: number, endTs: number): EmptyAuxiliaryDiagnostics {
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

function isObjectRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
}

function isBinanceKlineRow(value: unknown): value is BinanceKlineRow {
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

function isLocalOpenInterestPoint(value: unknown): value is LocalOpenInterestPoint {
    return isObjectRecord(value) &&
        typeof value.timestamp === 'number' &&
        typeof value.openInterest === 'string';
}

function isApiOpenInterestPoint(value: unknown): value is ApiOpenInterestPoint {
    return isObjectRecord(value) &&
        typeof value.timestamp === 'number' &&
        typeof value.sumOpenInterest === 'string';
}

function isFundingRatePoint(value: unknown): value is FundingRatePoint {
    return isObjectRecord(value) &&
        typeof value.fundingTime === 'number' &&
        typeof value.fundingRate === 'string';
}

function normalizeOpenInterestPoint(point: OpenInterestPoint): NormalizedOpenInterestPoint {
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

function getOpenInterestPeriodMs(period: string): number | null {
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

function mergeNormalizedOpenInterestData(
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

function isTimestampExactMatch(pointTimestamp: number, targetTimestamp: number, periodMs: number | null): boolean {
    if (!Number.isFinite(pointTimestamp) || !Number.isFinite(targetTimestamp)) {
        return false;
    }

    if (!periodMs || periodMs <= 0) {
        return pointTimestamp === targetTimestamp;
    }

    return Math.abs(targetTimestamp - pointTimestamp) <= Math.min(60_000, Math.floor(periodMs / 3));
}

function mergeFundingData(localFunding: unknown[], apiFunding: unknown[]): FundingMergeResult {
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

function mergeOpenInterestData(params: {
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

/**
 * 获取币安历史K线数据
 * 
 * 支持的时间周期：
 * - 1m, 3m, 5m, 15m, 30m (分钟)
 * - 1h, 2h, 4h, 6h, 8h, 12h (小时)
 * - 1d, 3d (天)
 * - 1w (周)
 * - 1M (月)
 * 
 * 查询参数：
 * - symbol: 交易对，如 BTCUSDT
 * - interval: 时间周期，如 1h
 * - startTime: 开始时间戳(毫秒)，可选
 * - endTime: 结束时间戳(毫秒)，可选
 * - limit: 数据条数，默认500，最大1500
 */
export async function GET(req: NextRequest) {
    const { searchParams } = new URL(req.url);

    const symbol = searchParams.get('symbol');
    const interval = searchParams.get('interval') || '1h';
    const startTime = searchParams.get('startTime');
    const endTime = searchParams.get('endTime');
    const limit = searchParams.get('limit') || '500';
    const includeAuxiliary = searchParams.get('includeAuxiliary') !== 'false';

    // 参数验证
    if (!symbol) {
        return NextResponse.json(
            { error: '缺少参数: symbol' },
            { status: 400 }
        );
    }

    try {
        // 构建请求URL
        const klineParams = new URLSearchParams({
            symbol: symbol.toUpperCase(),
            interval,
            limit,
        });

        if (startTime) klineParams.append('startTime', startTime);
        if (endTime) klineParams.append('endTime', endTime);

        // 1. 发起 K 线请求 (始终从 API 获取最新的 K 线，因为 K 线 API 限制少且快)
        const parsedLimit = Number.parseInt(limit, 10);
        const parsedStartTime = startTime ? Number.parseInt(startTime, 10) : undefined;
        const parsedEndTime = endTime ? Number.parseInt(endTime, 10) : undefined;

        const klinePromise = fetchBinanceKlines(`/fapi/v1/klines?${klineParams.toString()}`, {
            interval,
            startTime: parsedStartTime,
            endTime: parsedEndTime,
            limit: Number.isFinite(parsedLimit) ? parsedLimit : 500,
        }).then(data => {
            if (!Array.isArray(data)) throw new Error('KLine API returned invalid data');
            return data;
        });

        const klineData = await klinePromise;

        const klines: KlineData[] = klineData
            .filter(isBinanceKlineRow)
            .map((k) => ({
                openTime: k[0],
                open: k[1],
                high: k[2],
                low: k[3],
                close: k[4],
                volume: k[5],
                closeTime: k[6],
                quoteVolume: k[7],
                trades: k[8],
                takerBuyVolume: k[9],
                takerBuyQuoteVolume: k[10],
            }));

        if (!includeAuxiliary) {
            const diagnostics = buildEmptyAuxiliaryDiagnostics(
                startTime ? parseInt(startTime, 10) : 0,
                endTime ? parseInt(endTime, 10) : Date.now()
            );

            return NextResponse.json({
                symbol,
                interval,
                count: klines.length,
                data: klines,
                diagnostics,
            });
        }

        // 2. 获取持仓量数据 (优先本地，失败则降级到 API)
        const startTs = startTime ? parseInt(startTime) : Date.now() - 30 * 24 * 60 * 60 * 1000;
        const endTs = endTime ? parseInt(endTime) : Date.now();
        try {
            // 尝试从本地仓库读取 Metrics
            const localOiPromise = dataCollector.getFormattedData(symbol!, 'metrics', startTs, endTs)
                .catch(err => { console.warn('Local OI fetch failed:', err); return []; });

            // API 降级方案 (仅最近30天)
            const supportedOIIntervals = ['5m', '15m', '30m', '1h', '2h', '4h', '6h', '12h', '1d'];
            let oiPeriod = interval;
            if (!supportedOIIntervals.includes(interval)) {
                if (['1m', '3m'].includes(interval)) oiPeriod = '5m';
                else oiPeriod = '';
            }
            const lookbackStartTime = (() => {
                const periodMs = oiPeriod ? getOpenInterestPeriodMs(oiPeriod) : null;
                if (!periodMs) {
                    return startTs;
                }

                // 多向前拉两个周期，避免区间起点附近没有 <= closeTime 的 OI 点而误判为缺失。
                return Math.max(0, startTs - (periodMs * 2));
            })();

            const apiOiPromise = oiPeriod
                ? fetchOpenInterestHistory(symbol!, oiPeriod, String(lookbackStartTime), endTime || undefined).catch(() => [])
                : Promise.resolve([]);

            // 3. 获取资金费率数据 (优先本地，失败则降级到 API)
            const localFundingPromise = dataCollector.getFormattedData(symbol!, 'fundingRate', startTs, endTs)
                .catch(err => { console.warn('Local Funding fetch failed:', err); return []; });

            const apiFundingPromise = startTime
                ? fetchFundingRate(symbol!, startTime, endTime || undefined).catch(() => [])
                : Promise.resolve([]);

            const [localOi, apiOi, localFunding, apiFunding] = await Promise.all([
                localOiPromise,
                apiOiPromise,
                localFundingPromise,
                apiFundingPromise
            ]);

            // 数据合并策略: 优先使用 Local，如果是空的或者覆盖不全，尝试用 API 补全
            // 简单处理：如果 Local 有数据，使用 Local；否则使用 API。
            // 更高级处理可以去重合并，这里暂且优先 Local。
            const fundingMerge = mergeFundingData(localFunding, apiFunding);

            let normalizedCoinalyzeOiData: NormalizedOpenInterestPoint[] = [];
            const oiPeriodMs = oiPeriod ? getOpenInterestPeriodMs(oiPeriod) : null;
            const earliestKnownOiCandidates = [
                localOi.filter(isLocalOpenInterestPoint)[0]?.timestamp,
                apiOi.filter(isApiOpenInterestPoint)[0]?.timestamp,
            ].filter((value): value is number => Number.isFinite(value));
            const earliestKnownOiTimestamp = earliestKnownOiCandidates.length > 0
                ? Math.min(...earliestKnownOiCandidates)
                : Number.POSITIVE_INFINITY;

            if (
                startTime &&
                oiPeriod &&
                oiPeriodMs &&
                startTs + oiPeriodMs < earliestKnownOiTimestamp
            ) {
                normalizedCoinalyzeOiData = await fetchCoinalyzeOpenInterestHistory(
                    symbol!,
                    oiPeriod,
                    startTs,
                    endTs
                );
            }

            const openInterestMerge = mergeOpenInterestData({
                startTs,
                endTs,
                localOi,
                apiOi,
                coinalyzeOi: normalizedCoinalyzeOiData,
            });
            const normalizedOiData = openInterestMerge.entries;
            const oiDiagnostics = openInterestMerge.diagnostics;
            const normalizedFundingData = fundingMerge.entries;

            // 合并 OI 和 Funding Rate
            // 用顺序对齐代替逐根过滤，既避免 O(n²) 扫描，也能显式区分精确命中和前向填充。
            const fallbackOiPeriodMs = getOpenInterestPeriodMs(interval);
            const maxOiLagMs = (oiPeriodMs || fallbackOiPeriodMs || (60 * 60 * 1000)) * 2;
            let fundingIndex = 0;
            let oiIndex = 0;

            klines.forEach((kline) => {
                while (
                    fundingIndex + 1 < normalizedFundingData.length &&
                    normalizedFundingData[fundingIndex + 1].fundingTime <= kline.closeTime
                ) {
                    fundingIndex += 1;
                }
                const fundingPoint = normalizedFundingData[fundingIndex];
                if (fundingPoint && fundingPoint.fundingTime <= kline.closeTime) {
                    kline.fundingRate = fundingPoint.fundingRate;
                    const isExact = fundingPoint.fundingTime >= kline.openTime && fundingPoint.fundingTime <= kline.closeTime;
                    kline.fundingRateSource = isExact ? 'exact' : 'forward-fill';
                    if (isExact) {
                        fundingMerge.diagnostics.exactMatches += 1;
                    } else {
                        fundingMerge.diagnostics.forwardFilledMatches += 1;
                    }
                } else {
                    fundingMerge.diagnostics.missingMatches += 1;
                }

                while (
                    oiIndex + 1 < normalizedOiData.length &&
                    normalizedOiData[oiIndex + 1].timestamp <= kline.closeTime
                ) {
                    oiIndex += 1;
                }
                const matchingOI = normalizedOiData[oiIndex];
                if (matchingOI && kline.closeTime - matchingOI.timestamp <= maxOiLagMs) {
                    kline.openInterest = matchingOI.openInterest;
                    kline.openInterestValue = matchingOI.openInterestValue;
                    const isExact = isTimestampExactMatch(matchingOI.timestamp, kline.openTime, oiPeriodMs || fallbackOiPeriodMs);
                    kline.openInterestSource = isExact ? 'exact' : 'forward-fill';
                }
            });

            return NextResponse.json({
                symbol,
                interval,
                count: klines.length,
                data: klines,
                diagnostics: {
                    openInterest: oiDiagnostics,
                    fundingRate: fundingMerge.diagnostics,
                },
            });
        } catch (auxiliaryError) {
            logger.warn('Backtest auxiliary data merge failed, returning core klines only', {
                symbol,
                interval,
                error: auxiliaryError instanceof Error ? auxiliaryError.message : String(auxiliaryError),
            });

            return NextResponse.json({
                symbol,
                interval,
                count: klines.length,
                data: klines,
                diagnostics: buildEmptyAuxiliaryDiagnostics(startTs, endTs),
            });
        }

    } catch (error) {
        console.error('获取K线数据失败:', error);
        return NextResponse.json(
            { error: '获取历史数据失败' },
            { status: 500 }
        );
    }
}

// 辅助函数: 获取持仓量历史
async function fetchOpenInterest(symbol: string, period: string, startTime?: string, endTime?: string, limit: string = '500') {
    const params = new URLSearchParams({
        symbol: symbol.toUpperCase(),
        period,
        limit,
    });
    if (startTime) params.append('startTime', startTime);
    if (endTime) params.append('endTime', endTime);

    const data = await fetchBinanceJson<unknown>(`/futures/data/openInterestHist?${params.toString()}`, { revalidate: 60 });
    if (!Array.isArray(data)) throw new Error('OI API returned invalid data');
    return data;
}

async function fetchOpenInterestHistory(symbol: string, period: string, startTime: string, endTime?: string) {
    const periodMs = getOpenInterestPeriodMs(period);
    if (!periodMs) {
        return [];
    }

    const requestedStart = parseInt(startTime, 10);
    const requestedEnd = endTime ? parseInt(endTime, 10) : Date.now();
    const retentionStart = Date.now() - OI_RETENTION_MS;
    const effectiveStart = Math.max(requestedStart, retentionStart);

    if (!Number.isFinite(requestedStart) || !Number.isFinite(requestedEnd) || effectiveStart > requestedEnd) {
        return [];
    }

    const points: ApiOpenInterestPoint[] = [];
    let cursorEnd: number | null = requestedEnd;

    while (true) {
        const chunk: unknown = await fetchOpenInterest(
            symbol,
            period,
            undefined,
            cursorEnd ? String(cursorEnd) : undefined,
            String(OI_MAX_LIMIT)
        );

        const normalizedChunk: ApiOpenInterestPoint[] = Array.isArray(chunk)
            ? chunk.filter(isApiOpenInterestPoint)
            : [];
        if (normalizedChunk.length === 0) {
            break;
        }

        const sortedChunk: ApiOpenInterestPoint[] = [...normalizedChunk].sort((a, b) => a.timestamp - b.timestamp);
        points.push(...sortedChunk.filter((point: ApiOpenInterestPoint) => point.timestamp >= effectiveStart && point.timestamp <= requestedEnd));
        const earliestTimestamp: number = sortedChunk[0].timestamp;
        const latestTimestamp: number = sortedChunk[sortedChunk.length - 1].timestamp;

        if (
            !Number.isFinite(earliestTimestamp) ||
            !Number.isFinite(latestTimestamp) ||
            earliestTimestamp <= effectiveStart
        ) {
            break;
        }

        if (cursorEnd !== null && latestTimestamp >= cursorEnd) {
            break;
        }

        cursorEnd = earliestTimestamp - 1;
    }

    const deduped = new Map<number, ApiOpenInterestPoint>();
    points.forEach((point) => {
        deduped.set(point.timestamp, point);
    });

    return Array.from(deduped.values()).sort((a, b) => a.timestamp - b.timestamp);
}

// 辅助函数: 获取资金费率历史
async function fetchFundingRate(symbol: string, startTime: string, endTime?: string, limit: string = '1000') {
    const params = new URLSearchParams({
        symbol: symbol.toUpperCase(),
        limit,
        startTime
    });
    if (endTime) params.append('endTime', endTime);

    const data = await fetchBinanceJson<unknown>(`/fapi/v1/fundingRate?${params.toString()}`, { revalidate: 60 });
    if (!Array.isArray(data)) throw new Error('Funding API returned invalid data');
    return data;
}
