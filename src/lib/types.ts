export interface TickerData {
    symbol: string;
    lastPrice: string;
    priceChange: string;
    priceChangePercent: string;
    weightedAvgPrice: string;
    prevClosePrice: string;
    highPrice: string;
    lowPrice: string;
    volume: string;
    quoteVolume: string; // 成交额
    openTime: number;
    closeTime: number;
    // Merged fields
    markPrice?: string;
    fundingRate?: string;
    openInterest?: string;
    openInterestAmount?: string; // value in USDT usually calculated or from API
    openInterestValue?: string; // added this
    change15m?: number;
    change1h?: number;
    change4h?: number;
    breakout21dHigh?: number;         // 过去21根已完成日线高点
    breakout21dPercent?: number;      // 当前价格相对21日高点突破幅度
    ema5m20?: number;
    ema5m60?: number;
    ema5m100?: number;
    ema5mDistancePercent?: number;    // 当前价格相对5m EMA20偏离幅度
    gmmaTrend?: 'bullish' | 'bearish' | 'mixed';
    gmmaShortScore?: number;          // 顾比短期组同向排列得分
    gmmaLongScore?: number;           // 顾比长期组同向排列得分
    gmmaSeparationPercent?: number;   // 顾比短长期组均值分离幅度
    multiEmaTrend?: 'bullish' | 'bearish' | 'mixed';
    multiEmaAlignmentScore?: number;  // 多重均线相邻排列得分
    // RSRS fields
    rsrs?: number;              // Beta (斜率)
    rsrsZScore?: number;        // 修正后的 Z-Score
    rsrsFinal?: number;         // 右偏修正最终值 = Z × R² × Slope
    rsrsR2?: number;            // R² 拟合优度
    rsrsDynamicLongThreshold?: number;   // 动态多头阈值（90%分位数）
    rsrsDynamicShortThreshold?: number;  // 动态空头阈值（10%分位数）
    rsrsROC?: number;           // 🔥 RSRS 变化率（一阶导数）
    rsrsAcceleration?: number;  // 🔥 RSRS 加速度（二阶导数）
    rsrsAdaptiveWindow?: number; // 🔥 自适应窗口大小
    rsrsMethod?: string;        // 🔥 回归方法标识
    // Bollinger Bands
    bollingerUpper?: number;    // 布林带上轨
    bollingerMid?: number;      // 布林带中轨
    bollingerLower?: number;    // 布林带下轨
    // Volume
    volumeMA?: number;          // 成交量移动平均
    volumeRatio?: number;       // 当前成交量相对均量的倍数

    // 🔥 Advanced Technical Indicators
    atr?: number;                    // 平均真实波幅（波动率测量）
    rollingStd?: number;             // 滚动标准差
    betaToBTC?: number;              // 相对 BTC 的 Beta 系数
    correlationToBTC?: number;       // 与 BTC 的相关系数
    hurstExponent?: number;          // Hurst 指数（趋势强度）

    // CVD (Cumulative Volume Delta)
    cvd?: number;                    // 累计成交量差额
    cvdSlope?: number;               // CVD 斜率（买卖力量趋势）

    // Funding Rate Advanced
    fundingRateVelocity?: number;    // 资金费率变化率（一阶导数）
    fundingRateTrend?: 'up' | 'down' | 'stable'; // 费率趋势方向

    // Volume Profile
    vah?: number;                    // Value Area High（成交密集区上沿）
    val?: number;                    // Value Area Low（成交密集区下沿）
    poc?: number;                    // Point of Control（最大成交价位）

    // OI & Volume Change Tracking
    oiChangePercent?: number;        // 持仓量变化百分比
    volumeChangePercent?: number;    // 成交量变化百分比

    // Liquidation Data
    liquidationHeatmap?: {
        shortLiquidations: number;   // 上方空头清算金额
        longLiquidations: number;    // 下方多头清算金额
    };

    // 🔥 Volatility Squeeze 相关
    squeezeStatus?: 'on' | 'off';         // Squeeze 状态
    prevSqueezeStatus?: 'on' | 'off';     // 前一个 Squeeze 状态（用于检测释放）
    squeezeDuration?: number;              // 挤压持续 K 线数
    lastSqueezeDuration?: number;          // 最近一次完成的挤压持续 K 线数
    squeezeStrength?: number;              // 挤压强度 (0-1)
    releaseBarsAgo?: number;               // 距离最近一次挤压释放过去了几根 K 线（0 表示当前刚释放）
    squeezeBoxHigh?: number;               // 最近一次挤压区间上沿
    squeezeBoxLow?: number;                // 最近一次挤压区间下沿

    // Keltner Channels
    keltnerUpper?: number;
    keltnerMid?: number;
    keltnerLower?: number;

    // Momentum Histogram
    momentumValue?: number;                // 动能值
    momentumColor?: 'cyan' | 'blue' | 'red' | 'yellow'; // 动能颜色

    // ADX
    adx?: number;                          // 平均趋向指数
    adxSlope?: number;                     // ADX 斜率
    plusDI?: number;                       // +DI
    minusDI?: number;                      // -DI

    // Bandwidth
    bandwidthPercentile?: number;          // 带宽百分位 (0-100)

    // K线数据（用于 ATR/VSA 计算）
    ohlc?: OHLC[];
}

// 🔧 Sortable keys type for table sorting (includes computed fields)
export type SortableKey = keyof TickerData | 'openInterestValue' | 'rank';

export interface OHLC {
    time: number;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
    quoteVolume?: number;
    takerBuyQuoteVolume?: number;
}

export interface PremiumIndex {
    symbol: string;
    markPrice: string;
    indexPrice: string;
    estimatedSettlePrice: string;
    lastFundingRate: string;
    nextFundingTime: number;
    interestRate: string;
    time: number;
}

// Alert System Types
export type AlertLevel = 'info' | 'warning' | 'critical';

export interface AlertConfig {
    enableInfo: boolean;
    enableWarning: boolean;
    enableCritical: boolean;
    timeWindow: number;
    enableSound: boolean;
    enableNotification: boolean;
    notificationMinLevel: AlertLevel;
    monitorPrice: boolean;      // 监控价格涨幅
    monitorOI: boolean;          // 监控持仓金额涨幅
    monitorDecline: boolean;     // 监控跌幅
    enableScheduledAlerts: boolean;  // 启用定时推送
}

export interface AlertRecord {
    id: string;
    symbol: string;
    type: 'price' | 'oi';
    level: AlertLevel;
    changePercent: number;
    direction: 'up' | 'down';    // 涨跌方向
    timestamp: number;
    baseValue: number;
    currentValue: number;
    baseTimestamp?: number; // 基准数据的时间戳
}


export interface HistoricalDataPoint {
    symbol: string;
    price: number;
    openInterestValue: number;
    timestamp: number;
}

// 定时推送相关类型
export interface ScheduledAlertRecord {
    id: string;
    type: 'funding-rate';
    timestamp: number;
    topPositive: FundingRateItem[];
    topNegative: FundingRateItem[];
}

export interface FundingRateItem {
    symbol: string;
    fundingRate: number;
}

// Long/Short Ratio Types
export interface LongShortEntry {
    ratio: number;
    longPct: number;
    shortPct: number;
    ts: number;
}

export interface TakerVolumeEntry {
    ratio: number;
    buyVol: number;
    sellVol: number;
    ts: number;
}

export interface LongShortData {
    global: LongShortEntry[];
    topAccount: LongShortEntry[];
    topPosition: LongShortEntry[];
    takerVolume: TakerVolumeEntry[];
}
