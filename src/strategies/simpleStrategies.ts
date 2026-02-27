import { TradingStrategy, StrategySignal } from '../lib/strategyTypes';
import { TickerData } from '../lib/types';

/**
 * 简单移动平均策略 - 用于回测测试
 * 当价格上穿移动平均线时做多，下穿时做空
 */
export const simpleMAStrategy: TradingStrategy = {
    id: 'simple-ma',
    name: '📈 简单均线策略',
    description: '价格上穿/下穿移动平均线交易（测试用）',
    category: 'trend',
    enabled: true,

    detect: (ticker: TickerData): StrategySignal | null => {
        // 获取多周期价格变化
        const change1h = ticker.change1h || 0;
        const change4h = ticker.change4h || 0;

        // 简单策略：
        // 做多信号：1小时涨幅 > 2% 且 4小时涨幅 > 1%
        const isLongSignal = change1h > 2 && change4h > 1;

        // 做空信号：1小时跌幅 > 2% 且 4小时跌幅 > 1%
        const isShortSignal = change1h < -2 && change4h < -1;

        if (isLongSignal) {
            return {
                symbol: ticker.symbol,
                strategyId: 'simple-ma',
                strategyName: '📈 简单均线策略',
                direction: 'long',
                confidence: 80,
                reason: `1h涨${change1h.toFixed(1)}%, 4h涨${change4h.toFixed(1)}%`,
                metrics: {
                    change1h,
                    change4h,
                },
                timestamp: Date.now(),
            };
        }

        if (isShortSignal) {
            return {
                symbol: ticker.symbol,
                strategyId: 'simple-ma',
                strategyName: '📈 简单均线策略',
                direction: 'short',
                confidence: 80,
                reason: `1h跌${Math.abs(change1h).toFixed(1)}%, 4h跌${Math.abs(change4h).toFixed(1)}%`,
                metrics: {
                    change1h,
                    change4h,
                },
                timestamp: Date.now(),
            };
        }

        return null;
    }
};

/**
 * 价格突破策略 - 简化版
 * 基于短期强势突破
 */
export const simpleMomentumStrategy: TradingStrategy = {
    id: 'simple-momentum',
    name: '⚡ 动量突破策略',
    description: '短期强势突破（简化版）',
    category: 'trend',
    enabled: true,

    detect: (ticker: TickerData): StrategySignal | null => {
        const change15m = ticker.change15m || 0;
        const change1h = ticker.change1h || 0;
        const volume = parseFloat(ticker.quoteVolume);

        // 做多：15分钟涨幅 > 3% 且成交量 > 5000万
        const isLongSignal = change15m > 3 && volume > 50000000;

        // 计算置信度（基于涨幅强度）
        let confidence = 75;
        if (change15m > 5) confidence += 10;
        if (change1h > 3) confidence += 5;

        if (isLongSignal) {
            return {
                symbol: ticker.symbol,
                strategyId: 'simple-momentum',
                strategyName: '⚡ 动量突破策略',
                direction: 'long',
                confidence: Math.min(95, confidence),
                reason: `15m强势上涨${change15m.toFixed(1)}%, 成交量${(volume / 1e6).toFixed(0)}M`,
                metrics: {
                    change15m,
                    change1h,
                    volume,
                },
                timestamp: Date.now(),
            };
        }

        return null;
    }
};
