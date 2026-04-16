/**
 * 应用配置管理
 * 集中管理所有可配置的参数
 */

export const APP_CONFIG = {
    // 缓存配置
    CACHE: {
        KLINE_TTL: 5 * 60 * 1000,      // K线数据缓存时间（5分钟）
        KLINE_MAX_SIZE: 2000,          // K线缓存最大条目数
    },

    // API配置
    API: {
        RETRY_MAX_DELAY: 10000,         // 重试最大延迟（毫秒）
        BATCH_SIZE: 5,                  // K线批量获取大小
        BATCH_DELAY: 100,               // 批次间延迟（毫秒）
        REVALIDATE_MARKET: 5,           // 市场数据重新验证时间（秒）
    },

    // 策略配置
    STRATEGY: {
        MIN_CONFIDENCE: 85,             // 最低置信度阈值
    },

    // 默认风控配置（实盘/纸面交易应当从全局 Context 取值，这里做兜底）
    RISK: {
        DEFAULT_ACCOUNT_BALANCE: 10000,  // 默认账户资金（USDT）
        DEFAULT_RISK_PER_TRADE: 1,       // 默认单笔风险百分比
    },

    // 技术指标配置
    INDICATORS: {
        MIN_QUOTE_VOLUME_FOR_FULL_INDICATORS: 5000000, // 完整增强的最低24h成交额
        MIN_OPEN_INTEREST_VALUE_FOR_FULL_INDICATORS: 2000000, // 完整增强的最低持仓金额
    },

    // UI配置
    UI: {
        MAX_ACTIVE_SIGNALS: 50,          // 最大活跃信号数
    }
} as const;
