import { KlineData } from '@/app/api/backtest/klines/route';

/**
 * 批量获取历史K线数据
 * 自动处理分页，突破单次1500条的限制
 */
export class HistoricalDataFetcher {
    private baseUrl = '/api/backtest/klines';

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
        endTime: number
    ): Promise<KlineData[]> {
        const allKlines: KlineData[] = [];
        let currentStart = startTime;
        const limit = 1500; // 单次最大请求数

        // 计算每个K线的时间跨度（毫秒）
        const intervalMs = this.getIntervalMilliseconds(interval);

        while (currentStart < endTime) {
            try {
                const params = new URLSearchParams({
                    symbol,
                    interval,
                    startTime: currentStart.toString(),
                    endTime: endTime.toString(),
                    limit: limit.toString(),
                });

                const response = await fetch(`${this.baseUrl}?${params}`);

                if (!response.ok) {
                    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
                }

                const result = await response.json();
                const klines = result.data as KlineData[];

                if (klines.length === 0) break;

                allKlines.push(...klines);

                // 更新下一次请求的起始时间
                const lastKline = klines[klines.length - 1];
                currentStart = lastKline.closeTime + 1;

                // 如果返回的数据少于limit，说明已经到达结束时间
                if (klines.length < limit) break;

                // 避免请求过快，添加短暂延迟
                await this.sleep(100);

            } catch (error) {
                console.error('获取批量数据失败:', error);
                throw error;
            }
        }

        return allKlines;
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
        count: number = 500
    ): Promise<KlineData[]> {
        const endTime = Date.now();
        const intervalMs = this.getIntervalMilliseconds(interval);
        const startTime = endTime - (intervalMs * count);

        return this.fetchRangeData(symbol, interval, startTime, endTime);
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
        const startTime = new Date(startDate).getTime();
        const endTime = new Date(endDate).getTime();
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
