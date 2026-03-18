/**
 * 策略风控可配置参数
 * 每个策略有默认值，用户可在回测面板覆盖
 */

// ==================== 止损配置 ====================
export interface StopLossConfig {
    type: 'fixed' | 'trailing' | 'atr' | 'indicator';
    fixedPercentage?: number;     // 固定百分比止损
    atrMultiplier?: number;       // ATR 倍数止损
    maxPercentage?: number;       // 止损上限百分比
}

// ==================== 止盈目标配置 ====================
export interface TakeProfitTargetConfig {
    atrMultiplier?: number;       // ATR 倍数
    stopMultiplier?: number;      // 止损距离的倍数
    fixedPercentage?: number;     // 固定百分比
    closePercentage: number;      // 平仓比例 (0-100)
    moveStopToEntry?: boolean;    // 达成后移止损到保本
}

// ==================== 完整风控配置 ====================
export interface StrategyRiskConfig {
    stopLoss: StopLossConfig;
    takeProfit: {
        targets: TakeProfitTargetConfig[];
    };
    timeStop?: {
        maxBars: number;
        profitThreshold: number;
    };
    maxLeverage: number;
    historicalWinRate: number;    // 历史胜率（0-1）
    historicalAvgWin: number;    // 平均盈利%
    historicalAvgLoss: number;   // 平均亏损%
}

export function resolveRiskConfigStrategyId(strategyId: string): string {
    if (strategyId === 'rsrs-trend') {
        return 'rsrs';
    }

    return strategyId;
}

export function getDefaultRiskConfig(strategyId: string): StrategyRiskConfig {
    const resolvedId = resolveRiskConfigStrategyId(strategyId);
    const defaults = DEFAULT_RISK_CONFIGS[resolvedId] || DEFAULT_RISK_CONFIGS['strong-breakout'];
    return JSON.parse(JSON.stringify(defaults)) as StrategyRiskConfig;
}

// ==================== 各策略默认配置 ====================

export const DEFAULT_RISK_CONFIGS: Record<string, StrategyRiskConfig> = {
    // 强势突破策略
    'strong-breakout': {
        stopLoss: {
            type: 'atr',
            atrMultiplier: 1.5,
            maxPercentage: 5,
        },
        takeProfit: {
            targets: [
                { atrMultiplier: 3, closePercentage: 50, moveStopToEntry: false },
                { atrMultiplier: 5, closePercentage: 100, moveStopToEntry: false },
            ],
        },
        timeStop: { maxBars: 5, profitThreshold: 1.0 },
        maxLeverage: 3,
        historicalWinRate: 0.55,
        historicalAvgWin: 4.0,
        historicalAvgLoss: 2.5,
    },

    // 趋势确认策略
    'trend-confirmation': {
        stopLoss: {
            type: 'trailing',
            atrMultiplier: 1.5,  // KC中轨 - 1.5×ATR
            maxPercentage: 8,
        },
        takeProfit: {
            targets: [
                { fixedPercentage: 6, closePercentage: 20, moveStopToEntry: false },
                { atrMultiplier: 4, closePercentage: 100, moveStopToEntry: false },
            ],
        },
        timeStop: { maxBars: 10, profitThreshold: 1.5 },
        maxLeverage: 5,
        historicalWinRate: 0.62,
        historicalAvgWin: 4.5,
        historicalAvgLoss: 2.0,
    },

    // 资金流入策略
    'capital-inflow': {
        stopLoss: {
            type: 'indicator',  // POC/VAL
            atrMultiplier: 2,   // fallback
            maxPercentage: 6,
        },
        takeProfit: {
            targets: [
                { atrMultiplier: 2.5, closePercentage: 50, moveStopToEntry: false },
                { atrMultiplier: 3.5, closePercentage: 100, moveStopToEntry: false },
            ],
        },
        maxLeverage: 3,
        historicalWinRate: 0.58,
        historicalAvgWin: 3.5,
        historicalAvgLoss: 2.0,
    },

    // RSRS 量化策略
    'rsrs': {
        stopLoss: {
            type: 'indicator',  // Bollinger
            fixedPercentage: 3,
            maxPercentage: 4,
        },
        takeProfit: {
            targets: [
                { fixedPercentage: 2.5, closePercentage: 100, moveStopToEntry: false },
            ],
        },
        maxLeverage: 2,
        historicalWinRate: 0.68,
        historicalAvgWin: 2.5,
        historicalAvgLoss: 3.0,
    },

    // 波动率挤压策略
    'volatility-squeeze': {
        stopLoss: {
            type: 'indicator',  // KC 下轨
            fixedPercentage: 1.5,
            maxPercentage: 3,
        },
        takeProfit: {
            targets: [
                { stopMultiplier: 2, closePercentage: 50, moveStopToEntry: true },
                { stopMultiplier: 3, closePercentage: 100, moveStopToEntry: false },
            ],
        },
        maxLeverage: 4,
        historicalWinRate: 0.65,
        historicalAvgWin: 5.5,
        historicalAvgLoss: 1.5,
    },
};

/**
 * 获取策略风控配置（用户覆盖 > 策略默认值）
 */
export function getStrategyRiskConfig(
    strategyId: string,
    overrides?: Partial<StrategyRiskConfig>
): StrategyRiskConfig {
    const defaults = getDefaultRiskConfig(strategyId);

    if (!overrides) return { ...defaults };

    return {
        stopLoss: overrides.stopLoss
            ? { ...defaults.stopLoss, ...overrides.stopLoss }
            : defaults.stopLoss,
        takeProfit: overrides.takeProfit
            ? { targets: overrides.takeProfit.targets || defaults.takeProfit.targets }
            : defaults.takeProfit,
        timeStop: overrides.timeStop ?? defaults.timeStop,
        maxLeverage: overrides.maxLeverage ?? defaults.maxLeverage,
        historicalWinRate: overrides.historicalWinRate ?? defaults.historicalWinRate,
        historicalAvgWin: overrides.historicalAvgWin ?? defaults.historicalAvgWin,
        historicalAvgLoss: overrides.historicalAvgLoss ?? defaults.historicalAvgLoss,
    };
}
