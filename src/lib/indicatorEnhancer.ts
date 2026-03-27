/**
 * 技术指标增强模块
 * 为 TickerData 添加高级技术指标
 */

import { TickerData, OHLC } from '@/lib/types';
import { getLatestATR, calculateBeta, calculateCorrelation, calculateReturns, extractClosePrices, getLatestEMAState } from '@/lib/indicators';
import {
    calculateBollingerBands,
    calculateKeltnerChannels,
    detectSqueeze,
    calculateMomentumHistogram,
    calculateADX,
    calculateBandwidthPercentile
} from '@/lib/indicators';
import { calculateVolumeProfile } from '@/lib/volumeProfile';
import { logger } from '@/lib/logger';
import { klineCache } from '@/lib/cache';
import { APP_CONFIG } from '@/lib/config';
import { fetchBinanceJson } from '@/lib/binanceApi';

type BinanceKline = [
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

const GMMA_SHORT_PERIODS = [3, 5, 8, 10, 12, 15] as const;
const GMMA_LONG_PERIODS = [30, 35, 40, 45, 50, 60] as const;
const MULTI_EMA_PERIODS = [20, 60, 100, 120] as const;

function isBinanceKline(value: unknown): value is BinanceKline {
    return Array.isArray(value) &&
        value.length >= 11 &&
        typeof value[0] === 'number' &&
        typeof value[1] === 'string' &&
        typeof value[2] === 'string' &&
        typeof value[3] === 'string' &&
        typeof value[4] === 'string' &&
        typeof value[5] === 'string';
}

/**
 * 获取 K 线数据
 */
export async function fetchKlines(symbol: string, interval: string = '15m', limit: number = 50): Promise<OHLC[]> {
    // 生成缓存键
    const cacheKey = `klines:${symbol}:${interval}:${limit}`;

    // 尝试从缓存获取
    const cached = klineCache.get(cacheKey) as OHLC[] | undefined;
    if (cached) {
        logger.debug(`Klines cache hit for ${symbol}`);
        return cached;
    }

    try {
        const data = await fetchBinanceJson<unknown>(
            `/fapi/v1/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`,
            {
                revalidate: APP_CONFIG.API.REVALIDATE_MARKET,
                timeoutMs: APP_CONFIG.API.RETRY_MAX_DELAY
            }
        );

        if (!Array.isArray(data)) {
            logger.warn(`Failed to fetch klines for ${symbol}`);
            return [];
        }

        const klines = data.filter(isBinanceKline).map((k) => ({
            time: k[0],
            open: parseFloat(k[1]),
            high: parseFloat(k[2]),
            low: parseFloat(k[3]),
            close: parseFloat(k[4]),
            volume: parseFloat(k[5]),
            quoteVolume: parseFloat(k[7]),
            takerBuyQuoteVolume: parseFloat(k[10])
        }));

        // 存入缓存
        klineCache.set(cacheKey, klines, APP_CONFIG.CACHE.KLINE_TTL);

        return klines;
    } catch (error) {
        logger.error(`Error fetching klines for ${symbol}`, error as Error);
        return [];
    }
}

function calculateCvdMetrics(klines: OHLC[]): { cvd?: number; cvdSlope?: number } {
    const points = klines.filter((kline) =>
        typeof kline.quoteVolume === 'number' &&
        Number.isFinite(kline.quoteVolume) &&
        typeof kline.takerBuyQuoteVolume === 'number' &&
        Number.isFinite(kline.takerBuyQuoteVolume)
    );

    if (points.length < 2) {
        return {};
    }

    let cvd = 0;
    const cvdHistory: number[] = [];

    points.forEach((point) => {
        const buyVolume = point.takerBuyQuoteVolume!;
        const sellVolume = point.quoteVolume! - buyVolume;
        cvd += buyVolume - sellVolume;
        cvdHistory.push(cvd);
    });

    const period = Math.min(5, cvdHistory.length);
    const recentCvd = cvdHistory.slice(-period);
    if (recentCvd.length < 2) {
        return { cvd: cvdHistory[cvdHistory.length - 1], cvdSlope: 0 };
    }

    const avgX = (period - 1) / 2;
    const avgY = recentCvd.reduce((sum, value) => sum + value, 0) / period;

    let numerator = 0;
    let denominator = 0;

    recentCvd.forEach((value, index) => {
        numerator += (index - avgX) * (value - avgY);
        denominator += Math.pow(index - avgX, 2);
    });

    return {
        cvd: cvdHistory[cvdHistory.length - 1],
        cvdSlope: denominator !== 0 ? numerator / denominator : 0,
    };
}

function determineOrderedTrend(values: number[]): 'bullish' | 'bearish' | 'mixed' {
    if (values.length < 2) {
        return 'mixed';
    }

    const bullish = values.every((value, index) => index === 0 || values[index - 1] > value);
    if (bullish) {
        return 'bullish';
    }

    const bearish = values.every((value, index) => index === 0 || values[index - 1] < value);
    if (bearish) {
        return 'bearish';
    }

    return 'mixed';
}

function calculateDirectionalAlignmentScore(values: number[], direction: 'bullish' | 'bearish'): number {
    if (values.length < 2) {
        return 0;
    }

    let score = 0;
    for (let index = 1; index < values.length; index++) {
        const prev = values[index - 1];
        const current = values[index];
        const aligned = direction === 'bullish' ? prev > current : prev < current;
        if (aligned) {
            score += 1;
        }
    }

    return score;
}

/**
 * 批量获取 K 线数据（限制并发数）
 */
export async function fetchKlinesBatch(
    symbols: string[],
    batchSize: number = APP_CONFIG.API.BATCH_SIZE,
    interval: string = '15m',
    limit: number = 50
): Promise<Map<string, OHLC[]>> {
    const klineMap = new Map<string, OHLC[]>();

    // 分批处理，避免过多并发请求
    for (let i = 0; i < symbols.length; i += batchSize) {
        const batch = symbols.slice(i, i + batchSize);
        const results = await Promise.allSettled(
            batch.map(symbol => fetchKlines(symbol, interval, limit))
        );

        results.forEach((result, index) => {
            if (result.status === 'fulfilled' && result.value.length > 0) {
                klineMap.set(batch[index], result.value);
            }
        });

        // 稍微延迟，避免触发限频
        if (i + batchSize < symbols.length) {
            await new Promise(resolve => setTimeout(resolve, APP_CONFIG.API.BATCH_DELAY));
        }
    }

    return klineMap;
}

/**
 * 增强单个 Ticker 数据
 */
export function enhanceTickerData(
    ticker: TickerData,
    klines: OHLC[],
    btcReturns?: number[],
    extraKlines?: {
        trend5m?: OHLC[];
        daily1d?: OHLC[];
    }
): TickerData {
    const enhanced = { ...ticker };

    // 添加 K 线数据
    enhanced.ohlc = klines.slice(-20); // 保留最近 20 根（节省内存）

    if (klines.length >= 20) {
        const currentQuoteVolume = Number.parseFloat(ticker.quoteVolume);
        const volumeMA =
            klines.slice(-20).reduce((sum, kline) => sum + (kline.quoteVolume || 0), 0) /
            Math.min(20, klines.length);

        if (Number.isFinite(volumeMA) && volumeMA > 0) {
            enhanced.volumeMA = volumeMA;
            if (Number.isFinite(currentQuoteVolume) && currentQuoteVolume > 0) {
                enhanced.volumeRatio = currentQuoteVolume / volumeMA;
            }
        }

        // 1. 计算 ATR
        const atr = getLatestATR(klines, 14);
        if (atr !== null) {
            // ATR 转换为百分比（相对于当前价格）
            const currentPrice = parseFloat(ticker.lastPrice);
            enhanced.atr = currentPrice > 0 ? (atr / currentPrice) * 100 : 0;
        }

        // 2. 计算 Volume Profile
        try {
            const vp = calculateVolumeProfile(klines, 30, ticker.symbol);
            enhanced.vah = vp.vah;
            enhanced.val = vp.val;
            enhanced.poc = vp.poc;
        } catch (error) {
            logger.error(`VP calculation failed for ${ticker.symbol}`, error as Error);
        }

        const { cvd, cvdSlope } = calculateCvdMetrics(klines);
        if (typeof cvd === 'number') {
            enhanced.cvd = cvd;
        }
        if (typeof cvdSlope === 'number') {
            enhanced.cvdSlope = cvdSlope;
        }

        // 3. 计算 Beta（如果有 BTC 参考数据）
        if (btcReturns && btcReturns.length > 0) {
            const closePrices = extractClosePrices(klines);
            const assetReturns = calculateReturns(closePrices);

            const minLength = Math.min(assetReturns.length, btcReturns.length);
            if (minLength >= 10) {
                const beta = calculateBeta(
                    assetReturns.slice(-minLength),
                    btcReturns.slice(-minLength)
                );
                const correlation = calculateCorrelation(
                    assetReturns.slice(-minLength),
                    btcReturns.slice(-minLength)
                );

                enhanced.betaToBTC = beta;
                enhanced.correlationToBTC = correlation;
            }
        }
    }

    const trendKlines = extraKlines?.trend5m || [];
    if (trendKlines.length >= 100) {
        const closes = extractClosePrices(trendKlines);
        const ema20 = getLatestEMAState(closes, 20);
        const ema60 = getLatestEMAState(closes, 60);
        const ema100 = getLatestEMAState(closes, 100);
        const gmmaShortStates = GMMA_SHORT_PERIODS
            .map((period) => getLatestEMAState(closes, period))
            .filter((state): state is NonNullable<typeof state> => state !== null);
        const gmmaLongStates = GMMA_LONG_PERIODS
            .map((period) => getLatestEMAState(closes, period))
            .filter((state): state is NonNullable<typeof state> => state !== null);
        const multiEmaStates = MULTI_EMA_PERIODS
            .map((period) => getLatestEMAState(closes, period))
            .filter((state): state is NonNullable<typeof state> => state !== null);

        if (ema20 && ema60 && ema100) {
            enhanced.ema5m20 = ema20.value;
            enhanced.ema5m60 = ema60.value;
            enhanced.ema5m100 = ema100.value;

            const currentPrice = parseFloat(ticker.lastPrice);
            if (Number.isFinite(currentPrice) && ema20.value > 0) {
                enhanced.ema5mDistancePercent = ((currentPrice - ema20.value) / ema20.value) * 100;
            }
        }

        if (gmmaShortStates.length === GMMA_SHORT_PERIODS.length && gmmaLongStates.length === GMMA_LONG_PERIODS.length) {
            const shortValues = gmmaShortStates.map((state) => state.value);
            const longValues = gmmaLongStates.map((state) => state.value);
            const shortAvg = shortValues.reduce((sum, value) => sum + value, 0) / shortValues.length;
            const longAvg = longValues.reduce((sum, value) => sum + value, 0) / longValues.length;
            const shortTrend = determineOrderedTrend(shortValues);
            const longTrend = determineOrderedTrend(longValues);

            enhanced.gmmaShortScore = shortTrend === 'bullish'
                ? calculateDirectionalAlignmentScore(shortValues, 'bullish')
                : shortTrend === 'bearish'
                ? calculateDirectionalAlignmentScore(shortValues, 'bearish')
                : 0;
            enhanced.gmmaLongScore = longTrend === 'bullish'
                ? calculateDirectionalAlignmentScore(longValues, 'bullish')
                : longTrend === 'bearish'
                ? calculateDirectionalAlignmentScore(longValues, 'bearish')
                : 0;

            if (longAvg > 0) {
                enhanced.gmmaSeparationPercent = ((shortAvg - longAvg) / longAvg) * 100;
            }

            if (
                shortTrend === 'bullish' &&
                longTrend === 'bullish' &&
                Math.min(...shortValues) > Math.max(...longValues)
            ) {
                enhanced.gmmaTrend = 'bullish';
            } else if (
                shortTrend === 'bearish' &&
                longTrend === 'bearish' &&
                Math.max(...shortValues) < Math.min(...longValues)
            ) {
                enhanced.gmmaTrend = 'bearish';
            } else {
                enhanced.gmmaTrend = 'mixed';
            }
        }

        if (multiEmaStates.length === MULTI_EMA_PERIODS.length) {
            const multiValues = multiEmaStates.map((state) => state.value);
            const multiTrend = determineOrderedTrend(multiValues);
            enhanced.multiEmaTrend = multiTrend;
            enhanced.multiEmaAlignmentScore = multiTrend === 'bullish'
                ? calculateDirectionalAlignmentScore(multiValues, 'bullish')
                : multiTrend === 'bearish'
                ? calculateDirectionalAlignmentScore(multiValues, 'bearish')
                : 0;
        }
    }

    const dailyKlines = extraKlines?.daily1d || [];
    if (dailyKlines.length >= 22) {
        const completedDailyKlines = dailyKlines.slice(0, -1);
        const breakoutWindow = completedDailyKlines.slice(-21);

        if (breakoutWindow.length === 21) {
            const breakoutHigh = Math.max(...breakoutWindow.map((kline) => kline.high));
            if (Number.isFinite(breakoutHigh) && breakoutHigh > 0) {
                enhanced.breakout21dHigh = breakoutHigh;

                const currentPrice = parseFloat(ticker.lastPrice);
                if (Number.isFinite(currentPrice)) {
                    enhanced.breakout21dPercent = ((currentPrice - breakoutHigh) / breakoutHigh) * 100;
                }
            }
        }
    }

    // 🔥 4. 计算 Volatility Squeeze 指标（需要更多数据）
    if (klines.length >= 50) {
        try {
            const closePrices = extractClosePrices(klines);

            // 计算布林带
            const bb = calculateBollingerBands(closePrices, 20, 2);

            // 计算肯特纳通道
            const kc = calculateKeltnerChannels(klines, 20, 1.5);

            // 检测 Squeeze
            const squeeze = detectSqueeze(bb, kc);
            const squeezeStates = bb.upper.map((upper, index) =>
                upper < kc.upper[index] && bb.lower[index] > kc.lower[index]
            );

            // 🔥 计算前一个周期的 Squeeze 状态（volatilitySqueezeStrategy 依赖此字段触发信号）
            let prevSqueezeStatus: 'on' | 'off' = 'off';
            if (bb.upper.length >= 2 && kc.upper.length >= 2) {
                const prevIdx = bb.upper.length - 2;
                const isPrevSqueeze =
                    bb.upper[prevIdx] < kc.upper[prevIdx] &&
                    bb.lower[prevIdx] > kc.lower[prevIdx];
                prevSqueezeStatus = isPrevSqueeze ? 'on' : 'off';
            }
            enhanced.prevSqueezeStatus = prevSqueezeStatus;

            const latestIdx = squeezeStates.length - 1;
            let releaseBarsAgo: number | undefined;
            for (let index = latestIdx; index >= 1; index--) {
                if (!squeezeStates[index] && squeezeStates[index - 1]) {
                    releaseBarsAgo = latestIdx - index;
                    break;
                }
            }

            let lastSqueezeDuration = squeeze.squeezeDuration;
            let squeezeBoxHigh: number | undefined;
            let squeezeBoxLow: number | undefined;
            if (releaseBarsAgo !== undefined) {
                const releaseIndex = latestIdx - releaseBarsAgo;
                let startIndex = releaseIndex - 1;
                while (startIndex >= 0 && squeezeStates[startIndex]) {
                    startIndex--;
                }
                const squeezeStart = startIndex + 1;
                const squeezeEnd = releaseIndex - 1;
                lastSqueezeDuration = Math.max(0, squeezeEnd - squeezeStart + 1);

                if (lastSqueezeDuration > 0) {
                    const alignedStart = Math.max(0, klines.length - squeezeStates.length + squeezeStart);
                    const alignedEnd = Math.min(klines.length - 1, klines.length - squeezeStates.length + squeezeEnd);
                    const squeezeSlice = klines.slice(alignedStart, alignedEnd + 1);

                    if (squeezeSlice.length > 0) {
                        squeezeBoxHigh = Math.max(...squeezeSlice.map((kline) => kline.high));
                        squeezeBoxLow = Math.min(...squeezeSlice.map((kline) => kline.low));
                    }
                }
            }

            // 计算动能柱
            const momentum = calculateMomentumHistogram(closePrices, kc.middle);

            // 计算 ADX
            const adxData = calculateADX(klines, 14);

            // 计算带宽百分位（需要历史带宽数据）
            const currentBandwidth = bb.bandwidth[bb.bandwidth.length - 1];
            const bandwidthPercentile = calculateBandwidthPercentile(
                currentBandwidth,
                bb.bandwidth
            );

            // 添加到 ticker
            enhanced.squeezeStatus = squeeze.isSqueezeOn ? 'on' : 'off';
            enhanced.squeezeDuration = squeeze.squeezeDuration;
            enhanced.lastSqueezeDuration = lastSqueezeDuration;
            enhanced.squeezeStrength = squeeze.squeezeStrength;
            enhanced.releaseBarsAgo = releaseBarsAgo;
            enhanced.squeezeBoxHigh = squeezeBoxHigh;
            enhanced.squeezeBoxLow = squeezeBoxLow;

            enhanced.keltnerUpper = kc.upper[kc.upper.length - 1];
            enhanced.keltnerMid = kc.middle[kc.middle.length - 1];
            enhanced.keltnerLower = kc.lower[kc.lower.length - 1];

            enhanced.momentumValue = momentum.momentum[momentum.momentum.length - 1];
            enhanced.momentumColor = momentum.color[momentum.color.length - 1];

            if (adxData.adx.length > 0) {
                enhanced.adx = adxData.adx[adxData.adx.length - 1];
                enhanced.plusDI = adxData.plusDI[adxData.plusDI.length - 1];
                enhanced.minusDI = adxData.minusDI[adxData.minusDI.length - 1];
            }

            enhanced.bandwidthPercentile = bandwidthPercentile;

        } catch (error) {
            logger.error(`Squeeze calculation failed for ${ticker.symbol}`, error as Error);
        }
    }

    return enhanced;
}

/**
 * 获取 BTC 参考数据
 */
let btcReturnsCache: { data: number[]; timestamp: number } | null = null;
const BTC_CACHE_TTL = 5 * 60 * 1000; // 5 分钟缓存

export async function getBTCReturns(): Promise<number[]> {
    const now = Date.now();

    // 使用缓存
    if (btcReturnsCache && now - btcReturnsCache.timestamp < BTC_CACHE_TTL) {
        return btcReturnsCache.data;
    }

    try {
        const klines = await fetchKlines('BTCUSDT', '15m', 100);
        if (klines.length > 0) {
            const closePrices = extractClosePrices(klines);
            const returns = calculateReturns(closePrices);

            btcReturnsCache = {
                data: returns,
                timestamp: now
            };

            return returns;
        }
    } catch (error) {
        logger.error('Failed to fetch BTC returns', error as Error);
    }

    return btcReturnsCache?.data || [];
}
