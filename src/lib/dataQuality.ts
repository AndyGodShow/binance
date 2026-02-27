import { KlineData } from '@/app/api/backtest/klines/route';

/**
 * 数据质量指标
 */
export interface DataQualityMetrics {
    oiCoverage: number;        // OI数据覆盖率 (0-100)
    fundingCoverage: number;   // 资金费率覆盖率 (0-100)
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
            dataQualityScore: 0,
            missingDataPoints: 0,
            simulatedDataRatio: 100,
            totalDataPoints: 0,
            realDataPoints: 0,
        };
    }

    const totalDataPoints = klines.length;
    let oiRealCount = 0;
    let fundingRealCount = 0;

    klines.forEach(kline => {
        // 检查是否有真实的OI数据（假设真实数据会有合理的值）
        if (kline.openInterest && parseFloat(kline.openInterest) > 0) {
            oiRealCount++;
        }

        // 检查是否有真实的资金费率数据
        if (kline.fundingRate !== undefined && kline.fundingRate !== null) {
            const fr = parseFloat(kline.fundingRate);
            // 资金费率通常在 -0.01 到 0.01 之间 (±1%)
            // 如果数值在合理范围内，认为是真实数据
            if (!isNaN(fr) && Math.abs(fr) <= 0.05) {
                fundingRealCount++;
            }
        }
    });

    const oiCoverage = (oiRealCount / totalDataPoints) * 100;
    const fundingCoverage = (fundingRealCount / totalDataPoints) * 100;

    // 计算综合数据覆盖率
    const avgCoverage = (oiCoverage + fundingCoverage) / 2;

    // 真实数据点数（取两者的平均）
    const realDataPoints = Math.round((oiRealCount + fundingRealCount) / 2);
    const missingDataPoints = totalDataPoints - realDataPoints;
    const simulatedDataRatio = ((totalDataPoints - realDataPoints) / totalDataPoints) * 100;

    // 计算质量评分 (综合考虑多个因素)
    // 70% 权重给数据覆盖率，30% 权重给数据完整性
    const coverageScore = avgCoverage * 0.7;
    const completenessScore = (realDataPoints / totalDataPoints) * 100 * 0.3;
    const dataQualityScore = Math.min(100, coverageScore + completenessScore);

    return {
        oiCoverage: Math.round(oiCoverage * 100) / 100,
        fundingCoverage: Math.round(fundingCoverage * 100) / 100,
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

/**
 * 生成数据质量报告
 */
export function generateDataQualityReport(metrics: DataQualityMetrics): string {
    const quality = getDataQualityLevel(metrics.dataQualityScore);

    return `
数据质量报告
━━━━━━━━━━━━━━━━━━━━━
综合评分: ${quality.emoji} ${metrics.dataQualityScore.toFixed(1)}/100 (${quality.label})

详细指标:
• OI覆盖率: ${metrics.oiCoverage.toFixed(1)}%
• 资金费率覆盖率: ${metrics.fundingCoverage.toFixed(1)}%
• 真实数据: ${metrics.realDataPoints}/${metrics.totalDataPoints} 条
• 模拟数据占比: ${metrics.simulatedDataRatio.toFixed(1)}%

${metrics.dataQualityScore < 60 ? '⚠️ 建议下载更多历史数据以提高回测准确性' : ''}
  `.trim();
}
