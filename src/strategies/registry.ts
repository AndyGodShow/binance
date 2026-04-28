import type { TradingStrategy } from '../lib/strategyTypes.ts';
import {
    strongBreakoutStrategy,
    trendConfirmationStrategy,
    capitalInflowStrategy
} from './compositeStrategies.ts';
import { rsrsStrategy } from './rsrs.ts';
import { sentimentHotspotStrategy } from './sentimentHotspot.ts';
import { volatilitySqueezeStrategy } from './volatilitySqueeze.ts';
import { weiShenStrategy } from './weiShen.ts';

const STRATEGY_ENABLED_IDS_STORAGE_KEY = 'strategyEnabledIds';

interface StrategyRegistryStorage {
    getItem(key: string): string | null;
    setItem(key: string, value: string): void;
}

interface StrategyRegistryOptions {
    strategies?: TradingStrategy[];
    storage?: StrategyRegistryStorage | null;
}

const DEFAULT_STRATEGIES = [
    strongBreakoutStrategy,
    trendConfirmationStrategy,
    capitalInflowStrategy,
    rsrsStrategy,
    volatilitySqueezeStrategy,
    weiShenStrategy,
    sentimentHotspotStrategy,
] as const;

function getBrowserStorage(): StrategyRegistryStorage | null {
    if (typeof window === 'undefined') {
        return null;
    }

    return window.localStorage;
}

export class StrategyRegistry {
    private strategies: Map<string, TradingStrategy> = new Map();
    private listeners: Set<() => void> = new Set();
    private enabledStrategyIds: Set<string> = new Set();
    private storage: StrategyRegistryStorage | null;

    constructor(options: StrategyRegistryOptions = {}) {
        this.storage = options.storage === undefined ? getBrowserStorage() : options.storage;
        const strategies = options.strategies ?? DEFAULT_STRATEGIES;

        strategies.forEach((strategy) => this.register(strategy));
        this.restoreEnabledStrategyIds();
    }

    private restoreEnabledStrategyIds() {
        const saved = this.storage?.getItem(STRATEGY_ENABLED_IDS_STORAGE_KEY);
        if (!saved) {
            return;
        }

        try {
            const parsed = JSON.parse(saved);
            if (!Array.isArray(parsed)) {
                return;
            }

            const nextEnabled = new Set<string>();
            parsed.forEach((id) => {
                if (typeof id === 'string' && this.strategies.has(id)) {
                    nextEnabled.add(id);
                }
            });
            this.enabledStrategyIds = nextEnabled;
        } catch (err) {
            console.warn('Failed to restore enabled strategies:', err);
        }
    }

    private persistEnabledStrategyIds() {
        try {
            this.storage?.setItem(
                STRATEGY_ENABLED_IDS_STORAGE_KEY,
                JSON.stringify(Array.from(this.enabledStrategyIds)),
            );
        } catch (err) {
            console.warn('Failed to persist enabled strategies:', err);
        }
    }

    /**
     * 订阅策略变化事件
     * @returns 取消订阅的函数
     */
    subscribe(listener: () => void): () => void {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    /**
     * 通知所有订阅者
     */
    private notify() {
        this.listeners.forEach(listener => {
            try {
                listener();
            } catch (err) {
                console.error('策略变化通知失败:', err);
            }
        });
    }

    register(strategy: TradingStrategy) {
        this.strategies.set(strategy.id, strategy);
        // 如果策略默认启用，加入已启用集合
        if (strategy.enabled) {
            this.enabledStrategyIds.add(strategy.id);
        }
    }

    getAll(): TradingStrategy[] {
        return Array.from(this.strategies.values()).map(s => ({
            ...s,
            enabled: this.enabledStrategyIds.has(s.id)
        }));
    }

    getEnabled(): TradingStrategy[] {
        return this.getAll().filter(s => s.enabled);
    }

    getById(id: string): TradingStrategy | undefined {
        const strategy = this.strategies.get(id);
        if (!strategy) return undefined;
        return {
            ...strategy,
            enabled: this.enabledStrategyIds.has(id)
        };
    }

    toggleStrategy(id: string) {
        if (this.strategies.has(id)) {
            if (this.enabledStrategyIds.has(id)) {
                this.enabledStrategyIds.delete(id);
            } else {
                this.enabledStrategyIds.add(id);
            }
            this.persistEnabledStrategyIds();
            this.notify(); // 触发更新通知
        }
    }
}

// 单例导出
export const strategyRegistry = new StrategyRegistry();
