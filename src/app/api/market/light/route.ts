import { NextResponse } from 'next/server';
import { TickerData, PremiumIndex } from '@/lib/types';
import { fetchBinanceJson } from '@/lib/binanceApi';
import { logger } from '@/lib/logger';

interface BinanceExchangeInfoSymbol {
    symbol: string;
    contractType: string;
    status: string;
}

interface BinanceExchangeInfoResponse {
    symbols: BinanceExchangeInfoSymbol[];
}

let lightMarketCache: { time: number; data: TickerData[] } | null = null;
let lastSuccessfulLightMarketData: TickerData[] | null = null;
let lastSuccessfulLightMarketAt = 0;
let inflightLightMarketBuild: Promise<TickerData[]> | null = null;

const LIVE_CACHE_DURATION = 3000;

async function buildLightMarketData(): Promise<TickerData[]> {
    const results = await Promise.allSettled([
        fetchBinanceJson<TickerData[]>('/fapi/v1/ticker/24hr', { revalidate: 5 }),
        fetchBinanceJson<PremiumIndex[]>('/fapi/v1/premiumIndex', { revalidate: 5 }),
        fetchBinanceJson<BinanceExchangeInfoResponse>('/fapi/v1/exchangeInfo', { revalidate: 86400 }),
    ]);

    if (results[0].status === 'rejected' || results[1].status === 'rejected') {
        throw new Error('Failed to fetch light market data from Binance');
    }

    const tickers = results[0].value;
    const premiums = results[1].value;

    let perpetualSymbols: Set<string> | null = null;
    if (results[2].status === 'fulfilled' && Array.isArray(results[2].value.symbols)) {
        perpetualSymbols = new Set(
            results[2].value.symbols
                .filter((symbol) =>
                    (symbol.contractType === 'PERPETUAL' || symbol.contractType === 'TRADIFI_PERPETUAL') &&
                    symbol.status === 'TRADING' &&
                    symbol.symbol.endsWith('USDT')
                )
                .map((symbol) => symbol.symbol)
        );
    }

    const fundingMap = new Map<string, string>();
    const markPriceMap = new Map<string, string>();
    premiums.forEach((premium) => {
        fundingMap.set(premium.symbol, premium.lastFundingRate);
        markPriceMap.set(premium.symbol, premium.markPrice);
    });

    const merged = tickers
        .filter((ticker) => perpetualSymbols ? perpetualSymbols.has(ticker.symbol) : ticker.symbol.endsWith('USDT'))
        .map((ticker) => ({
            ...ticker,
            markPrice: markPriceMap.get(ticker.symbol) || ticker.lastPrice,
            fundingRate: fundingMap.get(ticker.symbol) || '0',
        }));

    lightMarketCache = { time: Date.now(), data: merged };
    lastSuccessfulLightMarketData = merged;
    lastSuccessfulLightMarketAt = Date.now();

    return merged;
}

function ensureLightMarketBuild(): Promise<TickerData[]> {
    if (!inflightLightMarketBuild) {
        inflightLightMarketBuild = buildLightMarketData().finally(() => {
            inflightLightMarketBuild = null;
        });
    }

    return inflightLightMarketBuild;
}

export async function GET() {
    const now = Date.now();
    if (lightMarketCache && now - lightMarketCache.time < LIVE_CACHE_DURATION) {
        return NextResponse.json(lightMarketCache.data, {
            headers: {
                'Cache-Control': 'public, s-maxage=3, stale-while-revalidate=10',
                'X-Data-Source': 'memory-cache',
            }
        });
    }

    if (lastSuccessfulLightMarketData && lastSuccessfulLightMarketData.length > 0) {
        void ensureLightMarketBuild().catch((error) => {
            logger.error('Background light market refresh failed', error as Error);
        });

        return NextResponse.json(lastSuccessfulLightMarketData, {
            headers: {
                'Cache-Control': 'public, s-maxage=3, stale-while-revalidate=10',
                'X-Data-Source': 'stale-memory-cache-refreshing',
                'X-Cache-Age-Seconds': Math.floor((Date.now() - lastSuccessfulLightMarketAt) / 1000).toString(),
            }
        });
    }

    try {
        const data = await ensureLightMarketBuild();
        return NextResponse.json(data, {
            headers: {
                'Cache-Control': 'public, s-maxage=3, stale-while-revalidate=10',
                'X-Data-Source': 'live',
            }
        });
    } catch (error) {
        logger.error('Failed to fetch light market data', error as Error);
        return NextResponse.json({ error: 'Failed to fetch market data' }, { status: 500 });
    }
}
