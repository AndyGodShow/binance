import { NextRequest, NextResponse } from 'next/server';
import { dataCollector } from '@/lib/services/dataCollector';
import { fetchBinanceJson } from '@/lib/binanceApi';
import { fetchCoinalyzeOpenInterestHistory } from '@/lib/coinalyze';

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

const OI_MAX_LIMIT = 500;
const OI_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

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
        const klinePromise = fetchBinanceJson<unknown>(`/fapi/v1/klines?${klineParams.toString()}`, {
            revalidate: 60,
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
            return NextResponse.json({
                symbol,
                interval,
                count: klines.length,
                data: klines,
                diagnostics: {
                    openInterest: {
                        source: 'none',
                        localPoints: 0,
                        apiPoints: 0,
                        coinalyzePoints: 0,
                        mergedPoints: 0,
                        requestedStartTime: startTime ? parseInt(startTime, 10) : 0,
                        requestedEndTime: endTime ? parseInt(endTime, 10) : Date.now(),
                    },
                },
            });
        }

        // 2. 获取持仓量数据 (优先本地，失败则降级到 API)
        const startTs = startTime ? parseInt(startTime) : Date.now() - 30 * 24 * 60 * 60 * 1000;
        const endTs = endTime ? parseInt(endTime) : Date.now();

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
        const fundingData = (localFunding.length > 0 ? localFunding : apiFunding).filter(isFundingRatePoint);

        const normalizedLocalOiData = localOi
            .filter(isLocalOpenInterestPoint)
            .map(normalizeOpenInterestPoint)
            .sort((a, b) => a.timestamp - b.timestamp);

        const normalizedApiOiData = apiOi
            .filter(isApiOpenInterestPoint)
            .map(normalizeOpenInterestPoint)
            .sort((a, b) => a.timestamp - b.timestamp);

        let normalizedCoinalyzeOiData: NormalizedOpenInterestPoint[] = [];
        const oiPeriodMs = oiPeriod ? getOpenInterestPeriodMs(oiPeriod) : null;
        const earliestKnownOiTimestamp = Math.min(
            normalizedLocalOiData[0]?.timestamp ?? Number.POSITIVE_INFINITY,
            normalizedApiOiData[0]?.timestamp ?? Number.POSITIVE_INFINITY
        );

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

        const normalizedOiData = mergeNormalizedOpenInterestData(
            normalizedCoinalyzeOiData,
            normalizedApiOiData,
            normalizedLocalOiData
        );

        const oiDiagnostics: OpenInterestDiagnostics = {
            source:
                normalizedLocalOiData.length > 0 && normalizedApiOiData.length > 0 ? 'local+api'
                    : normalizedLocalOiData.length > 0 ? 'local'
                        : normalizedApiOiData.length > 0 ? 'api'
                            : normalizedCoinalyzeOiData.length > 0 ? 'coinalyze'
                                : 'none',
            localPoints: normalizedLocalOiData.length,
            apiPoints: normalizedApiOiData.length,
            coinalyzePoints: normalizedCoinalyzeOiData.length,
            mergedPoints: normalizedOiData.length,
            requestedStartTime: startTs,
            requestedEndTime: endTs,
            earliestPointTime: normalizedOiData[0]?.timestamp,
            latestPointTime: normalizedOiData[normalizedOiData.length - 1]?.timestamp,
        };

        const normalizedFundingData = fundingData
            .map((point) => ({
                fundingTime: point.fundingTime,
                fundingRate: point.fundingRate
            }))
            .sort((a, b) => a.fundingTime - b.fundingTime);

        // 合并 OI 和 Funding Rate
        // 策略: 找到最近的一个 <= kline.closeTime 的数据点，并限制 OI 的最大滞后时间
        const fallbackOiPeriodMs = getOpenInterestPeriodMs(interval);
        const maxOiLagMs = (oiPeriodMs || fallbackOiPeriodMs || (60 * 60 * 1000)) * 2;

        klines.forEach(kline => {
            // 合并 Funding Rate: 找最近一个 <= closeTime 的资金费率
            // 注意: fundingTime 是这一期费率生效的时间。通常我们用最近的一个。
            let fr = normalizedFundingData.find((fundingPoint) =>
                fundingPoint.fundingTime >= kline.openTime && fundingPoint.fundingTime <= kline.closeTime
            );
            if (!fr) {
                // 如果当前K线范围内没有费率结算（例如1小时K线，费率是8小时一次），
                // 我们可以取最近的一个已知的费率作为当前费率估计，或者留空。
                // 为了策略计算方便，通常取最近的一个“过去”费率。
                const pastRates = normalizedFundingData.filter((fundingPoint) => fundingPoint.fundingTime < kline.openTime);
                if (pastRates.length > 0) {
                    fr = pastRates[pastRates.length - 1];
                }
            }
            if (fr) {
                kline.fundingRate = fr.fundingRate;
            }

            // 合并 Open Interest: 找时间戳匹配的 OI
            // OI 数据的 timestamp 通常是 period 的结束时间? 需要确认。Binance OI hist返回的是时刻数据。
            // 我们找一个最接近 kline.closeTime 的 OI 数据
            //  const matchingOI = oiData.find((oiPoint) => Math.abs(oiPoint.timestamp - kline.closeTime) < 60000); // 允许1分钟误差
            // 更稳健的做法: 找 <= closeTime 的最后一个
            const matchingOI = normalizedOiData.filter((oiPoint) => oiPoint.timestamp <= kline.closeTime).pop();

            if (matchingOI && kline.closeTime - matchingOI.timestamp <= maxOiLagMs) {
                kline.openInterest = matchingOI.openInterest;
                kline.openInterestValue = matchingOI.openInterestValue;
            }
        });

        return NextResponse.json({
            symbol,
            interval,
            count: klines.length,
            data: klines,
            diagnostics: {
                openInterest: oiDiagnostics,
            },
        });

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
