/**
 * 应用配置管理
 * 集中管理所有可配置的参数
 */

export const APP_CONFIG = {
    // 账户配置
    ACCOUNT: {
        DEFAULT_BALANCE: 10000,        // 默认账户余额（USDT）
        DEFAULT_RISK_PERCENTAGE: 1,    // 默认风险百分比
    },

    // 缓存配置
    CACHE: {
        KLINE_TTL: 5 * 60 * 1000,      // K线数据缓存时间（5分钟）
        KLINE_MAX_SIZE: 200,           // K线缓存最大条目数
        BTC_RETURNS_TTL: 5 * 60 * 1000, // BTC收益率缓存时间（5分钟）
    },

    // API配置
    API: {
        MAX_RETRIES: 3,                 // API最大重试次数
        RETRY_INITIAL_DELAY: 1000,      // 重试初始延迟（毫秒）
        RETRY_MAX_DELAY: 10000,         // 重试最大延迟（毫秒）
        BATCH_SIZE: 5,                  // K线批量获取大小
        BATCH_DELAY: 100,               // 批次间延迟（毫秒）
        REVALIDATE_MARKET: 5,           // 市场数据重新验证时间（秒）
    },

    // 历史数据追踪配置
    HISTORY: {
        MAX_SNAPSHOTS: 10,              // 每个币种最大快照数
        CLEANUP_INTERVAL: 10 * 60 * 1000, // 清理间隔（10分钟）
        MAX_AGE: 30 * 60 * 1000,        // 最大数据年龄（30分钟）
    },

    // 冷却期配置
    COOLDOWN: {
        CLEANUP_INTERVAL: 10 * 60 * 1000, // 冷却期清理间隔（10分钟）
        MAX_AGE: 2 * 60 * 60 * 1000,    // 冷却期最大保留时间（2小时）
    },

    // 策略配置
    STRATEGY: {
        MIN_CONFIDENCE: 85,             // 最低置信度阈值
        STRONG_BREAKOUT_COOLDOWN: 45 * 60 * 1000,  // 强势突破冷却期（45分钟）
        TREND_CONFIRMATION_COOLDOWN: 60 * 60 * 1000, // 趋势确认冷却期（60分钟）
        CAPITAL_INFLOW_COOLDOWN: 30 * 60 * 1000,   // 资金流入冷却期（30分钟）
        VOLATILITY_SQUEEZE_COOLDOWN: 60 * 60 * 1000, // 波动率挤压冷却期（60分钟）
        RSRS_COOLDOWN: 120 * 60 * 1000,  // RSRS策略冷却期（120分钟）
    },

    // 技术指标配置
    INDICATORS: {
        TOP_SYMBOLS_FOR_INDICATORS: 50,  // 计算技术指标的前N个币种
        BOLLINGER_PERIOD: 20,            // 布林带周期
        BOLLINGER_STD_DEV: 2,            // 布林带标准差倍数
        KELTNER_PERIOD: 20,              // 肯特纳通道周期
        KELTNER_MULTIPLIER: 1.5,         // 肯特纳通道倍数
        ATR_PERIOD: 14,                  // ATR周期
        ADX_PERIOD: 14,                  // ADX周期
        MIN_KLINES_FOR_SQUEEZE: 50,      // Squeeze计算最少K线数
    },

    // 回测配置
    BACKTEST: {
        DEFAULT_INITIAL_CAPITAL: 10000,  // 默认初始资金
        DEFAULT_STOP_LOSS: 5,            // 默认止损百分比
        DEFAULT_TAKE_PROFIT: 10,         // 默认止盈百分比
        DEFAULT_COMMISSION: 0.04,        // 默认手续费百分比
        DEFAULT_SLIPPAGE: 0.05,          // 默认滑点百分比
    },

    // UI配置
    UI: {
        MAX_ACTIVE_SIGNALS: 50,          // 最大活跃信号数
        SIGNAL_CLEANUP_INTERVAL: 5 * 60 * 1000, // 信号清理间隔（5分钟）
    }
} as const;

// 类型定义，便于TypeScript类型推导
export type AppConfig = typeof APP_CONFIG;
