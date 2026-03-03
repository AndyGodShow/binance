import { NextRequest, NextResponse } from 'next/server';
import { dataCollector } from '@/lib/services/dataCollector';
import { fetchBinance } from '@/lib/binanceApi';

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
    fundingRate?: string;      // 资金费率 (Real)
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
        const klinePromise = fetchBinance(`/fapi/v1/klines?${klineParams.toString()}`, {
            revalidate: 60,
        }).then(res => {
            if (!res.ok) throw new Error(`KLine API Error: ${res.status}`);
            return res.json();
        });

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
        const apiOiPromise = (oiPeriod && startTime)
            ? fetchOpenInterest(symbol!, oiPeriod, startTime, endTime || undefined, limit).catch(() => [])
            : Promise.resolve([]);

        // 3. 获取资金费率数据 (优先本地，失败则降级到 API)
        const localFundingPromise = dataCollector.getFormattedData(symbol!, 'fundingRate', startTs, endTs)
            .catch(err => { console.warn('Local Funding fetch failed:', err); return []; });

        const apiFundingPromise = startTime
            ? fetchFundingRate(symbol!, startTime, endTime || undefined).catch(() => [])
            : Promise.resolve([]);

        // 并行执行所有请求
        const [klineData, localOi, apiOi, localFunding, apiFunding] = await Promise.all([
            klinePromise,
            localOiPromise,
            apiOiPromise,
            localFundingPromise,
            apiFundingPromise
        ]);

        // 数据合并策略: 优先使用 Local，如果是空的或者覆盖不全，尝试用 API 补全
        // 简单处理：如果 Local 有数据，使用 Local；否则使用 API。
        // 更高级处理可以去重合并，这里暂且优先 Local。
        const oiData = localOi.length > 0 ? localOi : apiOi;
        // 注意：Local OI 格式和 API OI 格式可能不同，需要统一。
        // DataCollector returns { timestamp, openInterest, openInterestValue }
        // API returns { timestamp, sumOpenInterest, sumOpenInterestValue }
        // 需要适配。

        const fundingData = localFunding.length > 0 ? localFunding : apiFunding;

        // 预处理数据 (API 返回的字段名可能不同)
        // Local: timestamp, openInterest
        // API: timestamp, sumOpenInterest

        const normalizedOiData = oiData.map((d: any) => ({
            timestamp: d.timestamp,
            openInterest: d.openInterest || d.sumOpenInterest, // 兼容两者
            openInterestValue: d.openInterestValue || d.sumOpenInterestValue
        })).sort((a: any, b: any) => a.timestamp - b.timestamp);

        const normalizedFundingData = fundingData.map((d: any) => ({
            fundingTime: d.fundingTime,
            fundingRate: d.fundingRate
        })).sort((a: any, b: any) => a.fundingTime - b.fundingTime);

        // 转换 K 线数据格式
        const klines: KlineData[] = klineData.map((k: any[]) => ({
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

        // 合并 OI 和 Funding Rate
        // 策略: 找到最近的一个 <= kline.closeTime 的数据点

        klines.forEach(kline => {
            // 合并 Funding Rate: 找最近一个 <= closeTime 的资金费率
            // 注意: fundingTime 是这一期费率生效的时间。通常我们用最近的一个。
            let fr = normalizedFundingData.find((f: any) => f.fundingTime >= kline.openTime && f.fundingTime <= kline.closeTime);
            if (!fr) {
                // 如果当前K线范围内没有费率结算（例如1小时K线，费率是8小时一次），
                // 我们可以取最近的一个已知的费率作为当前费率估计，或者留空。
                // 为了策略计算方便，通常取最近的一个“过去”费率。
                const pastRates = normalizedFundingData.filter((f: any) => f.fundingTime < kline.openTime);
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
            //  const matchingOI = oiData.find((oi: any) => Math.abs(oi.timestamp - kline.closeTime) < 60000); // 允许1分钟误差
            // 更稳健的做法: 找 <= closeTime 的最后一个
            const matchingOI = normalizedOiData.filter((oi: any) => oi.timestamp <= kline.closeTime).pop();

            if (matchingOI) {
                // 如果匹配的数据太旧（例如超过2个周期），则视为无效? 暂时不做太复杂的判断
                kline.openInterest = matchingOI.openInterest;
            }
        });

        return NextResponse.json({
            symbol,
            interval,
            count: klines.length,
            data: klines,
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
async function fetchOpenInterest(symbol: string, period: string, startTime: string, endTime?: string, limit: string = '500') {
    const params = new URLSearchParams({
        symbol: symbol.toUpperCase(),
        period,
        limit,
        startTime
    });
    if (endTime) params.append('endTime', endTime);

    const res = await fetchBinance(`/futures/data/openInterestHist?${params.toString()}`, { revalidate: 60 });
    if (!res.ok) throw new Error(`OI API Error: ${res.status}`);
    return res.json();
}

// 辅助函数: 获取资金费率历史
async function fetchFundingRate(symbol: string, startTime: string, endTime?: string, limit: string = '1000') {
    const params = new URLSearchParams({
        symbol: symbol.toUpperCase(),
        limit,
        startTime
    });
    if (endTime) params.append('endTime', endTime);

    const res = await fetchBinance(`/fapi/v1/fundingRate?${params.toString()}`, { revalidate: 60 });
    if (!res.ok) throw new Error(`Funding API Error: ${res.status}`);
    return res.json();
}
