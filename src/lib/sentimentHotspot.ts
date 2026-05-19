import type { OHLC, TickerData } from './types.ts';
import { fetchBinanceJson } from './binanceApi.ts';
import { logger } from './logger.ts';
import {
    buildOpenInterestHistoryPath,
    normalizeOpenInterestHistEntries,
} from './openInterestShared.ts';

export type SentimentHotspotSignalType = 'A_PLUS_LONG' | 'CORE_LONG' | 'WATCH' | 'RISK_OVERHEATED' | 'IGNORE';
export type SentimentHotspotEntryHint = 'breakout-ready' | 'pullback-watch' | 'avoid-chase' | 'wait';
export type SentimentHotspotExitLevel = 'hold' | 'warning' | 'exit';

export interface SentimentHotspotEntryContext {
    oneHourHigh: number;
    launchZoneLow: number;
    last15mChangePct: number;
    breakoutConfirmed: boolean;
    avoidChase: boolean;
    entryHint: SentimentHotspotEntryHint;
}

export interface SentimentHotspotExitMonitorInput {
    currentPrice: number;
    launchZoneLow?: number;
    oiChangePct: number;
    oiRising: boolean;
    fundingRatePct: number;
    volumeSurgeRatio: number;
    priceChangeSinceSignalPct: number;
    elapsedMs: number;
}

export interface SentimentHotspotExitMonitor {
    level: SentimentHotspotExitLevel;
    reasons: string[];
}

export interface SentimentHotspotContext {
    heatSourceCount: number;
    hasSquare: boolean;
    hasCoinGecko: boolean;
    hasVolSurge: boolean;
    volumeSurgeRatio: number;
    isFirstSeenHot?: boolean;
    oiUsd: number;
    oiChangePct: number;
    oiSegments: readonly [number, number, number, number] | [];
    oiRising: boolean;
    oiStrong: boolean;
    fundingRatePct: number;
    prevFundingRatePct?: number;
    fundingTurnedNegative?: boolean;
    entry?: SentimentHotspotEntryContext;
}

export interface SentimentHotspotCandidateInput {
    heatSourceCount: number;
    hasSquare: boolean;
    hasCoinGecko: boolean;
    hasVolSurge: boolean;
    volume24h: number;
    oiUsd: number;
    oiRising: boolean;
    oiChangePct: number;
    fundingRatePct: number;
    priceChange24h: number;
}

export interface SentimentHotspotClassification {
    type: SentimentHotspotSignalType;
    reason: string;
}

export interface SentimentHotspotOiSignal {
    oiChangePct: number;
    oiSegments: readonly [number, number, number, number] | [];
    oiRising: boolean;
    oiStrong: boolean;
}

export interface SentimentHotspotContextMapOptions {
    oiSignalMode?: 'history' | 'current';
}

interface CoinGeckoTrendingResponse {
    coins?: Array<{
        item?: {
            symbol?: string;
        };
    }>;
}

interface BinanceSquareHashtagResponse {
    data?: {
        hashtag?: {
            contentCount?: number | string | null;
            viewCount?: number | string | null;
        };
    };
}

export interface SentimentHotspotSquareCandidateInput {
    volume24h: number;
    priceChange24h: number;
    fundingRatePct: number;
    oiChangePct: number;
    volumeSurgeRatio: number;
}

const SENTIMENT_OI_PERIOD = '30m';
const SENTIMENT_OI_LIMIT = 32;
const MIN_OI_VALUES = 12;
const COINGECKO_TRENDING_CACHE_TTL_MS = 5 * 60 * 1000;

let coinGeckoTrendingCache: { expiresAt: number; coins: Set<string> } | null = null;
let coinGeckoTrendingInflight: Promise<Set<string>> | null = null;

export const SENTIMENT_HOTSPOT_PARAMS = {
    watchMinHeatSourceCount: 1,
    watchMinVolume24h: 10_000_000,
    minHeatSourceCount: 2,
    minVolume24h: 10_000_000,
    aPlusMinVolume24h: 50_000_000,
    minOiUsd: 5_000_000,
    minOiChangePct: 8,
    strongOiChangePct: 12,
    maxCorePriceChange24h: 25,
    maxAPlusPriceChange24h: 20,
    overheatPriceChange24h: 30,
    minPriceChange24h: 5,
    maxFundingRatePct: -0.01,
    aPlusMaxFundingRatePct: -0.03,
    fundingTurnPrevMinPct: 0.002,
    fundingTurnCurrentMaxPct: -0.01,
    volSurgeMultiple: 3,
    squareCandidateMinVolume24h: 10_000_000,
    squareCandidateMaxVolume24h: 800_000_000,
    squareCandidateMinPriceChange24h: 5,
    squareCandidateMaxPriceChange24h: 25,
    squareCandidateMaxFundingRatePct: -0.01,
    squareCandidateMinOiChangePct: 8,
    squareCandidateMinVolumeSurgeRatio: 3,
    squareMinPosts: 20,
    squareMinViews: 50_000,
    maxSquareHashtagChecks: 60,
    minVolumeForSurgeCheck: 20_000_000,
    maxCgTrendingCoins: 30,
    maxOiContextSymbols: 80,
    max15mEntryChasePct: 6,
    exitMinProgressPct: 2,
    exitWarningProgressPct: 1,
    exitTimeStopMs: 4 * 60 * 60 * 1000,
    exitWarningTimeMs: 2 * 60 * 60 * 1000,
    exitVolumeDryingRatio: 1.2,
    cooldownMs: 24 * 60 * 60 * 1000,
} as const;

export type SentimentHotspotParameters = {
    [K in keyof typeof SENTIMENT_HOTSPOT_PARAMS]: number;
};

function isFinitePositive(value: number): boolean {
    return Number.isFinite(value) && value > 0;
}

function toFiniteNumber(value: unknown, fallback = 0): number {
    const numeric = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(numeric) ? numeric : fallback;
}

function normalizeCoin(symbol: string): string {
    return symbol.toUpperCase().replace(/USDT$/, '');
}

function calculateAverage(values: number[]): number {
    return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function calculateSentimentHotspotOiSignal(
    rawValues: Array<string | number | { sumOpenInterestValue?: string | number | null }>
): SentimentHotspotOiSignal {
    if (rawValues.length < MIN_OI_VALUES) {
        return { oiChangePct: 0, oiSegments: [], oiRising: false, oiStrong: false };
    }

    const values = rawValues.map((item) => {
        if (typeof item === 'number' || typeof item === 'string') {
            return toFiniteNumber(item, NaN);
        }
        return toFiniteNumber(item.sumOpenInterestValue, NaN);
    });

    if (values.length < MIN_OI_VALUES || values.some((value) => !isFinitePositive(value))) {
        return { oiChangePct: 0, oiSegments: [], oiRising: false, oiStrong: false };
    }

    const segmentLength = Math.floor(values.length / 4);
    if (segmentLength < 3) {
        return { oiChangePct: 0, oiSegments: [], oiRising: false, oiStrong: false };
    }

    const segments = [
        calculateAverage(values.slice(0, segmentLength)),
        calculateAverage(values.slice(segmentLength, segmentLength * 2)),
        calculateAverage(values.slice(segmentLength * 2, segmentLength * 3)),
        calculateAverage(values.slice(segmentLength * 3)),
    ] as const;

    const oiChangePct = segments[0] > 0
        ? ((segments[3] - segments[0]) / segments[0]) * 100
        : 0;
    const strictRising = segments[0] < segments[1] && segments[1] < segments[2] && segments[2] < segments[3];
    const oiRising = strictRising && oiChangePct >= SENTIMENT_HOTSPOT_PARAMS.minOiChangePct;

    return {
        oiChangePct,
        oiSegments: segments,
        oiRising,
        oiStrong: oiRising && oiChangePct >= SENTIMENT_HOTSPOT_PARAMS.strongOiChangePct,
    };
}

export function classifySentimentHotspotCandidate(
    input: SentimentHotspotCandidateInput,
    params: SentimentHotspotParameters = SENTIMENT_HOTSPOT_PARAMS,
): SentimentHotspotClassification {
    const {
        heatSourceCount,
        hasCoinGecko,
        hasSquare,
        hasVolSurge,
        volume24h,
        oiUsd,
        oiRising,
        oiChangePct,
        fundingRatePct,
        priceChange24h,
    } = input;

    if (priceChange24h > params.overheatPriceChange24h) {
        return { type: 'RISK_OVERHEATED', reason: '24h涨幅超过30%，追高风险过大' };
    }

    const onlyCoinGeckoHeat = hasCoinGecko && !hasSquare && !hasVolSurge;
    const blockers: string[] = [];

    if (heatSourceCount < params.minHeatSourceCount) blockers.push('热度来源不足');
    if (onlyCoinGeckoHeat) blockers.push('只有CoinGecko热度');
    if (!hasSquare && !hasVolSurge) blockers.push('缺少广场或放量确认');
    if (volume24h < params.minVolume24h) blockers.push('24h成交额不足');
    if (oiUsd < params.minOiUsd) blockers.push('OI总量不足');
    if (!oiRising) blockers.push('OI未四段严格递增');
    if (oiChangePct < params.minOiChangePct) blockers.push('OI增幅不足');
    if (fundingRatePct > params.maxFundingRatePct) blockers.push('负费率不够深');
    if (priceChange24h < params.minPriceChange24h) blockers.push('价格尚未确认向上');
    if (priceChange24h > params.maxCorePriceChange24h) blockers.push('价格已偏热');

    if (blockers.length > 0) {
        if (onlyCoinGeckoHeat) {
            return {
                type: 'IGNORE',
                reason: blockers.join('；'),
            };
        }

        const watch =
            heatSourceCount >= params.watchMinHeatSourceCount &&
            volume24h >= params.watchMinVolume24h;
        return {
            type: watch ? 'WATCH' : 'IGNORE',
            reason: blockers.join('；'),
        };
    }

    const aPlus =
        heatSourceCount >= params.minHeatSourceCount &&
        hasVolSurge &&
        oiRising &&
        oiChangePct >= params.strongOiChangePct &&
        fundingRatePct <= params.aPlusMaxFundingRatePct &&
        priceChange24h >= params.minPriceChange24h &&
        priceChange24h <= params.maxAPlusPriceChange24h &&
        volume24h >= params.aPlusMinVolume24h &&
        oiUsd >= params.minOiUsd;

    return {
        type: aPlus ? 'A_PLUS_LONG' : 'CORE_LONG',
        reason: aPlus ? 'A+做多候选' : '核心做多候选',
    };
}

export function isSentimentHotspotSquareCandidate(input: SentimentHotspotSquareCandidateInput): boolean {
    const hasEnoughVolume =
        input.volume24h >= SENTIMENT_HOTSPOT_PARAMS.squareCandidateMinVolume24h &&
        input.volume24h <= SENTIMENT_HOTSPOT_PARAMS.squareCandidateMaxVolume24h;
    if (!hasEnoughVolume) {
        return false;
    }

    return (
        input.priceChange24h >= SENTIMENT_HOTSPOT_PARAMS.squareCandidateMinPriceChange24h &&
        input.priceChange24h <= SENTIMENT_HOTSPOT_PARAMS.squareCandidateMaxPriceChange24h &&
        input.fundingRatePct <= SENTIMENT_HOTSPOT_PARAMS.squareCandidateMaxFundingRatePct &&
        input.oiChangePct >= SENTIMENT_HOTSPOT_PARAMS.squareCandidateMinOiChangePct &&
        input.volumeSurgeRatio >= SENTIMENT_HOTSPOT_PARAMS.squareCandidateMinVolumeSurgeRatio
    );
}

export function evaluateSentimentFundingTurn(
    prevFundingRatePct: number | undefined,
    currentFundingRatePct: number
): { prevFundingRatePct?: number; fundingTurnedNegative: boolean } {
    return {
        prevFundingRatePct,
        fundingTurnedNegative:
            typeof prevFundingRatePct === 'number' &&
            prevFundingRatePct >= SENTIMENT_HOTSPOT_PARAMS.fundingTurnPrevMinPct &&
            currentFundingRatePct <= SENTIMENT_HOTSPOT_PARAMS.fundingTurnCurrentMaxPct,
    };
}

export function calculateSentimentHotspotEntryContext(
    klines: OHLC[] | undefined,
    currentPrice: number
): SentimentHotspotEntryContext | undefined {
    if (!klines || klines.length < 5 || !isFinitePositive(currentPrice)) {
        return undefined;
    }

    const latest = klines[klines.length - 1];
    const priorHour = klines.slice(-5, -1);
    if (!latest || priorHour.length < 4 || !isFinitePositive(latest.open)) {
        return undefined;
    }

    const oneHourHigh = Math.max(...priorHour.map((kline) => kline.high));
    const launchZoneLow = Math.min(...priorHour.map((kline) => kline.low));
    const last15mChangePct = ((latest.close - latest.open) / latest.open) * 100;
    const avoidChase = last15mChangePct > SENTIMENT_HOTSPOT_PARAMS.max15mEntryChasePct;
    const breakoutConfirmed = currentPrice > oneHourHigh && !avoidChase;
    const entryHint: SentimentHotspotEntryHint = avoidChase
        ? 'avoid-chase'
        : breakoutConfirmed
            ? 'breakout-ready'
            : currentPrice >= launchZoneLow
                ? 'pullback-watch'
                : 'wait';

    return {
        oneHourHigh,
        launchZoneLow,
        last15mChangePct,
        breakoutConfirmed,
        avoidChase,
        entryHint,
    };
}

export function evaluateSentimentHotspotExitMonitor(
    input: SentimentHotspotExitMonitorInput
): SentimentHotspotExitMonitor {
    const exitReasons: string[] = [];
    const warningReasons: string[] = [];

    if (
        typeof input.launchZoneLow === 'number' &&
        Number.isFinite(input.launchZoneLow) &&
        input.launchZoneLow > 0 &&
        input.currentPrice < input.launchZoneLow
    ) {
        exitReasons.push('跌破启动区，结构失效');
    }

    if (input.oiChangePct < 0 && input.priceChangeSinceSignalPct <= 0) {
        exitReasons.push('OI下降但价格未上涨，逼空燃料释放失败');
    } else if (!input.oiRising || input.oiChangePct < SENTIMENT_HOTSPOT_PARAMS.minOiChangePct) {
        warningReasons.push('OI不再四段递增，增仓逻辑转弱');
    }

    if (
        input.fundingRatePct >= 0 &&
        input.priceChangeSinceSignalPct < SENTIMENT_HOTSPOT_PARAMS.exitMinProgressPct
    ) {
        exitReasons.push('费率回正但价格未继续拉升，空头燃料消失');
    }

    if (
        input.elapsedMs >= SENTIMENT_HOTSPOT_PARAMS.exitTimeStopMs &&
        input.priceChangeSinceSignalPct < SENTIMENT_HOTSPOT_PARAMS.exitMinProgressPct
    ) {
        exitReasons.push('超过4小时仍未有效拉升，时间止损');
    } else if (
        input.elapsedMs >= SENTIMENT_HOTSPOT_PARAMS.exitWarningTimeMs &&
        input.priceChangeSinceSignalPct < SENTIMENT_HOTSPOT_PARAMS.exitWarningProgressPct
    ) {
        warningReasons.push('超过2小时仍未明显走强');
    }

    if (input.volumeSurgeRatio > 0 && input.volumeSurgeRatio < SENTIMENT_HOTSPOT_PARAMS.exitVolumeDryingRatio) {
        warningReasons.push('放量回落，热度退潮');
    }

    if (exitReasons.length > 0) {
        return { level: 'exit', reasons: exitReasons };
    }

    if (warningReasons.length > 0) {
        return { level: 'warning', reasons: warningReasons };
    }

    return { level: 'hold', reasons: [] };
}

function calculateVolumeSurgeRatio(ticker: TickerData, dailyKlines?: OHLC[]): number {
    const volume24h = toFiniteNumber(ticker.quoteVolume);
    if (volume24h < SENTIMENT_HOTSPOT_PARAMS.minVolumeForSurgeCheck || !dailyKlines || dailyKlines.length < 5) {
        return 0;
    }

    const previousDailyVolumes = dailyKlines
        .slice(-8, -1)
        .map((kline) => kline.quoteVolume ?? kline.volume)
        .filter(isFinitePositive);

    if (previousDailyVolumes.length < 4) {
        return 0;
    }

    const averagePreviousVolume = calculateAverage(previousDailyVolumes);
    return averagePreviousVolume > 0 ? volume24h / averagePreviousVolume : 0;
}

async function fetchCoinGeckoTrendingCoinsUncached(): Promise<Set<string>> {
    try {
        const response = await fetch('https://api.coingecko.com/api/v3/search/trending', {
            signal: AbortSignal.timeout(8000),
            next: { revalidate: 300 },
        });
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }

        const data = await response.json() as CoinGeckoTrendingResponse;
        return new Set(
            (data.coins || [])
                .slice(0, SENTIMENT_HOTSPOT_PARAMS.maxCgTrendingCoins)
                .map((item) => item.item?.symbol?.toUpperCase())
                .filter((symbol): symbol is string => Boolean(symbol))
        );
    } catch (error) {
        logger.warn('Failed to fetch CoinGecko trending coins for sentiment hotspot', {
            error: error instanceof Error ? error.message : String(error),
        });
        return new Set();
    }
}

async function fetchCoinGeckoTrendingCoins(): Promise<Set<string>> {
    const now = Date.now();
    if (coinGeckoTrendingCache && coinGeckoTrendingCache.expiresAt > now) {
        return new Set(coinGeckoTrendingCache.coins);
    }

    if (!coinGeckoTrendingInflight) {
        coinGeckoTrendingInflight = fetchCoinGeckoTrendingCoinsUncached()
            .then((coins) => {
                coinGeckoTrendingCache = {
                    expiresAt: Date.now() + COINGECKO_TRENDING_CACHE_TTL_MS,
                    coins: new Set(coins),
                };
                return coins;
            })
            .finally(() => {
                coinGeckoTrendingInflight = null;
            });
    }

    return new Set(await coinGeckoTrendingInflight);
}

export function clearSentimentHotspotCachesForTest() {
    coinGeckoTrendingCache = null;
    coinGeckoTrendingInflight = null;
}

async function fetchSentimentOiSignal(symbol: string): Promise<SentimentHotspotOiSignal | null> {
    try {
        const historyResponse = await fetchBinanceJson<unknown>(
            buildOpenInterestHistoryPath(symbol, SENTIMENT_OI_PERIOD, SENTIMENT_OI_LIMIT),
            { revalidate: 120, timeoutMs: 8000 }
        );
        const entries = normalizeOpenInterestHistEntries(historyResponse);
        return calculateSentimentHotspotOiSignal(entries.map((entry) => entry.sumOpenInterestValue));
    } catch (error) {
        logger.warn('Failed to fetch sentiment hotspot OI history', {
            symbol,
            error: error instanceof Error ? error.message : String(error),
        });
        return null;
    }
}

function buildCurrentSentimentOiSignal(ticker: TickerData): SentimentHotspotOiSignal {
    const oiChangePct = toFiniteNumber(ticker.oiChangePercent);
    const oiRising = oiChangePct >= SENTIMENT_HOTSPOT_PARAMS.minOiChangePct;

    return {
        oiChangePct,
        oiSegments: [],
        oiRising,
        oiStrong: oiRising && oiChangePct >= SENTIMENT_HOTSPOT_PARAMS.strongOiChangePct,
    };
}

async function fetchSquareHashtagHeat(coin: string): Promise<{ posts: number; views: number; hasSquare: boolean }> {
    const params = new URLSearchParams({
        hashtag: `#${coin.toLowerCase()}`,
        pageIndex: '1',
        pageSize: '1',
        orderBy: 'HOT',
    });

    try {
        const response = await fetch(
            `https://www.binance.com/bapi/composite/v4/friendly/pgc/content/queryByHashtag?${params.toString()}`,
            {
                signal: AbortSignal.timeout(6000),
                headers: {
                    'User-Agent': 'Mozilla/5.0',
                    Referer: 'https://www.binance.com/en/square',
                },
                next: { revalidate: 600 },
            }
        );

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }

        const data = await response.json() as BinanceSquareHashtagResponse;
        const hashtag = data.data?.hashtag;
        const posts = toFiniteNumber(hashtag?.contentCount);
        const views = toFiniteNumber(hashtag?.viewCount);

        return {
            posts,
            views,
            hasSquare:
                posts >= SENTIMENT_HOTSPOT_PARAMS.squareMinPosts ||
                views >= SENTIMENT_HOTSPOT_PARAMS.squareMinViews,
        };
    } catch (error) {
        logger.warn('Failed to fetch Binance Square hashtag heat for sentiment hotspot', {
            coin,
            error: error instanceof Error ? error.message : String(error),
        });
        return { posts: 0, views: 0, hasSquare: false };
    }
}

const fundingSnapshotMap = new Map<string, number>();

function resolveFundingTurn(symbol: string, currentFundingRatePct: number) {
    const previous = fundingSnapshotMap.get(symbol);
    fundingSnapshotMap.set(symbol, currentFundingRatePct);
    return evaluateSentimentFundingTurn(previous, currentFundingRatePct);
}

export async function fetchSentimentHotspotContextMap(
    tickers: TickerData[],
    dailyKlinesMap: Map<string, OHLC[]>,
    entryKlinesMap: Map<string, OHLC[]> = new Map(),
    options: SentimentHotspotContextMapOptions = {},
): Promise<Map<string, SentimentHotspotContext>> {
    const oiSignalMode = options.oiSignalMode || 'history';
    const coinGeckoTrending = await fetchCoinGeckoTrendingCoins();
    const baseContexts = new Map<string, Omit<SentimentHotspotContext, 'oiUsd' | 'oiChangePct' | 'oiSegments' | 'oiRising' | 'oiStrong'>>();

    tickers.forEach((ticker) => {
        const coin = normalizeCoin(ticker.symbol);
        const volumeSurgeRatio = calculateVolumeSurgeRatio(ticker, dailyKlinesMap.get(ticker.symbol));
        const hasVolSurge = volumeSurgeRatio >= SENTIMENT_HOTSPOT_PARAMS.volSurgeMultiple;
        const hasCoinGecko = coinGeckoTrending.has(coin);
        const hasSquare = false;
        const heatSourceCount = Number(hasCoinGecko) + Number(hasVolSurge) + Number(hasSquare);
        const fundingRatePct = toFiniteNumber(ticker.fundingRate) * 100;
        const fundingTurn = resolveFundingTurn(ticker.symbol, fundingRatePct);

        if (heatSourceCount === 0) {
            return;
        }

        baseContexts.set(ticker.symbol, {
            heatSourceCount,
            hasSquare,
            hasCoinGecko,
            hasVolSurge,
            volumeSurgeRatio,
            fundingRatePct,
            prevFundingRatePct: fundingTurn.prevFundingRatePct,
            fundingTurnedNegative: fundingTurn.fundingTurnedNegative,
        });
    });

    const candidates = [...tickers]
        .filter((ticker) => baseContexts.has(ticker.symbol))
        .sort((a, b) => toFiniteNumber(b.quoteVolume) - toFiniteNumber(a.quoteVolume))
        .slice(0, SENTIMENT_HOTSPOT_PARAMS.maxOiContextSymbols);

    const contextMap = new Map<string, SentimentHotspotContext>();

    if (oiSignalMode === 'current') {
        candidates.forEach((ticker) => {
            const base = baseContexts.get(ticker.symbol);
            if (!base) {
                return;
            }

            const oiUsd = toFiniteNumber(ticker.openInterestValue);
            const entry = calculateSentimentHotspotEntryContext(
                entryKlinesMap.get(ticker.symbol),
                toFiniteNumber(ticker.lastPrice)
            );
            contextMap.set(ticker.symbol, {
                ...base,
                oiUsd,
                ...buildCurrentSentimentOiSignal(ticker),
                entry,
            });
        });
    } else {
        for (let index = 0; index < candidates.length; index += 10) {
            const batch = candidates.slice(index, index + 10);
            const results = await Promise.allSettled(batch.map((ticker) => fetchSentimentOiSignal(ticker.symbol)));

            results.forEach((result, resultIndex) => {
                const ticker = batch[resultIndex];
                const base = baseContexts.get(ticker.symbol);
                if (!base || result.status !== 'fulfilled' || !result.value) {
                    return;
                }

                const oiUsd = toFiniteNumber(ticker.openInterestValue);
                const entry = calculateSentimentHotspotEntryContext(
                    entryKlinesMap.get(ticker.symbol),
                    toFiniteNumber(ticker.lastPrice)
                );
                contextMap.set(ticker.symbol, {
                    ...base,
                    oiUsd,
                    oiChangePct: result.value.oiChangePct,
                    oiSegments: result.value.oiSegments,
                    oiRising: result.value.oiRising,
                    oiStrong: result.value.oiStrong,
                    entry,
                });
            });
        }
    }

    const squareCandidates = [...candidates]
        .filter((ticker) => {
            const context = contextMap.get(ticker.symbol);
            if (!context) {
                return false;
            }

            return isSentimentHotspotSquareCandidate({
                volume24h: toFiniteNumber(ticker.quoteVolume),
                priceChange24h: toFiniteNumber(ticker.priceChangePercent),
                fundingRatePct: context.fundingRatePct,
                oiChangePct: context.oiChangePct,
                volumeSurgeRatio: context.volumeSurgeRatio,
            });
        })
        .slice(0, SENTIMENT_HOTSPOT_PARAMS.maxSquareHashtagChecks);

    for (let index = 0; index < squareCandidates.length; index += 8) {
        const batch = squareCandidates.slice(index, index + 8);
        const results = await Promise.allSettled(
            batch.map((ticker) => fetchSquareHashtagHeat(normalizeCoin(ticker.symbol)))
        );

        results.forEach((result, resultIndex) => {
            if (result.status !== 'fulfilled' || !result.value.hasSquare) {
                return;
            }

            const ticker = batch[resultIndex];
            const context = contextMap.get(ticker.symbol);
            if (!context || context.hasSquare) {
                return;
            }

            contextMap.set(ticker.symbol, {
                ...context,
                hasSquare: true,
                heatSourceCount: context.heatSourceCount + 1,
            });
        });
    }

    return contextMap;
}
