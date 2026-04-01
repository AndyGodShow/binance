import { KlineData } from '@/app/api/backtest/klines/route';

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
    private baseUrl = '/api/backtest/klines';
    private maxLimit = 1500;
    private readonly rangeCache = new Map<string, Promise<KlineData[]>>();

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
        const cacheKey = this.buildCacheKey(symbol, interval, startTime, endTime, includeAuxiliary);
        const cachedRequest = this.rangeCache.get(cacheKey);
        if (cachedRequest) {
            return cachedRequest;
        }

        const request = (async () => {
            const allKlines: KlineData[] = [];
            let currentStart = startTime;
            const limit = this.maxLimit;
            const intervalMs = this.getIntervalMilliseconds(interval);

            while (currentStart < endTime) {
                try {
                    const currentEnd = Math.min(endTime, currentStart + (intervalMs * limit) - 1);
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

                    const response = await fetch(`${this.baseUrl}?${params}`);

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
                    currentStart = Math.max(currentStart + 1, lastKline.closeTime + 1);

                    if (normalizedChunk.length < limit || currentEnd >= endTime) {
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
        const unit = interval.slice(-1);
        const value = parseInt(interval.slice(0, -1));

        const unitMs: Record<string, number> = {
            'm': 60 * 1000,           // 分钟
            'h': 60 * 60 * 1000,      // 小时
            'd': 24 * 60 * 60 * 1000, // 天
            'w': 7 * 24 * 60 * 60 * 1000,  // 周
            'M': 30 * 24 * 60 * 60 * 1000, // 月（近似）
        };

        return value * (unitMs[unit] || unitMs['h']);
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
