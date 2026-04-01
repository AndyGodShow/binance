import { KlineData } from '@/app/api/backtest/klines/route';

/**
 * 数据质量指标
 */
export interface DataQualityMetrics {
    oiCoverage: number;        // OI数据覆盖率 (0-100)
    fundingCoverage: number;   // 资金费率覆盖率 (0-100)
    oiExactCoverage: number;   // OI 精确命中覆盖率 (0-100)
    fundingExactCoverage: number; // 资金费率精确命中覆盖率 (0-100)
    dataQualityScore: number;  // 综合质量评分 (0-100)
    missingDataPoints: number; // 缺失数据点数量
    simulatedDataRatio: number; // 模拟数据占比 (0-100)
    totalDataPoints: number;    // 总数据点数
    realDataPoints: number;     // 真实数据点数
}

/**
 * 计算数据质量指标
 */
export function calculateDataQuality(klines: KlineData[]): DataQualityMetrics {
    if (klines.length === 0) {
        return {
            oiCoverage: 0,
            fundingCoverage: 0,
            oiExactCoverage: 0,
            fundingExactCoverage: 0,
            dataQualityScore: 0,
            missingDataPoints: 0,
            simulatedDataRatio: 100,
            totalDataPoints: 0,
            realDataPoints: 0,
        };
    }

    const totalDataPoints = klines.length;
    let oiAvailableCount = 0;
    let oiExactCount = 0;
    let fundingAvailableCount = 0;
    let fundingExactCount = 0;

    klines.forEach(kline => {
        if (kline.openInterest && parseFloat(kline.openInterest) > 0) {
            oiAvailableCount++;
            if (kline.openInterestSource === 'exact') {
                oiExactCount++;
            }
        }

        if (kline.fundingRate !== undefined && kline.fundingRate !== null) {
            const fr = parseFloat(kline.fundingRate);
            if (!isNaN(fr) && Math.abs(fr) <= 0.05) {
                fundingAvailableCount++;
                if (kline.fundingRateSource === 'exact') {
                    fundingExactCount++;
                }
            }
        }
    });

    const oiCoverage = (oiAvailableCount / totalDataPoints) * 100;
    const fundingCoverage = (fundingAvailableCount / totalDataPoints) * 100;
    const oiExactCoverage = (oiExactCount / totalDataPoints) * 100;
    // 资金费率天然每8小时只更新一次，区间内的 forward-fill 即为最真实的费率，不应扣减分数
    const fundingExactCoverage = fundingCoverage;

    const avgAvailableCoverage = (oiCoverage + fundingCoverage) / 2;
    const avgExactCoverage = (oiExactCoverage + fundingExactCoverage) / 2;
    const realDataPoints = Math.round((oiExactCount + fundingAvailableCount) / 2);
    const missingDataPoints = totalDataPoints - realDataPoints;
    const simulatedDataRatio = ((totalDataPoints - realDataPoints) / totalDataPoints) * 100;

    const availabilityScore = avgAvailableCoverage * 0.35;
    const exactnessScore = avgExactCoverage * 0.45;
    const completenessScore = (realDataPoints / totalDataPoints) * 100 * 0.20;
    const dataQualityScore = Math.min(100, availabilityScore + exactnessScore + completenessScore);

    return {
        oiCoverage: Math.round(oiCoverage * 100) / 100,
        fundingCoverage: Math.round(fundingCoverage * 100) / 100,
        oiExactCoverage: Math.round(oiExactCoverage * 100) / 100,
        fundingExactCoverage: Math.round(fundingExactCoverage * 100) / 100,
        dataQualityScore: Math.round(dataQualityScore * 100) / 100,
        missingDataPoints,
        simulatedDataRatio: Math.round(simulatedDataRatio * 100) / 100,
        totalDataPoints,
        realDataPoints,
    };
}

/**
 * 获取数据质量等级
 */
export function getDataQualityLevel(score: number): {
    level: 'excellent' | 'good' | 'fair' | 'poor';
    label: string;
    color: string;
    emoji: string;
} {
    if (score >= 80) {
        return {
            level: 'excellent',
            label: '优秀',
            color: '#22c55e',
            emoji: '✅',
        };
    } else if (score >= 60) {
        return {
            level: 'good',
            label: '良好',
            color: '#3b82f6',
            emoji: '👍',
        };
    } else if (score >= 40) {
        return {
            level: 'fair',
            label: '一般',
            color: '#f59e0b',
            emoji: '⚠️',
        };
    } else {
        return {
            level: 'poor',
            label: '较差',
            color: '#ef4444',
            emoji: '❌',
        };
    }
}
