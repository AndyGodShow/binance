import { NextResponse } from 'next/server';

import { fetchBinanceJson } from '@/lib/binanceApi';
import { withTimeout } from '@/lib/async';
import { logger } from '@/lib/logger';
import {
    BTC_LONG_SHORT_RATIO_PERIOD,
    buildEtfFlowSourceStatus,
    buildMacroDashboard,
    classifyMacroFreshness,
    DIGITAL_ASSET_ETF_ASSETS,
    parseBitboBtcEtfFlowApiResponse,
    parseBitboBtcEtfFlowHtml,
    parseBtcEtfFlowText,
    selectFreshestBtcEtfFlow,
    type BtcEtfFlowSnapshot,
    type EthBtcSnapshot,
    type FearGreedSnapshot,
    type MacroSourceAsset,
    type MacroSourceStatus,
    type MacroSourcePayload,
} from '@/lib/macro';

interface YahooChartResponse {
    chart?: {
        result?: Array<{
            meta?: {
                regularMarketPrice?: number;
                regularMarketPreviousClose?: number;
                regularMarketChangePercent?: number;
                previousClose?: number;
                chartPreviousClose?: number;
                regularMarketTime?: number;
                marketState?: string;
                preMarketPrice?: number;
                preMarketChangePercent?: number;
                preMarketTime?: number;
                postMarketPrice?: number;
                postMarketChangePercent?: number;
                postMarketTime?: number;
            };
            timestamp?: number[];
            indicators?: {
                quote?: Array<{
                    close?: Array<number | null>;
                }>;
            };
        }>;
        error?: unknown;
    };
}

interface FearGreedResponse {
    data?: Array<{
        value: string;
        value_classification?: string;
        timestamp?: string;
        time_until_update?: string;
    }>;
}

interface Binance24hTicker {
    lastPrice: string;
    priceChangePercent: string;
    highPrice: string;
    lowPrice: string;
    closeTime?: number;
}

interface BinancePremiumIndex {
    lastFundingRate: string;
    time?: number;
    nextFundingTime?: number;
}

interface YahooAssetConfig {
    symbol: string;
    label: string;
    market: string;
    querySymbols?: string[];
    normalizePrice?: (value: number) => number;
    includePrePost?: boolean;
}

const YAHOO_ASSETS: YahooAssetConfig[] = [
    { symbol: '^GSPC', label: '标普500指数', market: '美股' },
    { symbol: '^IXIC', label: '纳斯达克综合指数', market: '美股' },
    { symbol: '^NDX', label: '纳斯达克100', market: '美股' },
    { symbol: 'XAUUSD=X', label: '伦敦金', market: '大宗商品', querySymbols: ['XAUUSD=X', 'GC=F'] },
    { symbol: 'XAGUSD=X', label: '伦敦银', market: '大宗商品', querySymbols: ['XAGUSD=X', 'SI=F'] },
    { symbol: 'CL=F', label: 'WTI原油', market: '大宗商品' },
    { symbol: 'BZ=F', label: '布伦特原油', market: '大宗商品' },
    ...DIGITAL_ASSET_ETF_ASSETS,
    { symbol: '000001.SS', label: '上证指数', market: '中韩日指数' },
    { symbol: '^KS11', label: '韩国KOSPI', market: '中韩日指数' },
    { symbol: '^N225', label: '日经225', market: '中韩日指数' },
    { symbol: '^VIX', label: 'VIX', market: '监控' },
    { symbol: 'DX-Y.NYB', label: 'DXY', market: '监控' },
    { symbol: '^TNX', label: 'US10Y', market: '监控' },
];

const US_EQUITY_ASSETS: YahooAssetConfig[] = [
    { symbol: 'AAPL', label: '苹果', market: '七姐妹', includePrePost: true },
    { symbol: 'MSFT', label: '微软', market: '七姐妹', includePrePost: true },
    { symbol: 'NVDA', label: '英伟达', market: '七姐妹', includePrePost: true },
    { symbol: 'AMZN', label: '亚马逊', market: '七姐妹', includePrePost: true },
    { symbol: 'META', label: 'Meta 平台', market: '七姐妹', includePrePost: true },
    { symbol: 'GOOGL', label: '谷歌母公司', market: '七姐妹', includePrePost: true },
    { symbol: 'TSLA', label: '特斯拉', market: '七姐妹', includePrePost: true },
    { symbol: 'TQQQ', label: '纳指三倍做多', market: '多空杠杆 ETF/ETN', includePrePost: true },
    { symbol: 'SQQQ', label: '纳指三倍做空', market: '多空杠杆 ETF/ETN', includePrePost: true },
    { symbol: 'SOXL', label: '半导体三倍做多', market: '多空杠杆 ETF/ETN', includePrePost: true },
    { symbol: 'SOXS', label: '半导体三倍做空', market: '多空杠杆 ETF/ETN', includePrePost: true },
    { symbol: 'SPXL', label: '标普三倍做多', market: '多空杠杆 ETF/ETN', includePrePost: true },
    { symbol: 'SPXS', label: '标普三倍做空', market: '多空杠杆 ETF/ETN', includePrePost: true },
    { symbol: 'FNGU', label: 'FANG+ 三倍做多', market: '多空杠杆 ETF/ETN', includePrePost: true },
    { symbol: 'FNGD', label: 'FANG+ 三倍做空', market: '多空杠杆 ETF/ETN', includePrePost: true },
    { symbol: 'COIN', label: 'Coinbase 交易所', market: '加密相关股', includePrePost: true },
    { symbol: 'MSTR', label: 'Strategy 持币公司', market: '加密相关股', includePrePost: true },
    { symbol: 'MARA', label: 'Marathon 矿企', market: '加密相关股', includePrePost: true },
    { symbol: 'RIOT', label: 'Riot 矿企', market: '加密相关股', includePrePost: true },
    { symbol: 'CLSK', label: 'CleanSpark 矿企', market: '加密相关股', includePrePost: true },
    { symbol: 'HOOD', label: 'Robinhood 券商', market: '加密相关股', includePrePost: true },
    { symbol: 'BABA', label: '阿里巴巴', market: '中概观察', includePrePost: true },
    { symbol: 'JD', label: '京东', market: '中概观察', includePrePost: true },
    { symbol: 'BIDU', label: '百度', market: '中概观察', includePrePost: true },
    { symbol: 'PDD', label: '拼多多', market: '中概观察', includePrePost: true },
    { symbol: 'XPEV', label: '小鹏汽车', market: '中概观察', includePrePost: true },
    { symbol: 'TCOM', label: '携程', market: '中概观察', includePrePost: true },
    { symbol: 'BILI', label: '哔哩哔哩', market: '中概观察', includePrePost: true },
    { symbol: 'XLK', label: '科技板块', market: '板块总览', includePrePost: true },
    { symbol: 'XLY', label: '可选消费', market: '板块总览', includePrePost: true },
    { symbol: 'XLC', label: '通信服务', market: '板块总览', includePrePost: true },
    { symbol: 'XLF', label: '金融板块', market: '板块总览', includePrePost: true },
    { symbol: 'XLV', label: '医疗保健', market: '板块总览', includePrePost: true },
    { symbol: 'XLI', label: '工业板块', market: '板块总览', includePrePost: true },
    { symbol: 'XLE', label: '能源板块', market: '板块总览', includePrePost: true },
    { symbol: 'XLP', label: '必选消费', market: '板块总览', includePrePost: true },
    { symbol: 'XLU', label: '公用事业', market: '板块总览', includePrePost: true },
    { symbol: 'XLB', label: '原材料', market: '板块总览', includePrePost: true },
    { symbol: 'XLRE', label: '房地产', market: '板块总览', includePrePost: true },
];

const HK_EQUITY_ASSETS: YahooAssetConfig[] = [
    { symbol: '^HSI', label: '恒生指数', market: '指数/宽基' },
    { symbol: '^HSCE', label: '恒生国企指数', market: '指数/宽基' },
    { symbol: '2800.HK', label: '盈富基金', market: '指数/宽基' },
    { symbol: '2822.HK', label: '南方A50', market: '指数/宽基' },
    { symbol: '3033.HK', label: '恒生科技ETF', market: '指数/宽基' },
    { symbol: '3067.HK', label: '安硕恒生科技ETF', market: '板块ETF' },
    { symbol: '3191.HK', label: 'Global X中国半导体ETF', market: '板块ETF' },
    { symbol: '2845.HK', label: 'Global X中国电动车ETF', market: '板块ETF' },
    { symbol: '3174.HK', label: '南方恒生生物科技ETF', market: '板块ETF' },
    { symbol: '3070.HK', label: '平安香港高息ETF', market: '板块ETF' },
    { symbol: '0700.HK', label: '腾讯控股', market: '科技互联网' },
    { symbol: '9988.HK', label: '阿里巴巴-W', market: '科技互联网' },
    { symbol: '3690.HK', label: '美团-W', market: '科技互联网' },
    { symbol: '9618.HK', label: '京东集团-SW', market: '科技互联网' },
    { symbol: '1810.HK', label: '小米集团-W', market: '科技互联网' },
    { symbol: '0388.HK', label: '港交所', market: '金融地产' },
    { symbol: '1299.HK', label: '友邦保险', market: '金融地产' },
    { symbol: '2318.HK', label: '中国平安', market: '金融地产' },
    { symbol: '0939.HK', label: '建设银行', market: '金融地产' },
    { symbol: '1398.HK', label: '工商银行', market: '金融地产' },
    { symbol: '0005.HK', label: '汇丰控股', market: '金融地产' },
    { symbol: '1211.HK', label: '比亚迪股份', market: '汽车新能源' },
    { symbol: '9868.HK', label: '小鹏汽车-W', market: '汽车新能源' },
    { symbol: '2015.HK', label: '理想汽车-W', market: '汽车新能源' },
    { symbol: '0981.HK', label: '中芯国际', market: '半导体AI' },
    { symbol: '2269.HK', label: '药明生物', market: '消费医药' },
    { symbol: '2020.HK', label: '安踏体育', market: '消费医药' },
    { symbol: '0883.HK', label: '中国海洋石油', market: '资源公用' },
    { symbol: '0941.HK', label: '中国移动', market: '资源公用' },
];

const A_SHARE_EQUITY_ASSETS: YahooAssetConfig[] = [
    { symbol: '000001.SS', label: '上证指数', market: '指数/宽基' },
    { symbol: '399001.SZ', label: '深证成指', market: '指数/宽基' },
    { symbol: '399006.SZ', label: '创业板指', market: '指数/宽基' },
    { symbol: '510300.SS', label: '沪深300ETF', market: '指数/宽基' },
    { symbol: '510500.SS', label: '中证500ETF', market: '指数/宽基' },
    { symbol: '512480.SS', label: '半导体ETF', market: '板块ETF' },
    { symbol: '512800.SS', label: '银行ETF', market: '板块ETF' },
    { symbol: '512880.SS', label: '证券ETF', market: '板块ETF' },
    { symbol: '512010.SS', label: '医药ETF', market: '板块ETF' },
    { symbol: '512170.SS', label: '医疗ETF', market: '板块ETF' },
    { symbol: '515030.SS', label: '新能源车ETF', market: '板块ETF' },
    { symbol: '515790.SS', label: '光伏ETF', market: '板块ETF' },
    { symbol: '159928.SZ', label: '消费ETF', market: '板块ETF' },
    { symbol: '600519.SS', label: '贵州茅台', market: '消费医药' },
    { symbol: '600276.SS', label: '恒瑞医药', market: '消费医药' },
    { symbol: '300760.SZ', label: '迈瑞医疗', market: '消费医药' },
    { symbol: '000333.SZ', label: '美的集团', market: '消费医药' },
    { symbol: '600036.SS', label: '招商银行', market: '金融地产' },
    { symbol: '601318.SS', label: '中国平安', market: '金融地产' },
    { symbol: '300059.SZ', label: '东方财富', market: '金融地产' },
    { symbol: '601398.SS', label: '工商银行', market: '金融地产' },
    { symbol: '601888.SS', label: '中国中免', market: '消费医药' },
    { symbol: '300750.SZ', label: '宁德时代', market: '汽车新能源' },
    { symbol: '002594.SZ', label: '比亚迪', market: '汽车新能源' },
    { symbol: '601012.SS', label: '隆基绿能', market: '汽车新能源' },
    { symbol: '601127.SS', label: '赛力斯', market: '汽车新能源' },
    { symbol: '300124.SZ', label: '汇川技术', market: '汽车新能源' },
    { symbol: '688981.SS', label: '中芯国际', market: '半导体AI' },
    { symbol: '002475.SZ', label: '立讯精密', market: '半导体AI' },
    { symbol: '000063.SZ', label: '中兴通讯', market: '半导体AI' },
    { symbol: '002415.SZ', label: '海康威视', market: '半导体AI' },
    { symbol: '300308.SZ', label: '中际旭创', market: '半导体AI' },
    { symbol: '601899.SS', label: '紫金矿业', market: '资源公用' },
    { symbol: '600900.SS', label: '长江电力', market: '资源公用' },
    { symbol: '601985.SS', label: '中国核电', market: '资源公用' },
];

const ETF_FLOWS_URL = 'https://farside.co.uk/btc/';
const ETF_FLOWS_BITBO_URL = 'https://bitbo.io/treasuries/etf-flows/';
const ETF_FLOWS_BITBO_API_URL = 'https://charts.bitbo.io/api/v1/etf-flow-raw-btc/';
const BITBO_API_KEY = process.env.BITBO_API_KEY;
const MACRO_SOURCE_TIMEOUT_MS = 8000;
const YAHOO_CHART_HOSTS = ['query1.finance.yahoo.com', 'query2.finance.yahoo.com'];
const YAHOO_CHART_HOST_TIMEOUT_MS = 4000;
const YAHOO_GLOBAL_ASSET_BATCH_SIZE = 6;
const YAHOO_GLOBAL_ASSET_BATCH_DELAY_MS = 80;
const YAHOO_EQUITY_BATCH_SIZE = 6;
const YAHOO_EQUITY_BATCH_DELAY_MS = 80;

interface EtfFlowFetchResult {
    snapshot?: BtcEtfFlowSnapshot;
    primaryAvailable: boolean;
    secondaryAvailable: boolean;
}

type TimedSettled<T> = (
    | { status: 'fulfilled'; value: T }
    | { status: 'rejected'; reason: unknown }
) & {
    latencyMs: number;
};

function normalizeHtmlToText(html: string): string {
    return html
        .replace(/<script[\s\S]*?<\/script>/gi, ' ')
        .replace(/<style[\s\S]*?<\/style>/gi, ' ')
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<\/(p|div|tr|td|th|li|h1|h2|h3|h4)>/gi, '\n')
        .replace(/<[^>]+>/g, ' ')
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&');
}

function formatUtcDate(date: Date): string {
    return date.toISOString().slice(0, 10);
}

function toIsoTimestamp(timestampMs?: number): string | undefined {
    if (!Number.isFinite(timestampMs)) {
        return undefined;
    }
    return new Date(timestampMs as number).toISOString();
}

function toIsoTimestampSeconds(timestampSeconds?: number): string | undefined {
    if (!Number.isFinite(timestampSeconds)) {
        return undefined;
    }
    return new Date((timestampSeconds as number) * 1000).toISOString();
}

function pickLatestTimestamp(values: Array<string | undefined>): string | undefined {
    return values
        .filter((value): value is string => typeof value === 'string' && Number.isFinite(Date.parse(value)))
        .sort((left, right) => Date.parse(right) - Date.parse(left))[0];
}

function delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function settleTimed<T>(factory: () => Promise<T>): Promise<TimedSettled<T>> {
    const startedAt = Date.now();
    try {
        return {
            status: 'fulfilled',
            value: await factory(),
            latencyMs: Date.now() - startedAt,
        };
    } catch (reason) {
        return {
            status: 'rejected',
            reason,
            latencyMs: Date.now() - startedAt,
        };
    }
}

function buildYahooAssetSession(
    asset: YahooAssetConfig,
    meta: NonNullable<NonNullable<NonNullable<YahooChartResponse['chart']>['result']>[number]['meta']>
): MacroSourceAsset['session'] {
    const state = meta.marketState?.toUpperCase();
    const isPreMarket = state === 'PRE' || state === 'PREPRE';
    const isPostMarket = state === 'POST' || state === 'POSTPOST';
    const rawPrice = isPreMarket ? meta.preMarketPrice : isPostMarket ? meta.postMarketPrice : undefined;
    const rawChangePercent = isPreMarket ? meta.preMarketChangePercent : isPostMarket ? meta.postMarketChangePercent : undefined;
    const rawTimestamp = isPreMarket ? meta.preMarketTime : isPostMarket ? meta.postMarketTime : undefined;

    if (!Number.isFinite(rawPrice) || !Number.isFinite(rawChangePercent)) {
        return undefined;
    }

    return {
        state: isPreMarket ? 'pre' : 'post',
        label: isPreMarket ? '盘前' : '盘后',
        price: asset.normalizePrice ? asset.normalizePrice(rawPrice as number) : rawPrice as number,
        changePercent: rawChangePercent as number,
        dataTimestamp: toIsoTimestampSeconds(rawTimestamp),
    };
}

async function fetchYahooAsset(asset: YahooAssetConfig): Promise<MacroSourceAsset | null> {
    const querySymbols = asset.querySymbols && asset.querySymbols.length > 0 ? asset.querySymbols : [asset.symbol];
    let lastError: unknown;

    for (const querySymbol of querySymbols) {
        for (const yahooHost of YAHOO_CHART_HOSTS) {
            try {
                const includePrePost = asset.includePrePost ? 'true' : 'false';
                const url = `https://${yahooHost}/v8/finance/chart/${encodeURIComponent(querySymbol)}?interval=1d&range=5d&includePrePost=${includePrePost}`;
                const response = await withTimeout(fetch(url, {
                    headers: {
                        'User-Agent': 'Mozilla/5.0',
                        'Accept': 'application/json',
                    },
                    next: { revalidate: 60 },
                }), YAHOO_CHART_HOST_TIMEOUT_MS, `macro yahoo ${querySymbol} ${yahooHost}`);

                if (!response.ok) {
                    throw new Error(`Yahoo request failed for ${querySymbol}: ${response.status}`);
                }

                const payload = await response.json() as YahooChartResponse;
                const result = payload.chart?.result?.[0];
                if (!result) {
                    continue;
                }

                const closes = result.indicators?.quote?.[0]?.close?.filter((value): value is number => Number.isFinite(value)) ?? [];
                const lastClose = closes.length > 0 ? closes[closes.length - 1] : undefined;
                const priceRaw = result.meta?.regularMarketPrice ?? lastClose ?? result.meta?.previousClose;
                const previousCloseRaw = result.meta?.regularMarketPreviousClose
                    ?? result.meta?.previousClose
                    ?? (closes.length > 1 ? closes[closes.length - 2] : undefined)
                    ?? result.meta?.chartPreviousClose;

                if (!Number.isFinite(priceRaw)) {
                    continue;
                }

                const resolvedPriceRaw = priceRaw as number;
                const price = asset.normalizePrice ? asset.normalizePrice(resolvedPriceRaw) : resolvedPriceRaw;
                const previousClose = Number.isFinite(previousCloseRaw)
                    ? (asset.normalizePrice ? asset.normalizePrice(previousCloseRaw as number) : (previousCloseRaw as number))
                    : undefined;
                const normalizedChangePercent = Number.isFinite(result.meta?.regularMarketChangePercent)
                    ? result.meta?.regularMarketChangePercent
                    : undefined;
                const changePercent = normalizedChangePercent ?? (previousClose && previousClose !== 0
                    ? ((price - previousClose) / previousClose) * 100
                    : 0);

                return {
                    symbol: asset.symbol,
                    label: asset.label,
                    market: asset.market,
                    price,
                    changePercent,
                    dataTimestamp: toIsoTimestampSeconds(
                        result.meta?.regularMarketTime ?? result.timestamp?.filter(Number.isFinite).at(-1)
                    ),
                    session: result.meta ? buildYahooAssetSession(asset, result.meta) : undefined,
                };
            } catch (error) {
                lastError = error;
            }
        }
    }

    if (lastError) {
        throw lastError;
    }

    return null;
}

async function fetchYahooAssetsInBatches(
    assets: YahooAssetConfig[],
    batchSize: number,
    batchDelayMs: number
): Promise<Array<PromiseSettledResult<MacroSourceAsset | null>>> {
    const results: Array<PromiseSettledResult<MacroSourceAsset | null>> = [];

    for (let index = 0; index < assets.length; index += batchSize) {
        const batch = assets.slice(index, index + batchSize);
        results.push(...await Promise.allSettled(batch.map((asset) => fetchYahooAsset(asset))));
        if (index + batchSize < assets.length) {
            await delay(batchDelayMs);
        }
    }

    return results;
}

async function fetchFearGreed(): Promise<FearGreedSnapshot> {
    const response = await withTimeout(fetch('https://api.alternative.me/fng/?limit=1&format=json', {
        next: { revalidate: 1800 },
    }), MACRO_SOURCE_TIMEOUT_MS, 'macro fear greed');

    if (!response.ok) {
        throw new Error(`Fear & Greed request failed: ${response.status}`);
    }

    const payload = await response.json() as FearGreedResponse;
    const latest = payload.data?.[0];
    if (!latest) {
        throw new Error('Fear & Greed payload missing latest row');
    }

    const timestamp = latest.timestamp && /^\d+$/.test(latest.timestamp)
        ? new Date(Number.parseInt(latest.timestamp, 10) * 1000).toISOString()
        : undefined;

    return {
        value: Number.parseInt(latest.value, 10),
        valueText: latest.value_classification,
        timestamp,
        nextUpdateSeconds: latest.time_until_update ? Number.parseInt(latest.time_until_update, 10) : undefined,
    };
}

async function fetchBtcSnapshot() {
    const [ticker, premium, lsRatioData] = await withTimeout(Promise.all([
        fetchBinanceJson<Binance24hTicker>('/fapi/v1/ticker/24hr?symbol=BTCUSDT', { revalidate: 30 }),
        fetchBinanceJson<BinancePremiumIndex>('/fapi/v1/premiumIndex?symbol=BTCUSDT', { revalidate: 30 }),
        fetchBinanceJson<Array<{ longShortRatio: string; timestamp?: number }>>(`/futures/data/globalLongShortAccountRatio?symbol=BTCUSDT&period=${BTC_LONG_SHORT_RATIO_PERIOD}`, { revalidate: 60 }),
    ]), MACRO_SOURCE_TIMEOUT_MS, 'macro btc');

    const latestLsRatio = Array.isArray(lsRatioData) && lsRatioData.length > 0
        ? lsRatioData[lsRatioData.length - 1]
        : undefined;
    const lsRatio = latestLsRatio
        ? Number.parseFloat(latestLsRatio.longShortRatio)
        : 1.5; // fallback

    return {
        price: Number.parseFloat(ticker.lastPrice),
        changePercent: Number.parseFloat(ticker.priceChangePercent),
        high24h: Number.parseFloat(ticker.highPrice),
        low24h: Number.parseFloat(ticker.lowPrice),
        fundingRate: Number.parseFloat(premium.lastFundingRate) * 100,
        longShortRatio: lsRatio,
        dataTimestamp: toIsoTimestamp(ticker.closeTime),
        fundingTimestamp: toIsoTimestamp(premium.time),
        nextFundingTimestamp: toIsoTimestamp(premium.nextFundingTime),
        longShortRatioTimestamp: toIsoTimestamp(latestLsRatio?.timestamp),
    };
}

async function fetchEthBtcSnapshot() {
    const ticker = await withTimeout(
        fetchBinanceJson<Binance24hTicker>('/api/v3/ticker/24hr?symbol=ETHBTC', { revalidate: 30 }),
        MACRO_SOURCE_TIMEOUT_MS,
        'macro ethbtc'
    );
    return {
        price: Number.parseFloat(ticker.lastPrice),
        changePercent: Number.parseFloat(ticker.priceChangePercent),
        dataTimestamp: toIsoTimestamp(ticker.closeTime),
    };
}

async function fetchFarsideBtcEtfFlow(): Promise<BtcEtfFlowSnapshot | undefined> {
    try {
        const response = await withTimeout(fetch(ETF_FLOWS_URL, {
            headers: {
                'User-Agent': 'Mozilla/5.0',
                'Accept': 'text/html,application/xhtml+xml',
            },
            next: { revalidate: 15 * 60 },
        }), MACRO_SOURCE_TIMEOUT_MS, 'macro farside etf');

        if (!response.ok) {
            throw new Error(`ETF flow request failed: ${response.status}`);
        }

        const html = await response.text();
        return {
            ...parseBtcEtfFlowText(normalizeHtmlToText(html)),
            provider: 'Farside',
        } as BtcEtfFlowSnapshot;
    } catch (error) {
        logger.warn('Failed to fetch BTC ETF flow data', {
            error: error instanceof Error ? error.message : String(error),
        });
        return undefined;
    }
}

async function fetchBitboApiBtcEtfFlow(): Promise<BtcEtfFlowSnapshot | undefined> {
    if (!BITBO_API_KEY) {
        return undefined;
    }

    try {
        const endDate = new Date();
        const startDate = new Date(endDate.getTime() - 21 * 24 * 60 * 60 * 1000);
        const params = new URLSearchParams({
            start_date: formatUtcDate(startDate),
            end_date: formatUtcDate(endDate),
            api_key: BITBO_API_KEY,
        });
        const response = await withTimeout(fetch(`${ETF_FLOWS_BITBO_API_URL}?${params.toString()}`, {
            headers: {
                'User-Agent': 'Mozilla/5.0',
                'Accept': 'application/json',
            },
            next: { revalidate: 15 * 60 },
        }), MACRO_SOURCE_TIMEOUT_MS, 'macro bitbo etf api');

        if (!response.ok) {
            throw new Error(`Bitbo ETF flow API request failed: ${response.status}`);
        }

        return {
            ...parseBitboBtcEtfFlowApiResponse(await response.json()),
            provider: 'Bitbo API',
        } as BtcEtfFlowSnapshot;
    } catch (error) {
        logger.warn('Failed to fetch BTC ETF flow data from Bitbo API', {
            error: error instanceof Error ? error.message : String(error),
        });
        return undefined;
    }
}

async function fetchBitboBtcEtfFlow(): Promise<BtcEtfFlowSnapshot | undefined> {
    try {
        const response = await withTimeout(fetch(ETF_FLOWS_BITBO_URL, {
            headers: {
                'User-Agent': 'Mozilla/5.0',
                'Accept': 'text/html,application/xhtml+xml',
            },
            next: { revalidate: 15 * 60 },
        }), MACRO_SOURCE_TIMEOUT_MS, 'macro bitbo etf');

        if (!response.ok) {
            throw new Error(`Bitbo ETF flow request failed: ${response.status}`);
        }

        const html = await response.text();
        return {
            ...parseBitboBtcEtfFlowHtml(html),
            provider: 'Bitbo',
        } as BtcEtfFlowSnapshot;
    } catch (error) {
        logger.warn('Failed to fetch BTC ETF flow data from Bitbo fallback', {
            error: error instanceof Error ? error.message : String(error),
        });
        return undefined;
    }
}

function classifyMacroErrorKind(error: unknown): MacroSourceStatus['errorKind'] {
    const message = error instanceof Error ? error.message : String(error);
    if (/timed out|timeout/i.test(message)) {
        return 'timeout';
    }
    if (/missing|empty/i.test(message)) {
        return 'empty_response';
    }
    if (/invalid|unexpected/i.test(message)) {
        return 'invalid_response';
    }
    if (/request failed|http|upstream/i.test(message)) {
        return 'upstream_error';
    }
    return 'unknown';
}

function fallbackFearGreed(): FearGreedSnapshot {
    return {
        value: 50,
        valueText: 'Unavailable',
    };
}

function fallbackBtcSnapshot(): Awaited<ReturnType<typeof fetchBtcSnapshot>> {
    return {
        price: 0,
        changePercent: 0,
        high24h: 0,
        low24h: 0,
        fundingRate: 0,
        longShortRatio: 1.5,
        dataTimestamp: undefined,
        fundingTimestamp: undefined,
        nextFundingTimestamp: undefined,
        longShortRatioTimestamp: undefined,
    };
}

function fallbackEthBtcSnapshot(): EthBtcSnapshot {
    return {
        price: 0,
        changePercent: 0,
        dataTimestamp: undefined,
    };
}

async function fetchBtcEtfFlow(): Promise<EtfFlowFetchResult> {
    const [bitboApi, bitboHtml, farside] = await Promise.all([
        fetchBitboApiBtcEtfFlow(),
        fetchBitboBtcEtfFlow(),
        fetchFarsideBtcEtfFlow(),
    ]);
    const snapshot = selectFreshestBtcEtfFlow([bitboApi, bitboHtml, farside]);

    return {
        snapshot,
        primaryAvailable: Boolean(bitboApi || bitboHtml),
        secondaryAvailable: Boolean(farside),
    };
}

export async function GET() {
    try {
        const [fearGreedSettled, btcSettled, ethBtcSettled, etfFlowSettled, yahooAssetResults, usEquityResults, hkEquityResults, aShareEquityResults] = await Promise.all([
            settleTimed(() => fetchFearGreed()),
            settleTimed(() => fetchBtcSnapshot()),
            settleTimed(() => fetchEthBtcSnapshot()),
            settleTimed(() => fetchBtcEtfFlow()),
            settleTimed(() => fetchYahooAssetsInBatches(
                YAHOO_ASSETS,
                YAHOO_GLOBAL_ASSET_BATCH_SIZE,
                YAHOO_GLOBAL_ASSET_BATCH_DELAY_MS
            )),
            settleTimed(() => fetchYahooAssetsInBatches(
                US_EQUITY_ASSETS,
                YAHOO_EQUITY_BATCH_SIZE,
                YAHOO_EQUITY_BATCH_DELAY_MS
            )),
            settleTimed(() => fetchYahooAssetsInBatches(
                HK_EQUITY_ASSETS,
                YAHOO_EQUITY_BATCH_SIZE,
                YAHOO_EQUITY_BATCH_DELAY_MS
            )),
            settleTimed(() => fetchYahooAssetsInBatches(
                A_SHARE_EQUITY_ASSETS,
                YAHOO_EQUITY_BATCH_SIZE,
                YAHOO_EQUITY_BATCH_DELAY_MS
            )),
        ]);

        const fearGreedResult = fearGreedSettled.status === 'fulfilled' ? fearGreedSettled.value : fallbackFearGreed();
        const btcResult = btcSettled.status === 'fulfilled' ? btcSettled.value : fallbackBtcSnapshot();
        const ethBtcResult = ethBtcSettled.status === 'fulfilled' ? ethBtcSettled.value : fallbackEthBtcSnapshot();
        const etfFlowResult = etfFlowSettled.status === 'fulfilled'
            ? etfFlowSettled.value
            : { snapshot: undefined, primaryAvailable: false, secondaryAvailable: false };
        const sourceErrorKinds = {
            fearGreed: fearGreedSettled.status === 'rejected' ? classifyMacroErrorKind(fearGreedSettled.reason) : undefined,
            btc: btcSettled.status === 'rejected' ? classifyMacroErrorKind(btcSettled.reason) : undefined,
            ethBtc: ethBtcSettled.status === 'rejected' ? classifyMacroErrorKind(ethBtcSettled.reason) : undefined,
            etf: etfFlowSettled.status === 'rejected' ? classifyMacroErrorKind(etfFlowSettled.reason) : undefined,
        };
        const assets = Object.fromEntries(
            (yahooAssetResults.status === 'fulfilled' ? yahooAssetResults.value : [])
                .map((result) => result.status === 'fulfilled' ? result.value : null)
                .filter((asset): asset is MacroSourceAsset => Boolean(asset))
                .map((asset) => [asset.symbol, asset])
        );
        const usEquities = Object.fromEntries(
            (usEquityResults.status === 'fulfilled' ? usEquityResults.value : [])
                .map((result) => result.status === 'fulfilled' ? result.value : null)
                .filter((asset): asset is MacroSourceAsset => Boolean(asset))
                .map((asset) => [asset.symbol, asset])
        );
        const hkEquities = Object.fromEntries(
            (hkEquityResults.status === 'fulfilled' ? hkEquityResults.value : [])
                .map((result) => result.status === 'fulfilled' ? result.value : null)
                .filter((asset): asset is MacroSourceAsset => Boolean(asset))
                .map((asset) => [asset.symbol, asset])
        );
        const aShareEquities = Object.fromEntries(
            (aShareEquityResults.status === 'fulfilled' ? aShareEquityResults.value : [])
                .map((result) => result.status === 'fulfilled' ? result.value : null)
                .filter((asset): asset is MacroSourceAsset => Boolean(asset))
                .map((asset) => [asset.symbol, asset])
        );
        const latestMarketDataTimestamp = pickLatestTimestamp(Object.values(assets).map((asset) => asset.dataTimestamp));
        const latestUsEquityTimestamp = pickLatestTimestamp(
            Object.values(usEquities).flatMap((asset) => [asset.dataTimestamp, asset.session?.dataTimestamp])
        );
        const latestHkEquityTimestamp = pickLatestTimestamp(
            Object.values(hkEquities).flatMap((asset) => [asset.dataTimestamp, asset.session?.dataTimestamp])
        );
        const latestAShareEquityTimestamp = pickLatestTimestamp(
            Object.values(aShareEquities).flatMap((asset) => [asset.dataTimestamp, asset.session?.dataTimestamp])
        );
        const btcDataTimestamp = pickLatestTimestamp([
            btcResult.dataTimestamp,
            btcResult.fundingTimestamp,
            btcResult.longShortRatioTimestamp,
        ]);

        const assetCount = Object.keys(assets).length;
        const usEquityCount = Object.keys(usEquities).length;
        const hkEquityCount = Object.keys(hkEquities).length;
        const aShareEquityCount = Object.keys(aShareEquities).length;
        const minimumAssetCount = Math.ceil(YAHOO_ASSETS.length * 0.75);
        const minimumUsEquityCount = Math.ceil(US_EQUITY_ASSETS.length * 0.75);
        const minimumHkEquityCount = Math.ceil(HK_EQUITY_ASSETS.length * 0.75);
        const minimumAShareEquityCount = Math.ceil(A_SHARE_EQUITY_ASSETS.length * 0.75);
        if (assetCount === 0 && btcSettled.status === 'rejected' && fearGreedSettled.status === 'rejected') {
            throw new Error('No macro assets could be fetched');
        }

        const payload: MacroSourcePayload = {
            updatedAt: new Date().toISOString(),
            assets,
            usEquities,
            hkEquities,
            aShareEquities,
            fearGreed: fearGreedResult,
            btc: btcResult,
            ethBtc: ethBtcResult,
            etfFlow: etfFlowResult.snapshot
                ? {
                    ...etfFlowResult.snapshot,
                    btcPrice: btcResult.price,
                }
                : undefined,
        };

        const etfSourceStatus = buildEtfFlowSourceStatus(etfFlowResult);
        const sourceStatus: MacroSourceStatus[] = [
            {
                key: 'market',
                label: '跨市场行情',
                provider: 'Yahoo Finance',
                status: assetCount >= minimumAssetCount ? 'live' : assetCount > 0 ? 'fallback' : 'unavailable',
                detail: `${assetCount} 个市场读数`,
                errorKind: assetCount > 0
                    ? undefined
                    : yahooAssetResults.status === 'rejected'
                        ? classifyMacroErrorKind(yahooAssetResults.reason)
                        : 'empty_response',
                updatedAt: Date.now(),
                dataTimestamp: latestMarketDataTimestamp,
                latencyMs: yahooAssetResults.latencyMs,
                freshness: classifyMacroFreshness(latestMarketDataTimestamp, Date.now(), 'intraday'),
            },
            {
                key: 'us-equities',
                label: '美股观察',
                provider: 'Yahoo Finance',
                status: usEquityCount >= minimumUsEquityCount ? 'live' : usEquityCount > 0 ? 'fallback' : 'unavailable',
                detail: `${usEquityCount} 个美股读数`,
                errorKind: usEquityCount > 0
                    ? undefined
                    : usEquityResults.status === 'rejected'
                        ? classifyMacroErrorKind(usEquityResults.reason)
                        : 'empty_response',
                updatedAt: Date.now(),
                dataTimestamp: latestUsEquityTimestamp,
                latencyMs: usEquityResults.latencyMs,
                freshness: classifyMacroFreshness(latestUsEquityTimestamp, Date.now(), 'daily'),
            },
            {
                key: 'hk-equities',
                label: '港股观察',
                provider: 'Yahoo Finance',
                status: hkEquityCount >= minimumHkEquityCount ? 'live' : hkEquityCount > 0 ? 'fallback' : 'unavailable',
                detail: `${hkEquityCount} 个港股读数`,
                errorKind: hkEquityCount > 0
                    ? undefined
                    : hkEquityResults.status === 'rejected'
                        ? classifyMacroErrorKind(hkEquityResults.reason)
                        : 'empty_response',
                updatedAt: Date.now(),
                dataTimestamp: latestHkEquityTimestamp,
                latencyMs: hkEquityResults.latencyMs,
                freshness: classifyMacroFreshness(latestHkEquityTimestamp, Date.now(), 'daily'),
            },
            {
                key: 'a-share-equities',
                label: 'A股观察',
                provider: 'Yahoo Finance',
                status: aShareEquityCount >= minimumAShareEquityCount ? 'live' : aShareEquityCount > 0 ? 'fallback' : 'unavailable',
                detail: `${aShareEquityCount} 个A股读数`,
                errorKind: aShareEquityCount > 0
                    ? undefined
                    : aShareEquityResults.status === 'rejected'
                        ? classifyMacroErrorKind(aShareEquityResults.reason)
                        : 'empty_response',
                updatedAt: Date.now(),
                dataTimestamp: latestAShareEquityTimestamp,
                latencyMs: aShareEquityResults.latencyMs,
                freshness: classifyMacroFreshness(latestAShareEquityTimestamp, Date.now(), 'daily'),
            },
            {
                key: 'fear-greed',
                label: '恐贪指数',
                provider: 'Alternative.me',
                status: fearGreedSettled.status === 'fulfilled' ? 'live' : 'unavailable',
                detail: fearGreedResult.valueText || fearGreedResult.value.toString(),
                errorKind: sourceErrorKinds.fearGreed,
                updatedAt: Date.now(),
                dataTimestamp: fearGreedResult.timestamp,
                latencyMs: fearGreedSettled.latencyMs,
                freshness: classifyMacroFreshness(fearGreedResult.timestamp, Date.now(), 'daily'),
            },
            {
                key: 'btc',
                label: 'BTC 行情与费率',
                provider: 'Binance Futures',
                status: btcSettled.status === 'fulfilled' ? 'live' : 'unavailable',
                detail: btcSettled.status === 'fulfilled' ? `BTC ${btcResult.price.toFixed(0)}` : 'BTC 数据暂不可用',
                errorKind: sourceErrorKinds.btc,
                updatedAt: Date.now(),
                dataTimestamp: btcDataTimestamp,
                latencyMs: btcSettled.latencyMs,
                freshness: classifyMacroFreshness(btcDataTimestamp, Date.now(), 'realtime'),
            },
            {
                key: 'eth-btc',
                label: 'ETH/BTC 强弱',
                provider: 'Binance Spot',
                status: ethBtcSettled.status === 'fulfilled' ? 'live' : 'unavailable',
                detail: ethBtcSettled.status === 'fulfilled' ? `ETHBTC ${ethBtcResult.price.toFixed(5)}` : 'ETH/BTC 暂不可用',
                errorKind: sourceErrorKinds.ethBtc,
                updatedAt: Date.now(),
                dataTimestamp: ethBtcResult.dataTimestamp,
                latencyMs: ethBtcSettled.latencyMs,
                freshness: classifyMacroFreshness(ethBtcResult.dataTimestamp, Date.now(), 'realtime'),
            },
            {
                ...etfSourceStatus,
                status: etfFlowSettled.status === 'fulfilled' ? etfSourceStatus.status : 'unavailable',
                errorKind: sourceErrorKinds.etf ?? etfSourceStatus.errorKind,
                updatedAt: Date.now(),
                latencyMs: etfFlowSettled.latencyMs,
                freshness: classifyMacroFreshness(etfSourceStatus.dataTimestamp, Date.now(), 'daily'),
            },
        ];

        const dashboard = buildMacroDashboard(payload);
        dashboard.sourceStatus = sourceStatus;
        dashboard.dataQuality = sourceStatus.every((source) => source.status === 'live')
            ? 'enriched'
            : sourceStatus.some((source) => source.status === 'live' || source.status === 'fallback')
                ? 'partial'
                : 'unavailable';

        return NextResponse.json(dashboard, {
            headers: {
                'Cache-Control': 'public, s-maxage=30, stale-while-revalidate=60',
            },
        });
    } catch (error) {
        logger.error('Failed to build macro dashboard', error as Error);
        return NextResponse.json({ error: 'Failed to fetch macro dashboard' }, { status: 500 });
    }
}
