import { TradingStrategy } from '../lib/strategyTypes';
import {
    strongBreakoutStrategy,
    trendConfirmationStrategy,
    capitalInflowStrategy
} from './compositeStrategies';
import { rsrsStrategy } from './rsrs';
import { volatilitySqueezeStrategy } from './volatilitySqueeze';

class StrategyRegistry {
    private strategies: Map<string, TradingStrategy> = new Map();
    private listeners: Set<() => void> = new Set();
    private enabledStrategyIds: Set<string> = new Set();

    constructor() {
        // 注册复合策略（高准确率）
        this.register(strongBreakoutStrategy);
        this.register(trendConfirmationStrategy);
        this.register(capitalInflowStrategy);

        // 注册 RSRS 策略
        this.register(rsrsStrategy);

        // 注册 Volatility Squeeze 策略
        this.register(volatilitySqueezeStrategy);
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
            this.notify(); // 触发更新通知
        }
    }

    getByCategory(category: TradingStrategy['category']): TradingStrategy[] {
        return this.getAll().filter(s => s.category === category);
    }
}

// 单例导出
export const strategyRegistry = new StrategyRegistry();
