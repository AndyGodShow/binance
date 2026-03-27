/**
 * 统一Cooldown管理器
 * 用于管理策略信号冷却期，自动清理过期记录，防止内存泄漏
 */

class CooldownManager {
    private cooldowns = new Map<string, number>();
    private cleanupInterval: NodeJS.Timeout | null = null;
    private readonly cleanupIntervalMs = 10 * 60 * 1000; // 10分钟清理一次

    constructor() {
        // 启动自动清理
        this.startAutoCleanup();
    }

    /**
     * 检查是否在冷却期内
     * @param symbol 币种符号
     * @param strategyId 策略ID
     * @param period 冷却期时长（毫秒）
     * @returns true表示在冷却期内，应该跳过
     */
    check(symbol: string, strategyId: string, period: number): boolean {
        const key = `${symbol}:${strategyId}`;
        const lastSignal = this.cooldowns.get(key);

        if (lastSignal && Date.now() - lastSignal < period) {
            return true; // 在冷却期内
        }

        return false;
    }

    /**
     * 记录一次信号触发
     * @param symbol 币种符号
     * @param strategyId 策略ID
     */
    record(symbol: string, strategyId: string): void {
        const key = `${symbol}:${strategyId}`;
        this.cooldowns.set(key, Date.now());
    }

    /**
     * 清理过期的冷却记录
     * @param maxAge 最大保留时长（毫秒），默认2小时
     */
    cleanup(maxAge: number = 2 * 60 * 60 * 1000): void {
        const now = Date.now();
        const keysToDelete: string[] = [];

        for (const [key, timestamp] of this.cooldowns.entries()) {
            if (now - timestamp > maxAge) {
                keysToDelete.push(key);
            }
        }

        keysToDelete.forEach(key => this.cooldowns.delete(key));

        if (keysToDelete.length > 0) {
            console.info(`[CooldownManager] Cleaned up ${keysToDelete.length} expired records`);
        }
    }

    /**
     * 启动自动清理
     */
    private startAutoCleanup(): void {
        if (this.cleanupInterval) return;
        // 使用 globalThis 标记防止 Next.js 热重载时重复创建 interval
        const guardKey = '__cooldownManagerCleanupStarted';
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
     * 获取当前cooldown记录数量（调试用）
     */
    getSize(): number {
        return this.cooldowns.size;
    }

    /**
     * 清空所有记录
     */
    clear(): void {
        this.cooldowns.clear();
    }

    /**
     * 快照当前冷却状态（用于回测隔离）
     */
    snapshot(): Map<string, number> {
        return new Map(this.cooldowns);
    }

    /**
     * 恢复之前的冷却状态（用于回测结束后还原实时扫描环境）
     */
    restore(snapshot: Map<string, number>): void {
        this.cooldowns = new Map(snapshot);
    }
}

// 单例导出
export const cooldownManager = new CooldownManager();
