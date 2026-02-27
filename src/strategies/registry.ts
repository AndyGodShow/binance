import { TradingStrategy } from '../lib/strategyTypes';
import {
    strongBreakoutStrategy,
    trendConfirmationStrategy,
    capitalInflowStrategy
} from './compositeStrategies';
import { rsrsStrategy } from './rsrs';
import { volatilitySqueezeStrategy } from './volatilitySqueeze';
import { simpleMAStrategy, simpleMomentumStrategy } from './simpleStrategies';

class StrategyRegistry {
    private strategies: Map<string, TradingStrategy> = new Map();
    private listeners: Set<() => void> = new Set();

    constructor() {
        // 注册简单测试策略（用于回测）
        this.register(simpleMAStrategy);
        this.register(simpleMomentumStrategy);

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
    }

    getAll(): TradingStrategy[] {
        return Array.from(this.strategies.values());
    }

    getEnabled(): TradingStrategy[] {
        return this.getAll().filter(s => s.enabled);
    }

    getById(id: string): TradingStrategy | undefined {
        return this.strategies.get(id);
    }

    toggleStrategy(id: string) {
        const strategy = this.strategies.get(id);
        if (strategy) {
            strategy.enabled = !strategy.enabled;
            this.notify(); // 触发更新通知
        }
    }

    getByCategory(category: TradingStrategy['category']): TradingStrategy[] {
        return this.getAll().filter(s => s.category === category);
    }
}

// 单例导出
export const strategyRegistry = new StrategyRegistry();

