import { NextResponse } from 'next/server';
import { withTimeout } from '@/lib/async';
import { TickerData, PremiumIndex } from '@/lib/types';
import { historicalTracker } from '@/lib/historicalTracker';
import { fetchKlinesBatch, enhanceTickerData, getBTCReturns } from '@/lib/indicatorEnhancer';
import { APP_CONFIG } from '@/lib/config';
import { logger } from '@/lib/logger';
import { fetchBinanceJson } from '@/lib/binanceApi';
import { fetchOpenInterestMarketSnapshotsBatch } from '@/lib/openInterest';

let lastSuccessfulMarketData: TickerData[] | null = null;
let lastSuccessfulAt = 0;
let liveMarketCache: { time: number; data: TickerData[] } | null = null;
let inflightMarketBuild: Promise<TickerData[]> | null = null;

const LIVE_CACHE_DURATION = 5000;
const MARKET_BUILD_TIMEOUT_MS = 15000;
const MARKET_FALLBACK_TIMEOUT_MS = 6000;

function ensureMarketBuild(): Promise<TickerData[]> {
    if (!inflightMarketBuild) {
        inflightMarketBuild = buildMarketData().finally(() => {
            inflightMarketBuild = null;
        });
    }

    return inflightMarketBuild;
}

interface BinanceExchangeInfoSymbol {
    symbol: string;
    contractType: string;
    status: string;
}

interface BinanceExchangeInfoResponse {
    symbols: BinanceExchangeInfoSymbol[];
}

async function fetchBaseMarketData(): Promise<TickerData[]> {
    const results = await Promise.allSettled([
        fetchBinanceJson<TickerData[]>('/fapi/v1/ticker/24hr', { revalidate: 5 }),
        fetchBinanceJson<PremiumIndex[]>('/fapi/v1/premiumIndex', { revalidate: 5 }),
        fetchBinanceJson<BinanceExchangeInfoResponse>('/fapi/v1/exchangeInfo', { revalidate: 86400 }), // Cache for 24 hours (exchange info rarely changes)
    ]);

    // Check if critical endpoints succeeded (ticker + premium are required)
    if (results[0].status === 'rejected' || results[1].status === 'rejected') {
        logger.error('Failed to fetch critical data from Binance', new Error('Ticker or premium index endpoint failed'));
        throw new Error('Failed to fetch data from Binance and no cache available');
    }

    const tickers = results[0].value;
    const premiums = results[1].value;

    // exchangeInfo is optional (cached 24h, rarely fails but shouldn't break everything)
    let perpetualSymbols: Set<string> | null = null;
    if (results[2].status === 'fulfilled' && Array.isArray(results[2].value.symbols)) {
        const exchangeInfo = results[2].value;
        const validSymbolSet = new Set<string>();
        exchangeInfo.symbols.forEach((s: any) => {
            if ((s.contractType === 'PERPETUAL' || s.contractType === 'TRADIFI_PERPETUAL') && s.status === 'TRADING' && s.symbol.endsWith('USDT')) {
                validSymbolSet.add(s.symbol);
            }
        });
        perpetualSymbols = validSymbolSet;
    } else {
        logger.warn('exchangeInfo fetch failed, skipping perpetual filter');
    }

    // Map funding rate to tickers
    const fundingMap = new Map<string, string>();
    const markPriceMap = new Map<string, string>();
    premiums.forEach((p: PremiumIndex) => {
        fundingMap.set(p.symbol, p.lastFundingRate);
        markPriceMap.set(p.symbol, p.markPrice);
    });

    // Filter only PERPETUAL contracts (if exchangeInfo available) and merge data
    return tickers
        .filter((t: TickerData) => perpetualSymbols ? perpetualSymbols.has(t.symbol) : t.symbol.endsWith('USDT'))
        .map((t: TickerData) => ({
            ...t,
            markPrice: markPriceMap.get(t.symbol) || t.lastPrice,
            fundingRate: fundingMap.get(t.symbol) || '0',
        }));
}

async function buildMarketData(): Promise<TickerData[]> {
    let merged = await fetchBaseMarketData();

    // ========== 🔥 技术指标增强（分级计算） ==========

    // 1. 动态筛选需要完整增强的币种
    const oiTickerInputs = merged.map((ticker) => ({
        symbol: ticker.symbol,
        price: ticker.markPrice || ticker.lastPrice,
    }));

    const [btcReturns, oiSnapshotMap] = await Promise.all([
        getBTCReturns(),
        fetchOpenInterestMarketSnapshotsBatch(oiTickerInputs, 25),
    ]);

    const sortedByVolume = merged
        .sort((a, b) => parseFloat(b.quoteVolume) - parseFloat(a.quoteVolume));

    const eligibleTickerInputs = sortedByVolume
        .filter((ticker) => {
            const quoteVolume = parseFloat(ticker.quoteVolume || '0');
            const oiSnapshot = oiSnapshotMap.get(ticker.symbol);
            const openInterestValue = parseFloat(oiSnapshot?.currentOpenInterestValue || '0');

            return (
                quoteVolume >= APP_CONFIG.INDICATORS.MIN_QUOTE_VOLUME_FOR_FULL_INDICATORS ||
                openInterestValue >= APP_CONFIG.INDICATORS.MIN_OPEN_INTEREST_VALUE_FOR_FULL_INDICATORS
            );
        })
        .map((ticker) => ({
            symbol: ticker.symbol,
            price: ticker.markPrice || ticker.lastPrice,
        }));

    const eligibleSymbols = eligibleTickerInputs.map((ticker) => ticker.symbol);

    // 2. 仅为通过流动性筛选的币种批量获取 K 线数据
    const [klinesMap, trend5mKlinesMap, daily1dKlinesMap] = await Promise.all([
        fetchKlinesBatch(eligibleSymbols, APP_CONFIG.API.BATCH_SIZE, '15m', 50),
        fetchKlinesBatch(eligibleSymbols, APP_CONFIG.API.BATCH_SIZE, '5m', 120),
        fetchKlinesBatch(eligibleSymbols, APP_CONFIG.API.BATCH_SIZE, '1d', 30),
    ]);

    logger.info('Built market enhancement universe', {
        totalSymbols: merged.length,
        eligibleSymbols: eligibleSymbols.length,
        minQuoteVolume: APP_CONFIG.INDICATORS.MIN_QUOTE_VOLUME_FOR_FULL_INDICATORS,
        minOpenInterestValue: APP_CONFIG.INDICATORS.MIN_OPEN_INTEREST_VALUE_FOR_FULL_INDICATORS,
    });

    // 3. 增强数据（添加技术指标）
    merged = merged.map(ticker => {
        const klines = klinesMap.get(ticker.symbol);
        const oiSnapshot = oiSnapshotMap.get(ticker.symbol);
        const trend5mKlines = trend5mKlinesMap.get(ticker.symbol);
        const daily1dKlines = daily1dKlinesMap.get(ticker.symbol);
        const canEnhance = Boolean(
            (klines && klines.length > 0) ||
            (trend5mKlines && trend5mKlines.length > 0) ||
            (daily1dKlines && daily1dKlines.length > 0)
        );
        const enhanced = canEnhance
            ? enhanceTickerData(ticker, klines || [], btcReturns, {
                trend5m: trend5mKlines,
                daily1d: daily1dKlines,
            })
            : ticker;

        return {
            ...enhanced,
            markPrice: enhanced.markPrice || ticker.markPrice || ticker.lastPrice,
            fundingRate: enhanced.fundingRate || '0',
            openInterest: oiSnapshot?.currentOpenInterest || enhanced.openInterest,
            openInterestValue: oiSnapshot?.currentOpenInterestValue || enhanced.openInterestValue,
        };
    });

    // ========== 🔥 历史数据追踪 ==========

    // 4. 添加历史快照并计算变化率
    merged = merged.map(ticker => {
        const oiSnapshot = oiSnapshotMap.get(ticker.symbol);
        const oiValue = parseFloat(ticker.openInterestValue || '0');
        const volume = parseFloat(ticker.quoteVolume || '0');
        const fundingRate = parseFloat(ticker.fundingRate || '0');

        historicalTracker.addSnapshot(ticker.symbol, {
            openInterestValue: oiValue,
            volume,
            fundingRate
        });

        const changes = historicalTracker.getChangePercent(ticker.symbol);

        return {
            ...ticker,
            markPrice: ticker.markPrice || ticker.lastPrice,
            fundingRate: ticker.fundingRate || '0',
            oiChangePercent: oiSnapshot?.changePercent4h,
            volumeChangePercent: changes.volumeChangePercent,
            fundingRateVelocity: changes.fundingRateVelocity,
            fundingRateTrend: changes.fundingRateTrend
        };
    });

    historicalTracker.cleanup();

    liveMarketCache = { time: Date.now(), data: merged };
    lastSuccessfulMarketData = merged;
    lastSuccessfulAt = Date.now();

    return merged;
}

export async function GET() {
    const now = Date.now();
    if (liveMarketCache && (now - liveMarketCache.time < LIVE_CACHE_DURATION)) {
        return NextResponse.json(liveMarketCache.data, {
            headers: {
                'Cache-Control': 'public, s-maxage=3, stale-while-revalidate=10',
                'X-Data-Source': 'memory-cache',
            }
        });
    }

    if (lastSuccessfulMarketData && lastSuccessfulMarketData.length > 0) {
        void ensureMarketBuild().catch((error) => {
            logger.error('Background market refresh failed', error as Error);
        });

        return NextResponse.json(lastSuccessfulMarketData, {
            headers: {
                'Cache-Control': 'public, s-maxage=3, stale-while-revalidate=10',
                'X-Data-Source': 'stale-memory-cache-refreshing',
                'X-Cache-Age-Seconds': Math.floor((Date.now() - lastSuccessfulAt) / 1000).toString(),
            }
        });
    }

    const ownsInflight = !inflightMarketBuild;
    try {
        const data = await withTimeout(
            ensureMarketBuild(),
            MARKET_BUILD_TIMEOUT_MS,
            'market build'
        );
        return NextResponse.json(data, {
            headers: {
                'Cache-Control': 'public, s-maxage=3, stale-while-revalidate=10',
                'X-Data-Source': ownsInflight ? 'live' : 'live-coalesced',
            }
        });
    } catch (error) {
        logger.error('Error fetching market data', error as Error);
        if (lastSuccessfulMarketData && lastSuccessfulMarketData.length > 0) {
            return NextResponse.json(lastSuccessfulMarketData, {
                headers: {
                    'Cache-Control': 'public, s-maxage=2, stale-while-revalidate=10',
                    'X-Data-Source': 'stale-memory-cache',
                    'X-Cache-Age-Seconds': Math.floor((Date.now() - lastSuccessfulAt) / 1000).toString(),
                }
            });
        }

        try {
            const fallbackData = await withTimeout(
                fetchBaseMarketData(),
                MARKET_FALLBACK_TIMEOUT_MS,
                'market light fallback'
            );
            liveMarketCache = { time: Date.now(), data: fallbackData };
            lastSuccessfulMarketData = fallbackData;
            lastSuccessfulAt = Date.now();

            return NextResponse.json(fallbackData, {
                headers: {
                    'Cache-Control': 'public, s-maxage=3, stale-while-revalidate=10',
                    'X-Data-Source': 'light-fallback',
                }
            });
        } catch (fallbackError) {
            logger.error('Market light fallback failed', fallbackError as Error);
        }

        return NextResponse.json({ error: 'Failed to fetch market data' }, { status: 500 });
    }
}
