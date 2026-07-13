import { NextRequest, NextResponse } from 'next/server';
import { dataCollector } from '@/lib/services/dataCollector';
import { getLocalKlinesInRange, mergeKlineDatasets } from '@/lib/services/klineArchive';
import { fetchBinanceJson } from '@/lib/binanceApi';
import { fetchBinanceKlines } from '@/lib/binanceKlineFetcher';
import { fetchCoinalyzeOpenInterestHistory } from '@/lib/coinalyze';
import { logger } from '@/lib/logger';
import { invalidRequestBody, validateBacktestKlinesParams } from '@/lib/apiRequestValidation';

export const dynamic = 'force-dynamic';

function buildRouteErrorResponse(error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    const upstreamRateLimited = /http (418|429)\b/i.test(message);
    const upstreamUnavailable = /all binance json endpoints failed/i.test(message);
    const details = upstreamRateLimited || upstreamUnavailable
        ? 'Upstream K-line source is temporarily unavailable'
        : 'K-line request failed';

    return NextResponse.json(
        {
            error: upstreamRateLimited || upstreamUnavailable
                ? '上游 K 线源暂时限流，请稍后重试'
                : '获取历史数据失败',
            details,
            retryable: upstreamRateLimited || upstreamUnavailable,
        },
        { status: upstreamRateLimited || upstreamUnavailable ? 503 : 500 }
    );
}

// K线数据接口
export type { KlineData } from '@/lib/backtestKlineMerge';
import {
    KlineData,
    ApiOpenInterestPoint,
    NormalizedOpenInterestPoint,
    OI_MAX_LIMIT,
    OI_RETENTION_MS,
    buildEmptyAuxiliaryDiagnostics,
    buildKlineArchiveDiagnostics,
    isBinanceKlineRow,
    isLocalOpenInterestPoint,
    isApiOpenInterestPoint,
    getOpenInterestPeriodMs,
    isTimestampExactMatch,
    mergeFundingData,
    mergeOpenInterestData,
} from '@/lib/backtestKlineMerge';



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

    const validated = validateBacktestKlinesParams(searchParams);
    if (!validated.ok) {
        return NextResponse.json(invalidRequestBody(validated.details), { status: 400 });
    }

    try {
        const {
            symbol: normalizedSymbol,
            interval,
            startTime: parsedStartTime,
            endTime: parsedEndTime,
            limit: normalizedLimit,
            includeAuxiliary,
        } = validated.value;

        const localRange = Number.isFinite(parsedStartTime) && Number.isFinite(parsedEndTime)
            ? getLocalKlinesInRange({
                symbol: normalizedSymbol,
                interval,
                startTime: parsedStartTime!,
                endTime: parsedEndTime!,
                limit: normalizedLimit,
            })
            : {
                klines: [] as KlineData[],
                audit: null,
                fullyCovered: false,
            };
        let klineArchiveDiagnostics = buildKlineArchiveDiagnostics({
            archiveReadiness: localRange.audit?.readiness ?? 'unavailable',
            localBars: localRange.klines.length,
        });

        let klines: KlineData[];
        if (localRange.fullyCovered && localRange.audit?.readiness === 'ready') {
            klines = localRange.klines;
            klineArchiveDiagnostics = buildKlineArchiveDiagnostics({
                source: 'local',
                usedLocalArchive: true,
                fullyCoveredByLocalArchive: true,
                archiveReadiness: localRange.audit.readiness,
                localBars: localRange.klines.length,
                apiBars: 0,
            });
        } else {
            const klineParams = new URLSearchParams({
                symbol: normalizedSymbol,
                interval,
                limit: String(normalizedLimit),
            });

            if (parsedStartTime !== undefined) klineParams.append('startTime', String(parsedStartTime));
            if (parsedEndTime !== undefined) klineParams.append('endTime', String(parsedEndTime));

            const klineData = await fetchBinanceKlines(`/fapi/v1/klines?${klineParams.toString()}`, {
                interval,
                startTime: parsedStartTime,
                endTime: parsedEndTime,
                limit: normalizedLimit,
            }).then(data => {
                if (!Array.isArray(data)) throw new Error('KLine API returned invalid data');
                return data;
            });

            const apiKlines = klineData
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

            klines = mergeKlineDatasets(localRange.klines, apiKlines)
                .filter((kline) =>
                    (!Number.isFinite(parsedStartTime) || kline.openTime >= parsedStartTime!)
                    && (!Number.isFinite(parsedEndTime) || kline.closeTime <= parsedEndTime!)
                )
                .slice(0, normalizedLimit);

            klineArchiveDiagnostics = buildKlineArchiveDiagnostics({
                source: localRange.klines.length > 0 ? 'local+api' : 'api',
                usedLocalArchive: localRange.klines.length > 0,
                fullyCoveredByLocalArchive: false,
                archiveReadiness: localRange.audit?.readiness ?? 'unavailable',
                localBars: localRange.klines.length,
                apiBars: apiKlines.length,
            });
        }

        if (!includeAuxiliary) {
            const diagnostics = buildEmptyAuxiliaryDiagnostics(
                parsedStartTime ?? 0,
                parsedEndTime ?? Date.now()
            );

            return NextResponse.json({
                symbol: normalizedSymbol,
                interval,
                count: klines.length,
                data: klines,
                diagnostics: {
                    ...diagnostics,
                    klineArchive: klineArchiveDiagnostics,
                },
            });
        }

        // 2. 获取持仓量数据 (优先本地，失败则降级到 API)
        const startTs = parsedStartTime ?? Date.now() - 30 * 24 * 60 * 60 * 1000;
        const endTs = parsedEndTime ?? Date.now();
        try {
            // 尝试从本地仓库读取 Metrics
            const localOiPromise = dataCollector.getFormattedData(normalizedSymbol, 'metrics', startTs, endTs)
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
                ? fetchOpenInterestHistory(normalizedSymbol, oiPeriod, String(lookbackStartTime), parsedEndTime !== undefined ? String(parsedEndTime) : undefined).catch(() => [])
                : Promise.resolve([]);

            // 3. 获取资金费率数据 (优先本地，失败则降级到 API)
            const localFundingPromise = dataCollector.getFormattedData(normalizedSymbol, 'fundingRate', startTs, endTs)
                .catch(err => { console.warn('Local Funding fetch failed:', err); return []; });

            const apiFundingPromise = parsedStartTime !== undefined
                ? fetchFundingRate(normalizedSymbol, String(parsedStartTime), parsedEndTime !== undefined ? String(parsedEndTime) : undefined).catch(() => [])
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
                parsedStartTime !== undefined &&
                oiPeriod &&
                oiPeriodMs &&
                startTs + oiPeriodMs < earliestKnownOiTimestamp
            ) {
                normalizedCoinalyzeOiData = await fetchCoinalyzeOpenInterestHistory(
                    normalizedSymbol,
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
                symbol: normalizedSymbol,
                interval,
                count: klines.length,
                data: klines,
                diagnostics: {
                    klineArchive: klineArchiveDiagnostics,
                    openInterest: oiDiagnostics,
                    fundingRate: fundingMerge.diagnostics,
                },
            });
        } catch (auxiliaryError) {
            logger.warn('Backtest auxiliary data merge failed, returning core klines only', {
                symbol: normalizedSymbol,
                interval,
                error: auxiliaryError instanceof Error ? auxiliaryError.message : String(auxiliaryError),
            });

            return NextResponse.json({
                symbol: normalizedSymbol,
                interval,
                count: klines.length,
                data: klines,
                diagnostics: {
                    ...buildEmptyAuxiliaryDiagnostics(startTs, endTs),
                    klineArchive: klineArchiveDiagnostics,
                },
            });
        }

    } catch (error) {
        console.error('获取K线数据失败:', error);
        return buildRouteErrorResponse(error);
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
