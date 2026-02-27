import { TickerData } from './types';

// 策略接口
export interface TradingStrategy {
    id: string;
    name: string;
    description: string;
    category: 'trend' | 'volume' | 'funding' | 'special';
    enabled: boolean;
    detect: (ticker: TickerData) => StrategySignal | null;
}

// 复合策略的子条件
export interface CompositeCondition {
    name: string;           // 条件名称
    met: boolean;           // 是否满足
    value?: number;         // 实际值
    threshold?: number;     // 阈值
    description: string;    // 条件描述
}

// 策略信号
export interface StrategySignal {
    symbol: string;
    strategyId: string;
    strategyName: string;
    direction: 'long' | 'short';
    confidence: number;              // 置信度 0-100
    reason: string;                  // 触发原因
    metrics: Record<string, number>; // 关键指标
    timestamp: number;
    price?: number;                  // 触发时的价格

    // 叠加策略相关（用于共振检测）
    stackCount?: number;             // 叠加策略数量
    stackedStrategies?: string[];    // 叠加的策略名称列表
    comboBonus?: number;             // 叠加加成分数

    // 复合策略相关
    isComposite?: boolean;           // 是否为复合策略
    conditions?: CompositeCondition[]; // 满足的条件列表
    conditionsMet?: number;          // 满足的条件数量
    totalConditions?: number;        // 总条件数量

    // 🔥 风险管理相关
    risk?: {
        stopLoss: {
            price: number;
            percentage: number;
            reason: string;
        };
        takeProfit: {
            targets: Array<{
                price: number;
                percentage: number;
                closePercentage: number;
                reason: string;
            }>;
            riskRewardRatio: number;
        };
        positionSizing: {
            percentage: number;
            leverage: number;
            maxRiskAmount: number;
            reasoning: string;
        };
        metrics: {
            entryPrice: number;
            riskAmount: number;
            potentialProfit: number;
        };
    };
}

// 策略配置（预留）
export interface StrategyConfig {
    [key: string]: number | boolean | string;
}
