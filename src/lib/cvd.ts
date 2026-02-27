/**
 * CVD (Cumulative Volume Delta) 计算模块
 * 用于分析买卖力量对比和资金流向质量
 */

export interface AggTrade {
    price: number;
    quantity: number;
    isBuyerMaker: boolean; // false = 主动买入, true = 主动卖出
    time: number;
}

export interface CVDData {
    symbol: string;
    cvd: number;              // 累计成交量差额
    cvdSlope: number;         // CVD 斜率（趋势）
    buyVolume: number;        // 主动买入量
    sellVolume: number;       // 主动卖出量
    buyPressure: number;      // 买入压力 (0-1)
    timestamp: number;
}

/**
 * 计算 CVD (Cumulative Volume Delta)
 * CVD = Σ(买入量 - 卖出量)
 * 
 * @param trades 逐笔交易数据
 * @returns CVD 值
 */
export function calculateCVD(trades: AggTrade[]): number {
    let cvd = 0;

    for (const trade of trades) {
        const volume = trade.quantity;

        // isBuyerMaker = true 表示主动卖出（taker 是卖方）
        // isBuyerMaker = false 表示主动买入（taker 是买方）
        if (trade.isBuyerMaker) {
            cvd -= volume; // 主动卖出
        } else {
            cvd += volume; // 主动买入
        }
    }

    return cvd;
}

/**
 * 计算 CVD 斜率（使用线性回归）
 * 正斜率：买入力量增强
 * 负斜率：卖出力量增强
 * 
 * @param cvdHistory CVD 历史值数组
 * @returns 斜率
 */
export function calculateCVDSlope(cvdHistory: number[]): number {
    const n = cvdHistory.length;

    if (n < 2) {
        return 0;
    }

    // 简单线性回归计算斜率
    let sumX = 0;
    let sumY = 0;
    let sumXY = 0;
    let sumXX = 0;

    for (let i = 0; i < n; i++) {
        const x = i;
        const y = cvdHistory[i];

        sumX += x;
        sumY += y;
        sumXY += x * y;
        sumXX += x * x;
    }

    const slope = (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX);

    return isFinite(slope) ? slope : 0;
}

/**
 * 分析买卖力量对比
 * 
 * @param trades 逐笔交易数据
 * @returns CVD 分析数据
 */
export function analyzeCVD(trades: AggTrade[], symbol: string): CVDData {
    let buyVolume = 0;
    let sellVolume = 0;
    const cvdHistory: number[] = [];

    let runningCVD = 0;

    for (const trade of trades) {
        const volume = trade.quantity;

        if (trade.isBuyerMaker) {
            sellVolume += volume;
            runningCVD -= volume;
        } else {
            buyVolume += volume;
            runningCVD += volume;
        }

        cvdHistory.push(runningCVD);
    }

    const totalVolume = buyVolume + sellVolume;
    const buyPressure = totalVolume > 0 ? buyVolume / totalVolume : 0.5;

    const cvdSlope = calculateCVDSlope(cvdHistory);

    return {
        symbol,
        cvd: runningCVD,
        cvdSlope,
        buyVolume,
        sellVolume,
        buyPressure,
        timestamp: Date.now()
    };
}

/**
 * 判断资金流入质量
 * 
 * @param priceChange 价格变化百分比
 * @param cvdSlope CVD 斜率
 * @returns true = 主动买盘（高质量）, false = 被动推升（低质量）
 */
export function isActiveBuying(priceChange: number, cvdSlope: number): boolean {
    // 价格上涨 + CVD 斜率为正 = 主动买盘
    // 价格上涨 + CVD 斜率为负 = 被动推升（不可靠）
    return priceChange > 0 && cvdSlope > 0;
}

/**
 * 从 Binance API 获取逐笔交易数据
 * 
 * @param symbol 交易对
 * @param limit 数据条数（最多 1000）
 * @returns 逐笔交易数组
 */
export async function fetchAggTrades(
    symbol: string,
    limit: number = 500
): Promise<AggTrade[]> {
    try {
        const response = await fetch(
            `https://fapi.binance.com/fapi/v1/aggTrades?symbol=${symbol}&limit=${limit}`
        );

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }

        const data = await response.json();

        return data.map((trade: any) => ({
            price: parseFloat(trade.p),
            quantity: parseFloat(trade.q),
            isBuyerMaker: trade.m,
            time: trade.T
        }));
    } catch (error) {
        console.error(`Error fetching agg trades for ${symbol}:`, error);
        return [];
    }
}
