import { TickerData, PremiumIndex } from '@/lib/types';
import { historicalTracker } from '@/lib/historicalTracker';
import { fetchKlinesBatch, enhanceTickerData, getBTCReturns } from '@/lib/indicatorEnhancer';
import { APP_CONFIG } from '@/lib/config';
import { logger } from '@/lib/logger';
import { fetchBinanceJson } from '@/lib/binanceApi';
import { fetchOpenInterestMarketSnapshotsBatch } from '@/lib/openInterest';
import { WEI_SHEN_UNIVERSE } from '@/lib/weiShenUniverse';
import { buildWeiShenContext, getWeiShenTimeframes } from '@/lib/weiShenStrategy';

interface BinanceExchangeInfoSymbol {
    symbol: string;
    contractType: string;
    status: string;
}

interface BinanceExchangeInfoResponse {
    symbols: BinanceExchangeInfoSymbol[];
}

interface MarketTickerInput {
    symbol: string;
    price: string;
}

interface MarketEnhancementResources {
    btcReturns: number[];
    oiSnapshotMap: Awaited<ReturnType<typeof fetchOpenInterestMarketSnapshotsBatch>>;
    klinesMap: Awaited<ReturnType<typeof fetchKlinesBatch>>;
    trend5mKlinesMap: Awaited<ReturnType<typeof fetchKlinesBatch>>;
    daily1dKlinesMap: Awaited<ReturnType<typeof fetchKlinesBatch>>;
    wei1hKlinesMap: Awaited<ReturnType<typeof fetchKlinesBatch>>;
    wei4hKlinesMap: Awaited<ReturnType<typeof fetchKlinesBatch>>;
    wei1dKlinesMap: Awaited<ReturnType<typeof fetchKlinesBatch>>;
}

export async function fetchBaseMarketData(): Promise<TickerData[]> {
    const results = await Promise.allSettled([
        fetchBinanceJson<TickerData[]>('/fapi/v1/ticker/24hr', { revalidate: 5 }),
        fetchBinanceJson<PremiumIndex[]>('/fapi/v1/premiumIndex', { revalidate: 5 }),
        fetchBinanceJson<BinanceExchangeInfoResponse>('/fapi/v1/exchangeInfo?v=2', { revalidate: 3600 }),
    ]);

    if (results[0].status === 'rejected' || results[1].status === 'rejected') {
        logger.error('Failed to fetch critical data from Binance', new Error('Ticker or premium index endpoint failed'));
        throw new Error('Failed to fetch data from Binance and no cache available');
    }

    const tickers = results[0].value;
    const premiums = results[1].value;

    let perpetualSymbols: Set<string> | null = null;
    if (results[2].status === 'fulfilled' && Array.isArray(results[2].value.symbols)) {
        const exchangeInfo = results[2].value;
        const validSymbolSet = new Set<string>();
        exchangeInfo.symbols.forEach((symbolInfo) => {
            if (
                (symbolInfo.contractType === 'PERPETUAL' || symbolInfo.contractType === 'TRADIFI_PERPETUAL') &&
                symbolInfo.status === 'TRADING' &&
                symbolInfo.symbol.endsWith('USDT')
            ) {
                validSymbolSet.add(symbolInfo.symbol);
            }
        });
        perpetualSymbols = validSymbolSet;
    } else {
        logger.warn('exchangeInfo fetch failed, skipping perpetual filter');
    }

    const fundingMap = new Map<string, string>();
    const markPriceMap = new Map<string, string>();
    premiums.forEach((premium) => {
        fundingMap.set(premium.symbol, premium.lastFundingRate);
        markPriceMap.set(premium.symbol, premium.markPrice);
    });

    return tickers
        .filter((ticker) => perpetualSymbols ? perpetualSymbols.has(ticker.symbol) : ticker.symbol.endsWith('USDT'))
        .map((ticker) => ({
            ...ticker,
            markPrice: markPriceMap.get(ticker.symbol) || ticker.lastPrice,
            fundingRate: fundingMap.get(ticker.symbol) || '0',
        }));
}

function buildTickerInputs(tickers: TickerData[]): MarketTickerInput[] {
    return tickers.map((ticker) => ({
        symbol: ticker.symbol,
        price: ticker.markPrice || ticker.lastPrice,
    }));
}

function selectEligibleTickerInputs(
    tickers: TickerData[],
    oiSnapshotMap: MarketEnhancementResources['oiSnapshotMap']
): MarketTickerInput[] {
    return [...tickers]
        .sort((a, b) => parseFloat(b.quoteVolume) - parseFloat(a.quoteVolume))
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
}

function resolveWeiUniverseSymbols(tickers: TickerData[]): string[] {
    return tickers
        .filter((ticker) => WEI_SHEN_UNIVERSE.includes(ticker.symbol as (typeof WEI_SHEN_UNIVERSE)[number]))
        .map((ticker) => ticker.symbol);
}

function logEnhancementUniverse(totalSymbols: number, eligibleSymbols: string[]) {
    logger.info('Built market enhancement universe', {
        totalSymbols,
        eligibleSymbols: eligibleSymbols.length,
        minQuoteVolume: APP_CONFIG.INDICATORS.MIN_QUOTE_VOLUME_FOR_FULL_INDICATORS,
        minOpenInterestValue: APP_CONFIG.INDICATORS.MIN_OPEN_INTEREST_VALUE_FOR_FULL_INDICATORS,
    });
}

function buildWeiShenContextForTicker(
    ticker: TickerData,
    weiUniverseSet: Set<string>,
    weiShenResources: Pick<MarketEnhancementResources, 'wei1hKlinesMap' | 'wei4hKlinesMap' | 'wei1dKlinesMap'>
) {
    if (!weiUniverseSet.has(ticker.symbol)) {
        return null;
    }

    return buildWeiShenContext({
        symbol: ticker.symbol,
        signal1h: weiShenResources.wei1hKlinesMap.get(ticker.symbol) || [],
        confirm4h: weiShenResources.wei4hKlinesMap.get(ticker.symbol) || [],
        daily1d: weiShenResources.wei1dKlinesMap.get(ticker.symbol) || [],
        btc1h: weiShenResources.wei1hKlinesMap.get('BTCUSDT') || [],
        btc4h: weiShenResources.wei4hKlinesMap.get('BTCUSDT') || [],
        btc1d: weiShenResources.wei1dKlinesMap.get('BTCUSDT') || [],
        fallbackQuoteVolume24hUsd: parseFloat(ticker.quoteVolume || '0'),
    });
}

function attachEnhancedMarketData(
    tickers: TickerData[],
    resources: MarketEnhancementResources,
    weiUniverseSymbols: string[],
): TickerData[] {
    const weiUniverseSet = new Set(weiUniverseSymbols);

    return tickers.map((ticker) => {
        const klines = resources.klinesMap.get(ticker.symbol);
        const oiSnapshot = resources.oiSnapshotMap.get(ticker.symbol);
        const trend5mKlines = resources.trend5mKlinesMap.get(ticker.symbol);
        const daily1dKlines = resources.daily1dKlinesMap.get(ticker.symbol);
        const canEnhance = Boolean(
            (klines && klines.length > 0) ||
            (trend5mKlines && trend5mKlines.length > 0) ||
            (daily1dKlines && daily1dKlines.length > 0)
        );
        const enhanced = canEnhance
            ? enhanceTickerData(ticker, klines || [], resources.btcReturns, {
                trend5m: trend5mKlines,
                daily1d: daily1dKlines,
            })
            : ticker;

        const weiShenContext = buildWeiShenContextForTicker(ticker, weiUniverseSet, resources);

        return {
            ...enhanced,
            markPrice: enhanced.markPrice || ticker.markPrice || ticker.lastPrice,
            fundingRate: enhanced.fundingRate || '0',
            openInterest: oiSnapshot?.currentOpenInterest || enhanced.openInterest,
            openInterestValue: oiSnapshot?.currentOpenInterestValue || enhanced.openInterestValue,
            strategyContexts: weiShenContext
                ? {
                    ...enhanced.strategyContexts,
                    weiShen: weiShenContext,
                }
                : enhanced.strategyContexts,
        };
    });
}

function attachHistoricalTrackerChanges(
    tickers: TickerData[],
    oiSnapshotMap: MarketEnhancementResources['oiSnapshotMap']
): TickerData[] {
    return tickers.map((ticker) => {
        const oiSnapshot = oiSnapshotMap.get(ticker.symbol);
        const oiValue = parseFloat(ticker.openInterestValue || '0');
        const volume = parseFloat(ticker.quoteVolume || '0');
        const fundingRate = parseFloat(ticker.fundingRate || '0');

        historicalTracker.addSnapshot(ticker.symbol, {
            openInterestValue: oiValue,
            volume,
            fundingRate,
        });

        const changes = historicalTracker.getChangePercent(ticker.symbol);

        return {
            ...ticker,
            markPrice: ticker.markPrice || ticker.lastPrice,
            fundingRate: ticker.fundingRate || '0',
            oiChangePercent: oiSnapshot?.changePercent4h,
            volumeChangePercent: changes.volumeChangePercent,
            fundingRateVelocity: changes.fundingRateVelocity,
            fundingRateTrend: changes.fundingRateTrend,
        };
    });
}

export async function buildMarketData(): Promise<TickerData[]> {
    const weiShenTimeframes = getWeiShenTimeframes();
    const baseMarketData = await fetchBaseMarketData();
    const oiTickerInputs = buildTickerInputs(baseMarketData);

    const [btcReturns, oiSnapshotMap] = await Promise.all([
        getBTCReturns(),
        fetchOpenInterestMarketSnapshotsBatch(oiTickerInputs, 25),
    ]);

    const eligibleTickerInputs = selectEligibleTickerInputs(baseMarketData, oiSnapshotMap);
    const eligibleSymbols = eligibleTickerInputs.map((ticker) => ticker.symbol);
    const weiUniverseSymbols = resolveWeiUniverseSymbols(baseMarketData);

    const [
        klinesMap,
        trend5mKlinesMap,
        daily1dKlinesMap,
        wei1hKlinesMap,
        wei4hKlinesMap,
        wei1dKlinesMap,
    ] = await Promise.all([
        fetchKlinesBatch(eligibleSymbols, APP_CONFIG.API.BATCH_SIZE, '15m', 50),
        fetchKlinesBatch(eligibleSymbols, APP_CONFIG.API.BATCH_SIZE, '5m', 120),
        fetchKlinesBatch(eligibleSymbols, APP_CONFIG.API.BATCH_SIZE, '1d', 30),
        fetchKlinesBatch(weiUniverseSymbols, APP_CONFIG.API.BATCH_SIZE, weiShenTimeframes.signalInterval, 180),
        fetchKlinesBatch(weiUniverseSymbols, APP_CONFIG.API.BATCH_SIZE, weiShenTimeframes.confirmInterval, 180),
        fetchKlinesBatch(weiUniverseSymbols, APP_CONFIG.API.BATCH_SIZE, weiShenTimeframes.dailyFilterInterval, 60),
    ]);

    logEnhancementUniverse(baseMarketData.length, eligibleSymbols);

    const enhancedMarketData = attachEnhancedMarketData(
        baseMarketData,
        {
            btcReturns,
            oiSnapshotMap,
            klinesMap,
            trend5mKlinesMap,
            daily1dKlinesMap,
            wei1hKlinesMap,
            wei4hKlinesMap,
            wei1dKlinesMap,
        },
        weiUniverseSymbols,
    );

    const merged = attachHistoricalTrackerChanges(enhancedMarketData, oiSnapshotMap);
    historicalTracker.cleanup();
    return merged;
}
