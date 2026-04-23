import type { KlineData } from '../app/api/backtest/klines/route.ts';
import { detectKlineGaps } from './klineRangeUtils.ts';

export type HistoricalRangeReadiness = 'ready' | 'exploratory-only' | 'not-ready';

export interface HistoricalRangeAudit {
    symbol: string;
    interval: string;
    requestedStartTime: number;
    requestedEndTime: number;
    expectedStartTime: number | null;
    expectedEndTime: number | null;
    actualStartTime: number | null;
    actualEndTime: number | null;
    actualBars: number;
    expectedBars: number;
    coverageRatio: number;
    coveragePercent: number;
    gapCount: number;
    missingBars: number;
    maxGapBars: number;
    hasGaps: boolean;
    readiness: HistoricalRangeReadiness;
    backtestReady: boolean;
    reasons: string[];
}

export interface HistoricalRangeFetchResult {
    klines: KlineData[];
    audit: HistoricalRangeAudit;
}

function parseUtcDateString(date: string): number {
    const match = date.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) {
        return NaN;
    }

    const year = Number.parseInt(match[1], 10);
    const month = Number.parseInt(match[2], 10);
    const day = Number.parseInt(match[3], 10);
    return Date.UTC(year, month - 1, day);
}

/**
 * 批量获取历史K线数据
 * 自动处理分页，突破单次1500条的限制
 */
export class HistoricalDataFetcher {
    private baseUrl: string;
    private maxLimit = 1500;
    private readonly rangeCache = new Map<string, Promise<KlineData[]>>();
    private activeRequestCount = 0;
    private readonly requestQueue: Array<() => void> = [];
    private readonly maxConcurrentRequests = 2;
    private readonly maxRequestAttempts = 3;

    constructor(options: { baseUrl?: string } = {}) {
        this.baseUrl = options.baseUrl || '/api/backtest/klines';
    }

    private buildCacheKey(
        symbol: string,
        interval: string,
        startTime: number,
        endTime: number,
        includeAuxiliary: boolean
    ): string {
        return [
            symbol.toUpperCase(),
            interval,
            startTime,
            endTime,
            includeAuxiliary ? 'aux' : 'core',
        ].join(':');
    }

    private normalizeKlines(klines: KlineData[]): KlineData[] {
        const deduped = new Map<number, KlineData>();
        klines.forEach((kline) => {
            if (Number.isFinite(kline.closeTime)) {
                deduped.set(kline.closeTime, kline);
            }
        });

        return Array.from(deduped.values()).sort((a, b) => a.closeTime - b.closeTime);
    }

    static getIntervalMilliseconds(interval: string): number {
        const unit = interval.slice(-1);
        const value = parseInt(interval.slice(0, -1));

        const unitMs: Record<string, number> = {
            'm': 60 * 1000,
            'h': 60 * 60 * 1000,
            'd': 24 * 60 * 60 * 1000,
            'w': 7 * 24 * 60 * 60 * 1000,
            'M': 30 * 24 * 60 * 60 * 1000,
        };

        return value * (unitMs[unit] || unitMs['h']);
    }

    static alignRangeToFullBars(
        startTime: number,
        endTime: number,
        interval: string,
    ): { startTime: number; endTime: number } | null {
        const intervalMs = HistoricalDataFetcher.getIntervalMilliseconds(interval);
        if (!Number.isFinite(intervalMs) || intervalMs <= 0) {
            return null;
        }

        const normalizedStart = Math.ceil(startTime / intervalMs) * intervalMs;
        const normalizedEnd = (Math.floor((endTime + 1) / intervalMs) * intervalMs) - 1;

        if (!Number.isFinite(normalizedStart) || !Number.isFinite(normalizedEnd) || normalizedStart > normalizedEnd) {
            return null;
        }

        return {
            startTime: normalizedStart,
            endTime: normalizedEnd,
        };
    }

    static auditKlines(params: {
        symbol: string;
        interval: string;
        requestedStartTime: number;
        requestedEndTime: number;
        klines: KlineData[];
    }): HistoricalRangeAudit {
        const { symbol, interval, requestedStartTime, requestedEndTime, klines } = params;
        const intervalMs = HistoricalDataFetcher.getIntervalMilliseconds(interval);
        const alignedRange = HistoricalDataFetcher.alignRangeToFullBars(requestedStartTime, requestedEndTime, interval);
        const actualBars = klines.length;
        const actualStartTime = actualBars > 0 ? klines[0].openTime : null;
        const actualEndTime = actualBars > 0 ? klines[actualBars - 1].closeTime : null;
        const expectedBars = alignedRange
            ? Math.max(0, Math.floor(((alignedRange.endTime + 1) - alignedRange.startTime) / intervalMs))
            : 0;
        const gapStats = detectKlineGaps(klines, intervalMs);
        const coverageRatio = expectedBars > 0 ? actualBars / expectedBars : 0;
        const coveragePercent = coverageRatio * 100;
        const backtestReady = expectedBars > 0
            && coveragePercent >= 98
            && gapStats.gapCount === 0
            && actualStartTime === alignedRange?.startTime
            && actualEndTime === alignedRange?.endTime;
        const readiness: HistoricalRangeReadiness = backtestReady
            ? 'ready'
            : actualBars > 0
                ? 'exploratory-only'
                : 'not-ready';
        const reasons: string[] = [];

        if (!alignedRange || expectedBars === 0) {
            reasons.push('请求区间内没有完整可用 bar。');
        }
        if (coveragePercent < 98) {
            reasons.push(`覆盖率仅 ${coveragePercent.toFixed(2)}%，低于正式回测阈值 98%。`);
        }
        if (gapStats.gapCount > 0) {
            reasons.push(`存在 ${gapStats.gapCount} 个缺口，共缺失 ${gapStats.missingBars} 根 bar。`);
        }
        if (alignedRange && actualStartTime !== null && actualStartTime > alignedRange.startTime) {
            reasons.push(`实际起点晚于请求起点：${new Date(actualStartTime).toISOString()} > ${new Date(alignedRange.startTime).toISOString()}`);
        }
        if (alignedRange && actualEndTime !== null && actualEndTime < alignedRange.endTime) {
            reasons.push(`实际终点早于请求终点：${new Date(actualEndTime).toISOString()} < ${new Date(alignedRange.endTime).toISOString()}`);
        }
        if (actualBars === 0) {
            reasons.push('没有返回任何历史 K 线。');
        }

        return {
            symbol: symbol.toUpperCase(),
            interval,
            requestedStartTime,
            requestedEndTime,
            expectedStartTime: alignedRange?.startTime ?? null,
            expectedEndTime: alignedRange?.endTime ?? null,
            actualStartTime,
            actualEndTime,
            actualBars,
            expectedBars,
            coverageRatio,
            coveragePercent,
            gapCount: gapStats.gapCount,
            missingBars: gapStats.missingBars,
            maxGapBars: gapStats.maxGapBars,
            hasGaps: gapStats.gapCount > 0,
            readiness,
            backtestReady,
            reasons,
        };
    }

    private async withRequestSlot<T>(task: () => Promise<T>): Promise<T> {
        if (this.activeRequestCount >= this.maxConcurrentRequests) {
            await new Promise<void>((resolve) => {
                this.requestQueue.push(resolve);
            });
        }

        this.activeRequestCount += 1;

        try {
            return await task();
        } finally {
            this.activeRequestCount -= 1;
            const next = this.requestQueue.shift();
            if (next) {
                next();
            }
        }
    }

    private isRetryableResponseStatus(status: number): boolean {
        return status === 408 || status === 429 || status >= 500;
    }

    private isRetryableRequestError(error: unknown): boolean {
        const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();

        return [
            'fetch failed',
            'networkerror',
            'network error',
            'timed out',
            'timeout',
            'terminated',
            'failed to fetch',
        ].some((pattern) => message.includes(pattern));
    }

    private async fetchChunkWithRetry(url: string): Promise<Response> {
        let lastError: Error | null = null;

        for (let attempt = 0; attempt < this.maxRequestAttempts; attempt += 1) {
            try {
                const response = await this.withRequestSlot(() => fetch(url));

                if (response.ok) {
                    return response;
                }

                const shouldRetry = this.isRetryableResponseStatus(response.status) && attempt < this.maxRequestAttempts - 1;
                if (shouldRetry) {
                    await this.sleep(250 * (attempt + 1));
                    continue;
                }

                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            } catch (error) {
                lastError = error instanceof Error ? error : new Error(String(error));
                const shouldRetry = this.isRetryableRequestError(error) && attempt < this.maxRequestAttempts - 1;

                if (!shouldRetry) {
                    throw lastError;
                }

                await this.sleep(250 * (attempt + 1));
            }
        }

        throw lastError ?? new Error('Unknown historical fetch failure');
    }

    /**
     * 获取指定时间范围的所有K线数据
     * @param symbol 交易对，如 'BTCUSDT'
     * @param interval 时间周期，如 '1h', '15m', '1d'
     * @param startTime 开始时间戳（毫秒）
     * @param endTime 结束时间戳（毫秒）
     * @returns 完整的K线数据数组
     */
    async fetchRangeData(
        symbol: string,
        interval: string,
        startTime: number,
        endTime: number,
        options: {
            includeAuxiliary?: boolean;
        } = {}
    ): Promise<KlineData[]> {
        const includeAuxiliary = options.includeAuxiliary !== false;
        const alignedRange = HistoricalDataFetcher.alignRangeToFullBars(startTime, endTime, interval);
        if (!alignedRange) {
            return [];
        }

        const cacheKey = this.buildCacheKey(symbol, interval, alignedRange.startTime, alignedRange.endTime, includeAuxiliary);
        const cachedRequest = this.rangeCache.get(cacheKey);
        if (cachedRequest) {
            return cachedRequest;
        }

        const request = (async () => {
            const allKlines: KlineData[] = [];
            let currentStart = alignedRange.startTime;
            const limit = this.maxLimit;
            const intervalMs = HistoricalDataFetcher.getIntervalMilliseconds(interval);

            while (currentStart <= alignedRange.endTime) {
                try {
                    const currentEnd = Math.min(alignedRange.endTime, currentStart + (intervalMs * limit) - 1);
                    const params = new URLSearchParams({
                        symbol,
                        interval,
                        startTime: currentStart.toString(),
                        endTime: currentEnd.toString(),
                        limit: limit.toString(),
                    });

                    if (!includeAuxiliary) {
                        params.append('includeAuxiliary', 'false');
                    }

                    const response = await this.fetchChunkWithRetry(`${this.baseUrl}?${params}`);

                    if (!response.ok) {
                        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
                    }

                    const result = await response.json();
                    const klines = Array.isArray(result.data) ? result.data as KlineData[] : [];

                    if (klines.length === 0) {
                        break;
                    }

                    const normalizedChunk = this.normalizeKlines(klines);
                    if (normalizedChunk.length === 0) {
                        break;
                    }

                    allKlines.push(...normalizedChunk);

                    const lastKline = normalizedChunk[normalizedChunk.length - 1];
                    const nextStart = lastKline.closeTime + 1;
                    if (!Number.isFinite(nextStart) || nextStart <= currentStart) {
                        throw new Error(`历史分页未向前推进: ${symbol} ${interval} @ ${currentStart}`);
                    }
                    currentStart = nextStart;

                    if (currentEnd >= alignedRange.endTime) {
                        break;
                    }

                    await this.sleep(includeAuxiliary ? 100 : 20);
                } catch (error) {
                    console.error('获取批量数据失败:', error);
                    throw error;
                }
            }

            return this.normalizeKlines(allKlines);
        })();

        this.rangeCache.set(cacheKey, request);

        try {
            return await request;
        } catch (error) {
            this.rangeCache.delete(cacheKey);
            throw error;
        }
    }

    async fetchRangeDataWithAudit(
        symbol: string,
        interval: string,
        startTime: number,
        endTime: number,
        options: {
            includeAuxiliary?: boolean;
        } = {}
    ): Promise<HistoricalRangeFetchResult> {
        const klines = await this.fetchRangeData(symbol, interval, startTime, endTime, options);
        return {
            klines,
            audit: HistoricalDataFetcher.auditKlines({
                symbol,
                interval,
                requestedStartTime: startTime,
                requestedEndTime: endTime,
                klines,
            }),
        };
    }

    /**
     * 获取最近N条K线数据
     * @param symbol 交易对
     * @param interval 时间周期
     * @param count 数据条数
     */
    async fetchRecentData(
        symbol: string,
        interval: string,
        count: number = 500,
        options: {
            includeAuxiliary?: boolean;
        } = {}
    ): Promise<KlineData[]> {
        const endTime = Date.now();
        const intervalMs = this.getIntervalMilliseconds(interval);
        const startTime = endTime - (intervalMs * count);

        return this.fetchRangeData(symbol, interval, startTime, endTime, options);
    }

    /**
     * 将时间周期转换为毫秒数
     */
    private getIntervalMilliseconds(interval: string): number {
        return HistoricalDataFetcher.getIntervalMilliseconds(interval);
    }

    /**
     * 延迟函数
     */
    private sleep(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    /**
     * 根据日期范围快速创建时间戳
     */
    static getTimeRange(
        startDate: string, // 格式: 'YYYY-MM-DD'
        endDate: string    // 格式: 'YYYY-MM-DD'
    ): { startTime: number; endTime: number } {
        const startTime = parseUtcDateString(startDate);
        const endTime = parseUtcDateString(endDate);
        return { startTime, endTime };
    }

    /**
     * 预设时间范围
     */
    static getPresetRange(preset: '1d' | '7d' | '30d' | '90d' | '180d' | '1y'): {
        startTime: number;
        endTime: number;
    } {
        const endTime = Date.now();
        const ranges: Record<string, number> = {
            '1d': 1 * 24 * 60 * 60 * 1000,
            '7d': 7 * 24 * 60 * 60 * 1000,
            '30d': 30 * 24 * 60 * 60 * 1000,
            '90d': 90 * 24 * 60 * 60 * 1000,
            '180d': 180 * 24 * 60 * 60 * 1000,
            '1y': 365 * 24 * 60 * 60 * 1000,
        };

        const startTime = endTime - ranges[preset];
        return { startTime, endTime };
    }
}

// 导出单例
export const historicalDataFetcher = new HistoricalDataFetcher();
