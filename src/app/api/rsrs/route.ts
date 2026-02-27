import { NextResponse } from 'next/server';

// RSRS now uses adaptive window, no fixed N_DAYS/M_DAYS needed

export async function GET() {
    try {
        // 1. Fetch all tickers to find top volume assets
        const tickerRes = await fetch('https://fapi.binance.com/fapi/v1/ticker/24hr', { next: { revalidate: 300 } });
        if (!tickerRes.ok) throw new Error('Failed to fetch tickers');

        const allTickers = await tickerRes.json();

        // Filter USDT pairs and sort by Quote Volume (descending)
        // Limit to top 30 to avoid timeout/rate limits
        const topTickers = allTickers
            .filter((t: any) => t.symbol.endsWith('USDT'))
            .sort((a: any, b: any) => parseFloat(b.quoteVolume) - parseFloat(a.quoteVolume))
            .slice(0, 30);

        const rsrsMap: Record<string, {
            beta: number;
            zScore: number;
            r2: number;
            rsrsFinal: number;
            dynamicLongThreshold: number;
            dynamicShortThreshold: number;
            bollingerUpper: number;
            bollingerMid: number;
            bollingerLower: number;
            volumeMA: number;
            rsrsROC: number;
            rsrsAcceleration: number;
            adaptiveWindow: number;
            method: string;
        }> = {};

        // 2. Fetch history and calculate RSRS for each
        // Use larger buffer to accommodate adaptive window (max 30 days + 100 days history + buffer)
        const TOTAL_CANDLES = 150;

        // We run in parallel but limited batches to be nice to API
        const batchSize = 5;
        for (let i = 0; i < topTickers.length; i += batchSize) {
            const batch = topTickers.slice(i, i + batchSize);
            const promises = batch.map(async (t: any) => {
                try {
                    const klinesRes = await fetch(
                        `https://fapi.binance.com/fapi/v1/klines?symbol=${t.symbol}&interval=1d&limit=${TOTAL_CANDLES}`,
                        { next: { revalidate: 3600 } } // Cache for 1 hour
                    );
                    const klines = await klinesRes.json();

                    if (Array.isArray(klines) && klines.length >= 40) { // Minimum data requirement
                        const result = calculateRSRS(klines);
                        if (result) {
                            rsrsMap[t.symbol] = result;
                        }
                    }
                } catch (e) {
                    console.error(`Failed to calc RSRS for ${t.symbol}`, e);
                }
            });
            await Promise.all(promises);
        }

        return NextResponse.json(rsrsMap, {
            headers: {
                'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=7200', // Cache 1 hour (daily data changes infrequently)
            }
        });

    } catch (error) {
        console.error('RSRS API Error:', error);
        return NextResponse.json({ error: 'Failed to calculate RSRS' }, { status: 500 });
    }
}

// Stats Helpers
function calculateRSRS(klines: any[]): {
    beta: number;
    zScore: number;
    r2: number;
    rsrsFinal: number;
    dynamicLongThreshold: number;
    dynamicShortThreshold: number;
    bollingerUpper: number;
    bollingerMid: number;
    bollingerLower: number;
    volumeMA: number;
    rsrsROC: number;          // 🔥 新增：RSRS 变化率
    rsrsAcceleration: number; // 🔥 新增：RSRS 加速度
    adaptiveWindow: number;   // 🔥 新增：自适应窗口大小
    method: string;           // 🔥 新增：回归方法标识
} | null {
    // K-line format: [time, open, high, low, close, vol, ...]
    // values are strings, need parse
    const highs = klines.map(k => parseFloat(k[2]));
    const lows = klines.map(k => parseFloat(k[3]));
    const closes = klines.map(k => parseFloat(k[4]));
    const volumes = klines.map(k => parseFloat(k[5]));

    // 🔥 Step 1: 计算自适应窗口大小
    const efficiencyRatio = calculateEfficiencyRatio(closes, 10);
    const N_FAST = 12;
    const N_SLOW = 30;
    const adaptiveWindow = Math.round(N_SLOW - (N_SLOW - N_FAST) * Math.pow(efficiencyRatio, 2));
    const N_DAYS = Math.max(N_FAST, Math.min(N_SLOW, adaptiveWindow)); // 限制在 [12, 30] 范围

    if (highs.length < N_DAYS) return null;

    // Calculate historical betas, r2s, and rsrsFinal values
    const betas: number[] = [];
    const r2s: number[] = [];
    const rsrsFinalValues: number[] = [];

    // We need 'betas' array for the standardization window (M_DAYS)
    // We start from index N_DAYS to end
    for (let i = N_DAYS; i < highs.length; i++) {
        const windowHighs = highs.slice(i - N_DAYS, i);
        const windowLows = lows.slice(i - N_DAYS, i);
        const windowVolumes = volumes.slice(i - N_DAYS, i);

        // 🔥 Step 2: 使用 Volume-Weighted TLS (VW-TLS)
        // 结合成交量权重和全最小二乘法
        const tlsResult = getTLSData(windowLows, windowHighs); // TLS baseline
        const wlsResult = getWLSData(windowLows, windowHighs, windowVolumes); // WLS with volume

        // 混合策略：70% WLS + 30% TLS（平衡成交量影响和几何准确性）
        const hybridBeta = 0.7 * wlsResult.beta + 0.3 * tlsResult.beta;
        const hybridR2 = Math.max(wlsResult.r2, tlsResult.r2); // 取较优的R²

        betas.push(hybridBeta);
        r2s.push(hybridR2);
    }

    if (betas.length === 0) return null;

    const currentBeta = betas[betas.length - 1];
    const currentR2 = r2s[r2s.length - 1];

    // 🔥 Step 3: 使用修正型 Z-Score (Median + MAD) 替代传统方法
    const M_DAYS = 100; // Standardization window
    const historyBetas = betas.slice(Math.max(0, betas.length - M_DAYS - 1), betas.length - 1);

    if (historyBetas.length < 10) {
        // Not enough history - return basic values
        const volumeMA = volumes.slice(-20).reduce((sum, v) => sum + v, 0) / Math.min(20, volumes.length);
        const lastClose = closes[closes.length - 1];
        return {
            beta: currentBeta,
            zScore: 0,
            r2: currentR2,
            rsrsFinal: 0,
            dynamicLongThreshold: 0,
            dynamicShortThreshold: 0,
            bollingerUpper: lastClose,
            bollingerMid: lastClose,
            bollingerLower: lastClose,
            volumeMA,
            rsrsROC: 0,
            rsrsAcceleration: 0,
            adaptiveWindow: N_DAYS,
            method: 'VW-TLS (insufficient data)'
        };
    }

    // 🔥 鲁棒统计：Median + MAD
    const median = calculateMedian(historyBetas);
    const mad = calculateMAD(historyBetas);
    const robustZScore = mad === 0 ? 0 : 0.6745 * (currentBeta - median) / mad;

    // R²修正: 修正Z-Score = 原Z-Score × R²
    const correctedZScore = robustZScore * currentR2;

    // 🔥 右偏修正 (Right-skewed Adjustment)
    // RSRS_Final = Z-Score × R² × Slope
    const rsrsFinal = correctedZScore * currentBeta;

    // 🔥 计算所有历史的 rsrsFinal 值（用于动态阈值和ROC计算）
    for (let i = 0; i < betas.length - 1; i++) {
        const historicalZScore = mad === 0 ? 0 : 0.6745 * (betas[i] - median) / mad;
        const historicalCorrectedZScore = historicalZScore * r2s[i];
        const historicalRsrsFinal = historicalCorrectedZScore * betas[i];
        rsrsFinalValues.push(historicalRsrsFinal);
    }
    rsrsFinalValues.push(rsrsFinal); // Add current value

    // 🔥 Step 4: 计算 RSRS 二阶导数（变化率和加速度）
    let rsrsROC = 0;
    let rsrsAcceleration = 0;

    if (rsrsFinalValues.length >= 3) {
        const current = rsrsFinalValues[rsrsFinalValues.length - 1];
        const prev = rsrsFinalValues[rsrsFinalValues.length - 2];
        const prevPrev = rsrsFinalValues[rsrsFinalValues.length - 3];

        // ROC = (current - prev) / abs(prev) * 100
        rsrsROC = prev !== 0 ? ((current - prev) / Math.abs(prev)) * 100 : 0;

        // 加速度 = 当前ROC - 前一个ROC
        const prevROC = prevPrev !== 0 ? ((prev - prevPrev) / Math.abs(prevPrev)) * 100 : 0;
        rsrsAcceleration = rsrsROC - prevROC;
    }

    // 🔥 自适应动态阈值 (90% percentile for long, 10% percentile for short)
    const sortedRsrsFinal = [...rsrsFinalValues].sort((a, b) => a - b);
    const p90Index = Math.floor(sortedRsrsFinal.length * 0.90);
    const p10Index = Math.floor(sortedRsrsFinal.length * 0.10);
    const dynamicLongThreshold = sortedRsrsFinal[p90Index] || 0;
    const dynamicShortThreshold = sortedRsrsFinal[p10Index] || 0;

    // 🔥 布林带计算 (Bollinger Bands) - 使用最近20根K线
    const bbWindow = 20;
    const recentCloses = closes.slice(-bbWindow);
    const bbMean = recentCloses.reduce((sum, c) => sum + c, 0) / recentCloses.length;
    const bbStdDev = Math.sqrt(
        recentCloses.reduce((sum, c) => sum + Math.pow(c - bbMean, 2), 0) / recentCloses.length
    );
    const bollingerMid = bbMean;
    const bollingerUpper = bbMean + 2 * bbStdDev;
    const bollingerLower = bbMean - 2 * bbStdDev;

    // 🔥 成交量移动平均 (Volume MA) - 使用最近20根K线
    const volumeWindow = 20;
    const recentVolumes = volumes.slice(-volumeWindow);
    const volumeMA = recentVolumes.reduce((sum, v) => sum + v, 0) / recentVolumes.length;

    return {
        beta: currentBeta,
        zScore: correctedZScore,
        r2: currentR2,
        rsrsFinal,
        dynamicLongThreshold,
        dynamicShortThreshold,
        bollingerUpper,
        bollingerMid,
        bollingerLower,
        volumeMA,
        rsrsROC,
        rsrsAcceleration,
        adaptiveWindow: N_DAYS,
        method: 'VW-TLS + Median/MAD'
    };
}

function getOLSData(xValues: number[], yValues: number[]): { beta: number; r2: number } {
    // OLS回归: y = a + beta * x
    // 返回 beta (斜率) 和 R² (决定系数)
    const n = xValues.length;
    if (n === 0) return { beta: 0, r2: 0 };

    const xMean = xValues.reduce((a, b) => a + b, 0) / n;
    const yMean = yValues.reduce((a, b) => a + b, 0) / n;

    let numerator = 0;      // Cov(x,y)
    let denominator = 0;    // Var(x)
    let ssTotal = 0;        // Total sum of squares
    let ssResidual = 0;     // Residual sum of squares

    for (let i = 0; i < n; i++) {
        numerator += (xValues[i] - xMean) * (yValues[i] - yMean);
        denominator += Math.pow(xValues[i] - xMean, 2);
        ssTotal += Math.pow(yValues[i] - yMean, 2);
    }

    const beta = denominator === 0 ? 0 : numerator / denominator;
    const alpha = yMean - beta * xMean;

    // 计算残差平方和
    for (let i = 0; i < n; i++) {
        const predicted = alpha + beta * xValues[i];
        ssResidual += Math.pow(yValues[i] - predicted, 2);
    }

    // R² = 1 - (SS_res / SS_tot)
    const r2 = ssTotal === 0 ? 0 : 1 - (ssResidual / ssTotal);

    return { beta, r2: Math.max(0, r2) }; // R²不应为负
}

// ========== 🔥 Advanced Math Functions ==========

/**
 * Total Least Squares (TLS) 全最小二乘法
 * 同时最小化 x 和 y 两个方向的误差，更适合加密市场的双向噪声
 */
function getTLSData(xValues: number[], yValues: number[]): { beta: number; r2: number } {
    const n = xValues.length;
    if (n === 0) return { beta: 0, r2: 0 };

    // 中心化数据
    const xMean = xValues.reduce((a, b) => a + b, 0) / n;
    const yMean = yValues.reduce((a, b) => a + b, 0) / n;

    const xCentered = xValues.map(x => x - xMean);
    const yCentered = yValues.map(y => y - yMean);

    // 构建协方差矩阵的元素
    let sxx = 0, syy = 0, sxy = 0;
    for (let i = 0; i < n; i++) {
        sxx += xCentered[i] * xCentered[i];
        syy += yCentered[i] * yCentered[i];
        sxy += xCentered[i] * yCentered[i];
    }

    // TLS 斜率通过特征值分解求解
    // beta = (syy - sxx + sqrt((syy-sxx)^2 + 4*sxy^2)) / (2*sxy)
    const delta = syy - sxx;
    const discriminant = delta * delta + 4 * sxy * sxy;
    const beta = sxy === 0 ? 0 : (delta + Math.sqrt(discriminant)) / (2 * sxy);

    // 计算 R² (使用垂直距离)
    const alpha = yMean - beta * xMean;
    let ssTotal = 0, ssResidual = 0;
    for (let i = 0; i < n; i++) {
        const predicted = alpha + beta * xValues[i];
        ssResidual += Math.pow(yValues[i] - predicted, 2);
        ssTotal += Math.pow(yValues[i] - yMean, 2);
    }
    const r2 = ssTotal === 0 ? 0 : 1 - (ssResidual / ssTotal);

    return { beta, r2: Math.max(0, r2) };
}

/**
 * Weighted Least Squares (WLS) 加权最小二乘法
 * 使用成交量作为权重，放大高成交量K线的影响
 */
function getWLSData(xValues: number[], yValues: number[], weights: number[]): { beta: number; r2: number } {
    const n = xValues.length;
    if (n === 0 || weights.length !== n) return { beta: 0, r2: 0 };

    // 归一化权重
    const totalWeight = weights.reduce((a, b) => a + b, 0);
    if (totalWeight === 0) return { beta: 0, r2: 0 };
    const normalizedWeights = weights.map(w => w / totalWeight);

    // 加权均值
    const xMean = xValues.reduce((sum, x, i) => sum + x * normalizedWeights[i], 0);
    const yMean = yValues.reduce((sum, y, i) => sum + y * normalizedWeights[i], 0);

    // 加权协方差和方差
    let numerator = 0, denominator = 0, ssTotal = 0, ssResidual = 0;
    for (let i = 0; i < n; i++) {
        const wx = normalizedWeights[i];
        numerator += wx * (xValues[i] - xMean) * (yValues[i] - yMean);
        denominator += wx * Math.pow(xValues[i] - xMean, 2);
        ssTotal += wx * Math.pow(yValues[i] - yMean, 2);
    }

    const beta = denominator === 0 ? 0 : numerator / denominator;
    const alpha = yMean - beta * xMean;

    // 加权残差
    for (let i = 0; i < n; i++) {
        const predicted = alpha + beta * xValues[i];
        ssResidual += normalizedWeights[i] * Math.pow(yValues[i] - predicted, 2);
    }

    const r2 = ssTotal === 0 ? 0 : 1 - (ssResidual / ssTotal);
    return { beta, r2: Math.max(0, r2) };
}

/**
 * 计算中位数
 */
function calculateMedian(values: number[]): number {
    if (values.length === 0) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0
        ? (sorted[mid - 1] + sorted[mid]) / 2
        : sorted[mid];
}

/**
 * 计算中位数绝对偏差（MAD）
 * MAD = median(|x - median(x)|)
 */
function calculateMAD(values: number[]): number {
    if (values.length === 0) return 0;
    const median = calculateMedian(values);
    const deviations = values.map(v => Math.abs(v - median));
    return calculateMedian(deviations);
}

/**
 * 计算效率系数（Efficiency Ratio）
 * 用于自适应回归窗口
 */
function calculateEfficiencyRatio(closes: number[], period: number = 10): number {
    if (closes.length < period + 1) return 0.5; // 默认中等效率

    const recent = closes.slice(-period - 1);

    // 方向性 = 净价格变化
    const direction = Math.abs(recent[recent.length - 1] - recent[0]);

    // 波动性 = 逐日价格变化之和
    let volatility = 0;
    for (let i = 1; i < recent.length; i++) {
        volatility += Math.abs(recent[i] - recent[i - 1]);
    }

    return volatility === 0 ? 1 : direction / volatility;
}

