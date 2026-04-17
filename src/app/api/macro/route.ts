import { NextResponse } from 'next/server';

import { fetchBinanceJson } from '@/lib/binanceApi';
import { logger } from '@/lib/logger';
import {
    buildMacroDashboard,
    parseBitboBtcEtfFlowHtml,
    parseBtcEtfFlowText,
    type BtcEtfFlowSnapshot,
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
                previousClose?: number;
                chartPreviousClose?: number;
            };
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
    }>;
}

interface Binance24hTicker {
    lastPrice: string;
    priceChangePercent: string;
    highPrice: string;
    lowPrice: string;
}

interface BinancePremiumIndex {
    lastFundingRate: string;
}

interface YahooAssetConfig {
    symbol: string;
    label: string;
    market: string;
    querySymbols?: string[];
    normalizePrice?: (value: number) => number;
}

const YAHOO_ASSETS: YahooAssetConfig[] = [
    { symbol: '^GSPC', label: '标普500指数', market: '美股' },
    { symbol: '^IXIC', label: '纳斯达克综合指数', market: '美股' },
    { symbol: '^NDX', label: '纳斯达克100', market: '美股' },
    { symbol: 'XAUUSD=X', label: '伦敦金', market: '大宗商品', querySymbols: ['XAUUSD=X', 'GC=F'] },
    { symbol: 'XAGUSD=X', label: '伦敦银', market: '大宗商品', querySymbols: ['XAGUSD=X', 'SI=F'] },
    { symbol: 'CL=F', label: 'WTI原油', market: '大宗商品' },
    { symbol: 'BZ=F', label: '布伦特原油', market: '大宗商品' },
    { symbol: 'IBIT', label: 'BTC现货ETF', market: '数字资产 ETF' },
    { symbol: 'ETHA', label: 'ETH现货ETF', market: '数字资产 ETF' },
    { symbol: '000001.SS', label: '上证指数', market: '中韩日指数' },
    { symbol: '^KS11', label: '韩国KOSPI', market: '中韩日指数' },
    { symbol: '^N225', label: '日经225', market: '中韩日指数' },
    { symbol: '^VIX', label: 'VIX', market: '监控' },
    { symbol: 'DX-Y.NYB', label: 'DXY', market: '监控' },
    { symbol: '^TNX', label: 'US10Y', market: '监控' },
];

const ETF_FLOWS_URL = 'https://farside.co.uk/btc/';
const ETF_FLOWS_BITBO_URL = 'https://bitbo.io/treasuries/etf-flows/';

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

async function fetchYahooAsset(asset: YahooAssetConfig): Promise<MacroSourceAsset | null> {
    const querySymbols = asset.querySymbols && asset.querySymbols.length > 0 ? asset.querySymbols : [asset.symbol];
    let lastError: unknown;

    for (const querySymbol of querySymbols) {
        try {
            const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(querySymbol)}?interval=1d&range=5d&includePrePost=false`;
            const response = await fetch(url, {
                headers: {
                    'User-Agent': 'Mozilla/5.0',
                    'Accept': 'application/json',
                },
                next: { revalidate: 300 },
            });

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
            const previousCloseRaw = result.meta?.chartPreviousClose ?? result.meta?.previousClose ?? (closes.length > 1 ? closes[closes.length - 2] : undefined);

            if (!Number.isFinite(priceRaw)) {
                continue;
            }

            const resolvedPriceRaw = priceRaw as number;
            const price = asset.normalizePrice ? asset.normalizePrice(resolvedPriceRaw) : resolvedPriceRaw;
            const previousClose = Number.isFinite(previousCloseRaw)
                ? (asset.normalizePrice ? asset.normalizePrice(previousCloseRaw as number) : (previousCloseRaw as number))
                : undefined;
            const changePercent = previousClose && previousClose !== 0
                ? ((price - previousClose) / previousClose) * 100
                : 0;

            return {
                symbol: asset.symbol,
                label: asset.label,
                market: asset.market,
                price,
                changePercent,
            };
        } catch (error) {
            lastError = error;
        }
    }

    if (lastError) {
        throw lastError;
    }

    return null;
}

async function fetchFearGreed(): Promise<FearGreedSnapshot> {
    const response = await fetch('https://api.alternative.me/fng/?limit=1&format=json', {
        next: { revalidate: 1800 },
    });

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
    };
}

async function fetchBtcSnapshot() {
    const [ticker, premium, lsRatioData] = await Promise.all([
        fetchBinanceJson<Binance24hTicker>('/fapi/v1/ticker/24hr?symbol=BTCUSDT', { revalidate: 30 }),
        fetchBinanceJson<BinancePremiumIndex>('/fapi/v1/premiumIndex?symbol=BTCUSDT', { revalidate: 30 }),
        fetchBinanceJson<Array<{ longShortRatio: string }>>('/futures/data/globalLongShortAccountRatio?symbol=BTCUSDT&period=1d', { revalidate: 300 }),
    ]);

    const lsRatio = (Array.isArray(lsRatioData) && lsRatioData.length > 0)
        ? Number.parseFloat(lsRatioData[lsRatioData.length - 1].longShortRatio)
        : 1.5; // fallback

    return {
        price: Number.parseFloat(ticker.lastPrice),
        changePercent: Number.parseFloat(ticker.priceChangePercent),
        high24h: Number.parseFloat(ticker.highPrice),
        low24h: Number.parseFloat(ticker.lowPrice),
        fundingRate: Number.parseFloat(premium.lastFundingRate) * 100,
        longShortRatio: lsRatio,
    };
}

async function fetchEthBtcSnapshot() {
    const ticker = await fetchBinanceJson<Binance24hTicker>('/api/v3/ticker/24hr?symbol=ETHBTC', { revalidate: 30 });
    return {
        price: Number.parseFloat(ticker.lastPrice),
        changePercent: Number.parseFloat(ticker.priceChangePercent),
    };
}

async function fetchBtcEtfFlow(): Promise<BtcEtfFlowSnapshot | undefined> {
    try {
        const response = await fetch(ETF_FLOWS_URL, {
            headers: {
                'User-Agent': 'Mozilla/5.0',
                'Accept': 'text/html,application/xhtml+xml',
            },
            next: { revalidate: 60 * 60 },
        });

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
    }

    try {
        const response = await fetch(ETF_FLOWS_BITBO_URL, {
            headers: {
                'User-Agent': 'Mozilla/5.0',
                'Accept': 'text/html,application/xhtml+xml',
            },
            next: { revalidate: 60 * 60 },
        });

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

export async function GET() {
    try {
        const [fearGreedResult, btcResult, ethBtcResult, etfFlowResult, yahooAssetResults] = await Promise.all([
            fetchFearGreed(),
            fetchBtcSnapshot(),
            fetchEthBtcSnapshot(),
            fetchBtcEtfFlow(),
            Promise.allSettled(YAHOO_ASSETS.map((asset) => fetchYahooAsset(asset))),
        ]);

        const assets = Object.fromEntries(
            yahooAssetResults
                .map((result) => result.status === 'fulfilled' ? result.value : null)
                .filter((asset): asset is MacroSourceAsset => Boolean(asset))
                .map((asset) => [asset.symbol, asset])
        );

        if (Object.keys(assets).length === 0) {
            throw new Error('No macro assets could be fetched');
        }

        const payload: MacroSourcePayload = {
            updatedAt: new Date().toISOString(),
            assets,
            fearGreed: fearGreedResult,
            btc: btcResult,
            ethBtc: ethBtcResult,
            etfFlow: etfFlowResult
                ? {
                    ...etfFlowResult,
                    btcPrice: btcResult.price,
                }
                : undefined,
        };

        const sourceStatus: MacroSourceStatus[] = [
            {
                key: 'market',
                label: '跨市场行情',
                provider: 'Yahoo Finance',
                status: Object.keys(assets).length >= Math.ceil(YAHOO_ASSETS.length * 0.75) ? 'live' : 'fallback',
                detail: `${Object.keys(assets).length} 个市场读数`,
            },
            {
                key: 'fear-greed',
                label: '恐贪指数',
                provider: 'Alternative.me',
                status: 'live',
                detail: fearGreedResult.valueText || fearGreedResult.value.toString(),
            },
            {
                key: 'btc',
                label: 'BTC 行情与费率',
                provider: 'Binance Futures',
                status: 'live',
                detail: `BTC ${btcResult.price.toFixed(0)}`,
            },
            {
                key: 'etf',
                label: 'ETF 资金流',
                provider: etfFlowResult?.provider === 'Bitbo' ? 'Bitbo (fallback)' : etfFlowResult?.provider || 'Unavailable',
                status: etfFlowResult ? (etfFlowResult.provider === 'Bitbo' ? 'fallback' : 'live') : 'unavailable',
                detail: etfFlowResult ? etfFlowResult.date : '暂无可用源',
            },
        ];

        const dashboard = buildMacroDashboard(payload);
        dashboard.sourceStatus = sourceStatus;

        return NextResponse.json(dashboard, {
            headers: {
                'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300',
            },
        });
    } catch (error) {
        logger.error('Failed to build macro dashboard', error as Error);
        return NextResponse.json({ error: 'Failed to fetch macro dashboard' }, { status: 500 });
    }
}
