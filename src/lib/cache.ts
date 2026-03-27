/**
 * LRU缓存实现
 * 用于缓存K线数据和其他频繁访问的数据
 */

import { APP_CONFIG } from './config';
import { logger } from './logger';

interface CacheEntry<T> {
    value: T;
    timestamp: number;
    expiresAt: number;
}

export class LRUCache<T> {
    private cache = new Map<string, CacheEntry<T>>();
    private maxSize: number;
    private defaultTTL: number; // Time to live in milliseconds

    constructor(maxSize: number = 100, defaultTTL: number = 5 * 60 * 1000) {
        this.maxSize = maxSize;
        this.defaultTTL = defaultTTL;
    }

    /**
     * 获取缓存值
     * @param key 缓存键
     * @returns 缓存值，如果不存在或已过期则返回undefined
     */
    get(key: string): T | undefined {
        const entry = this.cache.get(key);

        if (!entry) {
            return undefined;
        }

        // 检查是否过期
        if (Date.now() > entry.expiresAt) {
            this.cache.delete(key);
            return undefined;
        }

        // LRU: 重新插入以更新顺序
        this.cache.delete(key);
        this.cache.set(key, entry);

        return entry.value;
    }

    /**
     * 设置缓存值
     * @param key 缓存键
     * @param value 缓存值
     * @param ttl 过期时间（毫秒），可选
     */
    set(key: string, value: T, ttl?: number): void {
        const expiresAt = Date.now() + (ttl || this.defaultTTL);

        // 如果已存在，先删除
        if (this.cache.has(key)) {
            this.cache.delete(key);
        }

        // 如果达到最大容量，删除最旧的项（Map的第一个元素）
        if (this.cache.size >= this.maxSize) {
            const firstKey = this.cache.keys().next().value;
            if (firstKey !== undefined) {
                this.cache.delete(firstKey);
                logger.debug('LRU cache evicted oldest entry', { key: firstKey });
            }
        }

        this.cache.set(key, {
            value,
            timestamp: Date.now(),
            expiresAt
        });
    }

    /**
     * 检查缓存中是否有指定键
     * @param key 缓存键
     */
    has(key: string): boolean {
        const entry = this.cache.get(key);
        if (!entry) return false;

        // 检查是否过期
        if (Date.now() > entry.expiresAt) {
            this.cache.delete(key);
            return false;
        }

        return true;
    }

    /**
     * 删除指定键
     * @param key 缓存键
     */
    delete(key: string): boolean {
        return this.cache.delete(key);
    }

    /**
     * 清空缓存
     */
    clear(): void {
        this.cache.clear();
    }

    /**
     * 获取当前缓存大小
     */
    size(): number {
        return this.cache.size;
    }

    /**
     * 清理所有过期的缓存项
     */
    cleanupExpired(): number {
        const now = Date.now();
        let cleaned = 0;

        for (const [key, entry] of this.cache.entries()) {
            if (now > entry.expiresAt) {
                this.cache.delete(key);
                cleaned++;
            }
        }

        if (cleaned > 0) {
            logger.debug(`Cleaned up ${cleaned} expired cache entries`);
        }

        return cleaned;
    }

    /**
     * 获取缓存统计信息
     */
    getStats(): {
        size: number;
        maxSize: number;
        utilizationPercent: number;
    } {
        return {
            size: this.cache.size,
            maxSize: this.maxSize,
            utilizationPercent: (this.cache.size / this.maxSize) * 100
        };
    }
}

// 导出全局K线缓存实例
export const klineCache = new LRUCache(
    APP_CONFIG.CACHE.KLINE_MAX_SIZE,
    APP_CONFIG.CACHE.KLINE_TTL
);

// 定期清理过期缓存（使用 globalThis 标记防止热重载时重复创建 interval）
if (!(globalThis as Record<string, unknown>)['__klineCacheCleanupStarted']) {
    (globalThis as Record<string, unknown>)['__klineCacheCleanupStarted'] = true;
    setInterval(() => {
        klineCache.cleanupExpired();
    }, 60 * 1000); // 每分钟清理一次
}
