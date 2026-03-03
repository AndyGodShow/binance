/**
 * 技术指标增强模块
 * 为 TickerData 添加高级技术指标
 */

import { TickerData, OHLC } from '@/lib/types';
import { getLatestATR, calculateBeta, calculateCorrelation, calculateReturns, extractClosePrices } from '@/lib/indicators';
import { calculateVolumeProfile } from '@/lib/volumeProfile';
import { logger } from '@/lib/logger';
import { klineCache } from '@/lib/cache';
import { APP_CONFIG } from '@/lib/config';
import { fetchBinance } from '@/lib/binanceApi';

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
        const response = await fetchBinance(
            `/fapi/v1/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`,
            {
                revalidate: APP_CONFIG.API.REVALIDATE_MARKET,
                timeoutMs: APP_CONFIG.API.RETRY_MAX_DELAY
            }
        );

        if (!response.ok) {
            logger.warn(`Failed to fetch klines for ${symbol}`);
            return [];
        }

        const data = await response.json();

        const klines = data.map((k: any[]) => ({
            time: k[0],
            open: parseFloat(k[1]),
            high: parseFloat(k[2]),
            low: parseFloat(k[3]),
            close: parseFloat(k[4]),
            volume: parseFloat(k[5])
        }));

        // 存入缓存
        klineCache.set(cacheKey, klines, APP_CONFIG.CACHE.KLINE_TTL);

        return klines;
    } catch (error) {
        logger.error(`Error fetching klines for ${symbol}`, error as Error);
        return [];
    }
}

/**
 * 批量获取 K 线数据（限制并发数）
 */
export async function fetchKlinesBatch(symbols: string[], batchSize: number = APP_CONFIG.API.BATCH_SIZE): Promise<Map<string, OHLC[]>> {
    const klineMap = new Map<string, OHLC[]>();

    // 分批处理，避免过多并发请求
    for (let i = 0; i < symbols.length; i += batchSize) {
        const batch = symbols.slice(i, i + batchSize);
        const results = await Promise.allSettled(
            batch.map(symbol => fetchKlines(symbol))
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
    btcReturns?: number[]
): TickerData {
    const enhanced = { ...ticker };

    // 添加 K 线数据
    enhanced.ohlc = klines.slice(-20); // 保留最近 20 根（节省内存）

    if (klines.length >= 20) {
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

    // 🔥 4. 计算 Volatility Squeeze 指标（需要更多数据）
    if (klines.length >= 50) {
        try {
            const closePrices = extractClosePrices(klines);

            // 导入 Squeeze 相关函数
            const {
                calculateBollingerBands,
                calculateKeltnerChannels,
                detectSqueeze,
                calculateMomentumHistogram,
                calculateADX,
                calculateBandwidthPercentile
            } = require('@/lib/indicators');

            // 计算布林带
            const bb = calculateBollingerBands(closePrices, 20, 2);

            // 计算肯特纳通道
            const kc = calculateKeltnerChannels(klines, 20, 1.5);

            // 检测 Squeeze
            const squeeze = detectSqueeze(bb, kc);

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
            enhanced.squeezeStrength = squeeze.squeezeStrength;

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
