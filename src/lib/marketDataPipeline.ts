import { TickerData, PremiumIndex, OHLC } from '@/lib/types';
import { historicalTracker } from '@/lib/historicalTracker';
import { fetchKlinesBatch, enhanceTickerData, getBTCReturns } from '@/lib/indicatorEnhancer';
import { APP_CONFIG } from '@/lib/config';
import { logger } from '@/lib/logger';
import { fetchBinanceJson } from '@/lib/binanceApi';
import {
    fetchCurrentOpenInterestMarketSnapshotsBatch,
    fetchOpenInterestMarketSnapshotsBatch,
} from '@/lib/openInterest';
import { fetchSentimentHotspotContextMap } from '@/lib/sentimentHotspot';
import { WEI_SHEN_UNIVERSE } from '@/lib/weiShenUniverse';
import { buildWeiShenContext, getWeiShenTimeframes } from '@/lib/weiShenStrategy';
import {
    buildMarketKlineEnhancementStagePlan,
    fetchMarketKlineEnhancementGroup,
    resolveMarketEnrichmentLimits,
    resolveMarketKlineBatchSize,
    selectMarketKlineEligibleSymbols,
} from '@/lib/marketBuildConfig';
import {
    attachOpenInterestSnapshotsToTickers,
    mergeOpenInterestSnapshotMaps,
    type OpenInterestSnapshotLike,
} from '@/lib/marketDataTransforms';

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

const MARKET_ENRICHMENT_LIMITS = resolveMarketEnrichmentLimits();
const STRATEGY_MARKET_ENRICHMENT_LIMITS = {
    oiSnapshotSymbolLimit: 220,
    historicalOiChangeSymbolLimit: 80,
    klineEnhancementSymbolLimit: 180,
};
const MARKET_ENHANCEMENT_CHUNK_SIZE = 40;

interface MarketEnhancementResources {
    btcReturns: number[];
    oiSnapshotMap: Map<string, OpenInterestSnapshotLike>;
    klinesMap: Awaited<ReturnType<typeof fetchKlinesBatch>>;
    trend5mKlinesMap: Awaited<ReturnType<typeof fetchKlinesBatch>>;
    daily1dKlinesMap: Awaited<ReturnType<typeof fetchKlinesBatch>>;
    wei1hKlinesMap: Awaited<ReturnType<typeof fetchKlinesBatch>>;
    wei4hKlinesMap: Awaited<ReturnType<typeof fetchKlinesBatch>>;
    wei1dKlinesMap: Awaited<ReturnType<typeof fetchKlinesBatch>>;
    sentimentHotspotMap: Awaited<ReturnType<typeof fetchSentimentHotspotContextMap>>;
}

interface BuildMarketDataOptions {
    enrichmentLimits?: {
        oiSnapshotSymbolLimit: number;
        historicalOiChangeSymbolLimit?: number;
        klineEnhancementSymbolLimit: number;
    };
}

function chunkArray<T>(items: T[], size: number): T[][] {
    const chunks: T[][] = [];
    for (let index = 0; index < items.length; index += size) {
        chunks.push(items.slice(index, index + size));
    }
    return chunks;
}

function fetchUncachedKlinesBatch(
    symbols: string[],
    batchSize: number,
    interval: string,
    limit: number,
): Promise<Map<string, OHLC[]>> {
    return fetchKlinesBatch(symbols, batchSize, interval, limit, { cache: false });
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
    tickers: TickerData[]
): MarketTickerInput[] {
    return [...tickers]
        .sort((a, b) => parseFloat(b.quoteVolume) - parseFloat(a.quoteVolume))
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
        coverage: 'full',
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
        const sentimentHotspotContext = resources.sentimentHotspotMap.get(ticker.symbol);
        const strategyContexts = {
            ...enhanced.strategyContexts,
            ...(weiShenContext ? { weiShen: weiShenContext } : {}),
            ...(sentimentHotspotContext ? { sentimentHotspot: sentimentHotspotContext } : {}),
        };

        return {
            ...enhanced,
            markPrice: enhanced.markPrice || ticker.markPrice || ticker.lastPrice,
            fundingRate: enhanced.fundingRate || '0',
            openInterest: oiSnapshot?.currentOpenInterest || enhanced.openInterest,
            openInterestValue: oiSnapshot?.currentOpenInterestValue || enhanced.openInterestValue,
            strategyContexts: Object.keys(strategyContexts).length > 0 ? strategyContexts : enhanced.strategyContexts,
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
            oiChangePercent: oiSnapshot?.changePercent4h ?? changes.oiChangePercent,
            volumeChangePercent: changes.volumeChangePercent,
            fundingRateVelocity: changes.fundingRateVelocity,
            fundingRateTrend: changes.fundingRateTrend,
        };
    });
}

export async function buildMarketData(options: BuildMarketDataOptions = {}): Promise<TickerData[]> {
    const enrichmentLimits = options.enrichmentLimits ?? MARKET_ENRICHMENT_LIMITS;
    const weiShenTimeframes = getWeiShenTimeframes();
    const baseMarketData = await fetchBaseMarketData();
    const oiTickerInputs = buildTickerInputs(
        [...baseMarketData]
            .sort((a, b) => parseFloat(b.quoteVolume) - parseFloat(a.quoteVolume))
            .slice(0, enrichmentLimits.oiSnapshotSymbolLimit)
    );
    const historicalOiTickerInputs = oiTickerInputs.slice(
        0,
        enrichmentLimits.historicalOiChangeSymbolLimit ?? enrichmentLimits.oiSnapshotSymbolLimit
    );

    const [btcReturns, currentOiSnapshotMap, historicalOiChangeSnapshotMap] = await Promise.all([
        getBTCReturns(),
        fetchCurrentOpenInterestMarketSnapshotsBatch(oiTickerInputs, 25),
        fetchOpenInterestMarketSnapshotsBatch(historicalOiTickerInputs, 25),
    ]);
    const oiSnapshotMap = mergeOpenInterestSnapshotMaps(currentOiSnapshotMap, historicalOiChangeSnapshotMap);

    const marketDataWithOpenInterest = attachOpenInterestSnapshotsToTickers(baseMarketData, oiSnapshotMap);
    const trackedMarketData = attachHistoricalTrackerChanges(marketDataWithOpenInterest, oiSnapshotMap);

    const weiUniverseSymbols = resolveWeiUniverseSymbols(trackedMarketData);
    const eligibleTickerInputs = selectEligibleTickerInputs(trackedMarketData);
    const eligibleSymbols = selectMarketKlineEligibleSymbols({
        eligibleSymbols: eligibleTickerInputs.map((ticker) => ticker.symbol),
        weiUniverseSymbols,
        maxEligibleSymbols: enrichmentLimits.klineEnhancementSymbolLimit,
    });
    const klineBatchSize = resolveMarketKlineBatchSize(APP_CONFIG.API.BATCH_SIZE);
    const weiShenStagePlan = buildMarketKlineEnhancementStagePlan({
        eligibleSymbols: [],
        weiUniverseSymbols,
        weiShenTimeframes,
    });

    const [
        wei1hKlinesMap,
        wei4hKlinesMap,
        wei1dKlinesMap,
    ] = await Promise.all(weiShenStagePlan.weiShen.map((request) =>
        fetchMarketKlineEnhancementGroup(request, klineBatchSize, fetchKlinesBatch, logger)
    ));

    logEnhancementUniverse(trackedMarketData.length, eligibleSymbols);

    const enhancedBySymbol = new Map<string, TickerData>();
    const baseMarketDataBySymbol = new Map(trackedMarketData.map((ticker) => [ticker.symbol, ticker]));
    for (const symbolChunk of chunkArray(eligibleSymbols, MARKET_ENHANCEMENT_CHUNK_SIZE)) {
        const chunkTickers = symbolChunk
            .map((symbol) => baseMarketDataBySymbol.get(symbol))
            .filter((ticker): ticker is TickerData => Boolean(ticker));
        if (chunkTickers.length === 0) {
            continue;
        }

        const [
            klinesMap,
            trend5mKlinesMap,
            daily1dKlinesMap,
        ] = await Promise.all([
            fetchMarketKlineEnhancementGroup(
                { label: 'eligible-15m', symbols: symbolChunk, interval: '15m', limit: 50 },
                klineBatchSize,
                fetchUncachedKlinesBatch,
                logger,
            ),
            fetchMarketKlineEnhancementGroup(
                { label: 'eligible-5m', symbols: symbolChunk, interval: '5m', limit: 120 },
                klineBatchSize,
                fetchUncachedKlinesBatch,
                logger,
            ),
            fetchMarketKlineEnhancementGroup(
                { label: 'eligible-1d', symbols: symbolChunk, interval: '1d', limit: 30 },
                klineBatchSize,
                fetchUncachedKlinesBatch,
                logger,
            ),
        ]);

        const sentimentHotspotMap = await fetchSentimentHotspotContextMap(
            chunkTickers,
            daily1dKlinesMap,
            klinesMap,
            { oiSignalMode: 'current' },
        );

        const chunkEnhancedMarketData = attachEnhancedMarketData(
            chunkTickers,
            {
                btcReturns,
                oiSnapshotMap,
                klinesMap,
                trend5mKlinesMap,
                daily1dKlinesMap,
                wei1hKlinesMap,
                wei4hKlinesMap,
                wei1dKlinesMap,
                sentimentHotspotMap,
            },
            weiUniverseSymbols,
        );

        chunkEnhancedMarketData.forEach((ticker) => {
            enhancedBySymbol.set(ticker.symbol, ticker);
        });
    }

    const enhancedMarketData = trackedMarketData.map((ticker) =>
        enhancedBySymbol.get(ticker.symbol) || {
            ...ticker,
            markPrice: ticker.markPrice || ticker.lastPrice,
            fundingRate: ticker.fundingRate || '0',
            openInterest: oiSnapshotMap.get(ticker.symbol)?.currentOpenInterest || ticker.openInterest,
            openInterestValue: oiSnapshotMap.get(ticker.symbol)?.currentOpenInterestValue || ticker.openInterestValue,
        }
    );

    historicalTracker.cleanup();
    return enhancedMarketData;
}

export function buildStrategyMarketData(): Promise<TickerData[]> {
    return buildMarketData({
        enrichmentLimits: STRATEGY_MARKET_ENRICHMENT_LIMITS,
    });
}
