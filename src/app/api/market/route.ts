import { NextResponse } from 'next/server';
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

const LIVE_CACHE_DURATION = 2500;

interface BinanceExchangeInfoSymbol {
    symbol: string;
    contractType: string;
    status: string;
}

interface BinanceExchangeInfoResponse {
    symbols: BinanceExchangeInfoSymbol[];
}

async function buildMarketData(): Promise<TickerData[]> {
    // Use allSettled + multi-base fallback for better resilience.
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
        perpetualSymbols = new Set(
            exchangeInfo.symbols
                .filter((s) => {
                    return s.contractType === 'PERPETUAL' &&
                        s.status === 'TRADING' &&
                        s.symbol.endsWith('USDT');
                })
                .map((s) => s.symbol)
        );
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
    let merged = tickers
        .filter((t: TickerData) => perpetualSymbols ? perpetualSymbols.has(t.symbol) : t.symbol.endsWith('USDT'))
        .map((t: TickerData) => ({
            ...t,
            markPrice: markPriceMap.get(t.symbol) || t.lastPrice,
            fundingRate: fundingMap.get(t.symbol) || '0',
        }));

    // ========== 🔥 技术指标增强（分级计算） ==========

    // 1. 获取 BTC 参考数据（用于 Beta 计算）
    const btcReturns = await getBTCReturns();

    // 2. 按成交量排序，确定需要计算指标的币种
    const sortedByVolume = merged
        .sort((a, b) => parseFloat(b.quoteVolume) - parseFloat(a.quoteVolume));

    const topTickerInputs = sortedByVolume
        .slice(0, APP_CONFIG.INDICATORS.TOP_SYMBOLS_FOR_INDICATORS)
        .map((ticker) => ({
            symbol: ticker.symbol,
            price: ticker.markPrice || ticker.lastPrice,
        }));

    const oiTickerInputs = merged.map((ticker) => ({
        symbol: ticker.symbol,
        price: ticker.markPrice || ticker.lastPrice,
    }));

    const topSymbols = topTickerInputs.map((ticker) => ticker.symbol);

    // 3. 批量获取 K 线数据（使用配置的批大小）
    const [klinesMap, oiSnapshotMap] = await Promise.all([
        fetchKlinesBatch(topSymbols, APP_CONFIG.API.BATCH_SIZE),
        fetchOpenInterestMarketSnapshotsBatch(oiTickerInputs, 25),
    ]);

    // 4. 增强数据（添加技术指标）
    merged = merged.map(ticker => {
        const klines = klinesMap.get(ticker.symbol);
        const oiSnapshot = oiSnapshotMap.get(ticker.symbol);

        // 🔥 分级计算：只为有K线数据的币种计算指标
        if (klines && klines.length >= APP_CONFIG.INDICATORS.MIN_KLINES_FOR_SQUEEZE) {
            const enhanced = enhanceTickerData(ticker, klines, btcReturns);
            return {
                ...enhanced,
                markPrice: enhanced.markPrice || ticker.markPrice || ticker.lastPrice,
                fundingRate: enhanced.fundingRate || '0',
                openInterest: oiSnapshot?.currentOpenInterest || enhanced.openInterest,
                openInterestValue: oiSnapshot?.currentOpenInterestValue || enhanced.openInterestValue,
            };
        }

        return {
            ...ticker,
            markPrice: ticker.markPrice || ticker.lastPrice,
            fundingRate: ticker.fundingRate || '0',
            openInterest: oiSnapshot?.currentOpenInterest || ticker.openInterest,
            openInterestValue: oiSnapshot?.currentOpenInterestValue || ticker.openInterestValue,
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

    const ownsInflight = !inflightMarketBuild;
    if (!inflightMarketBuild) {
        inflightMarketBuild = buildMarketData();
    }

    try {
        const data = await inflightMarketBuild;
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
        return NextResponse.json({ error: 'Failed to fetch market data' }, { status: 500 });
    } finally {
        if (ownsInflight) {
            inflightMarketBuild = null;
        }
    }
}
