/**
 * 历史数据追踪器
 * 用于追踪 OI、Volume、Funding Rate 等数据的变化率
 */

interface HistoricalSnapshot {
    timestamp: number;
    openInterestValue: number;
    volume: number;
    fundingRate: number;
}

class HistoricalDataTracker {
    private history: Map<string, HistoricalSnapshot[]> = new Map();
    private maxHistorySize = 10; // 保留最近 10 个快照
    private cleanupInterval: NodeJS.Timeout | null = null;
    private readonly cleanupIntervalMs = 10 * 60 * 1000; // 10分钟清理一次

    constructor() {
        // 启动自动清理
        this.startAutoCleanup();
    }

    /**
     * 添加新的数据快照
     */
    addSnapshot(symbol: string, data: {
        openInterestValue: number;
        volume: number;
        fundingRate: number;
    }) {
        const snapshot: HistoricalSnapshot = {
            timestamp: Date.now(),
            ...data
        };

        const symbolHistory = this.history.get(symbol) || [];
        symbolHistory.push(snapshot);

        // 保留最近的 N 个快照
        if (symbolHistory.length > this.maxHistorySize) {
            symbolHistory.shift();
        }

        this.history.set(symbol, symbolHistory);
    }

    /**
     * 计算变化率（相对于前一个快照）
     */
    getChangePercent(symbol: string): {
        oiChangePercent: number;
        volumeChangePercent: number;
        fundingRateVelocity: number;
        fundingRateTrend: 'up' | 'down' | 'stable';
    } {
        const symbolHistory = this.history.get(symbol);

        if (!symbolHistory || symbolHistory.length < 2) {
            return {
                oiChangePercent: 0,
                volumeChangePercent: 0,
                fundingRateVelocity: 0,
                fundingRateTrend: 'stable'
            };
        }

        const current = symbolHistory[symbolHistory.length - 1];
        const previous = symbolHistory[symbolHistory.length - 2];

        // 计算 OI 变化率
        const oiChange = previous.openInterestValue > 0
            ? ((current.openInterestValue - previous.openInterestValue) / previous.openInterestValue) * 100
            : 0;

        // 计算 Volume 变化率
        const volumeChange = previous.volume > 0
            ? ((current.volume - previous.volume) / previous.volume) * 100
            : 0;

        // 计算 Funding Rate 变化率（速度）
        const timeInterval = (current.timestamp - previous.timestamp) / (1000 * 60 * 60); // 小时
        const fundingVelocity = timeInterval > 0
            ? (current.fundingRate - previous.fundingRate) / timeInterval
            : 0;

        // 判断趋势方向
        let fundingTrend: 'up' | 'down' | 'stable' = 'stable';
        if (Math.abs(fundingVelocity) > 0.00001) { // 阈值：0.001%/h
            fundingTrend = fundingVelocity > 0 ? 'up' : 'down';
        }

        return {
            oiChangePercent: oiChange,
            volumeChangePercent: volumeChange,
            fundingRateVelocity: fundingVelocity,
            fundingRateTrend: fundingTrend
        };
    }

    /**
     * 清理旧数据（可选，节省内存）
     */
    cleanup(maxAge: number = 30 * 60 * 1000) { // 默认 30 分钟
        const now = Date.now();

        for (const [symbol, snapshots] of this.history.entries()) {
            const filtered = snapshots.filter(s => now - s.timestamp < maxAge);

            if (filtered.length === 0) {
                this.history.delete(symbol);
            } else {
                this.history.set(symbol, filtered);
            }
        }
    }

    /**
     * 启动自动清理
     */
    private startAutoCleanup(): void {
        if (this.cleanupInterval) return;
        // 使用 globalThis 标记防止 Next.js 热重载时重复创建 interval
        const guardKey = '__historicalTrackerCleanupStarted';
        if ((globalThis as Record<string, unknown>)[guardKey]) return;
        (globalThis as Record<string, unknown>)[guardKey] = true;

        this.cleanupInterval = setInterval(() => {
            this.cleanup();
        }, this.cleanupIntervalMs);
    }

    /**
     * 停止自动清理（用于测试或清理资源）
     */
    stopAutoCleanup(): void {
        if (this.cleanupInterval) {
            clearInterval(this.cleanupInterval);
            this.cleanupInterval = null;
        }
    }

    /**
     * 获取当前历史记录数量（调试用）
     */
    getSize(): number {
        return this.history.size;
    }
}

// 单例导出：使用 globalThis 防止 Next.js 热重载导致多个实例堆积死锁
export const historicalTracker = 
    (globalThis as any).__historicalTracker || 
    ((globalThis as any).__historicalTracker = new HistoricalDataTracker());
