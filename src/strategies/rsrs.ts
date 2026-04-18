import type { TradingStrategy, StrategySignal, CompositeCondition } from '../lib/strategyTypes.ts';
import type { TickerData } from '../lib/types.ts';
import { cooldownManager } from '../lib/cooldownManager.ts';
import { logger } from '../lib/logger.ts';
import { calculateRiskManagement } from '../lib/risk/riskCalculator.ts';
import { APP_CONFIG } from '../lib/config.ts';
import { getStrategyParameterConfig } from '../lib/strategyParameters.ts';

// 策略参数配置：检查条件并创建条件对象
function checkCondition(
    name: string,
    description: string,
    met: boolean,
    value?: number,
    threshold?: number
): CompositeCondition {
    return { name, description, met, value, threshold };
}

// 🔥 机构级 RSRS 策略：VW-TLS 回归 + 鲁棒统计 + 自适应窗口 + 减速预警
export const rsrsStrategy: TradingStrategy = {
    id: 'rsrs-trend',
    name: '🎯 RSRS 量化增强',
    description: '成交量加权 TLS 回归 + 自适应窗口 + 趋势减速预警',
    category: 'trend',
    enabled: true,

    detect: (ticker: TickerData): StrategySignal | null => {
        const params = getStrategyParameterConfig('rsrs-trend');
        // 冷却期检查
        if (cooldownManager.check(ticker.symbol, 'rsrs-trend', params.cooldownPeriodMs)) {
            return null;
        }

        // 基础数据检查
        if (ticker.rsrsFinal === undefined || ticker.rsrs === undefined || ticker.rsrsZScore === undefined) {
            return null;
        }

        const rsrsFinal = ticker.rsrsFinal;
        const beta = ticker.rsrs;
        const zScore = ticker.rsrsZScore;
        const r2 = ticker.rsrsR2 || 0;
        const rsrsROC = ticker.rsrsROC || 0;
        const rsrsAcceleration = ticker.rsrsAcceleration || 0;

        // 🔥 使用自适应动态阈值（替代固定阈值）
        const longThreshold = ticker.rsrsDynamicLongThreshold || 0;
        const shortThreshold = ticker.rsrsDynamicShortThreshold || 0;

        // 检测多头或空头信号
        const isLongSignal = rsrsFinal > longThreshold;
        const isShortSignal = rsrsFinal < shortThreshold;

        if (!isLongSignal && !isShortSignal) {
            return null; // RSRS未达到动态阈值
        }

        const direction: 'long' | 'short' = isLongSignal ? 'long' : 'short';
        const conditions: CompositeCondition[] = [];

        // ========== 条件1: RSRS 右偏修正信号 ==========
        const isExtreme = Math.abs(rsrsFinal) > Math.abs(longThreshold) * params.extremeMultiplier;
        const rsrsCondition =
            (isLongSignal || isShortSignal) &&
            r2 >= params.r2Floor &&
            Math.abs(rsrsROC) >= params.rocFloor;

        // 🔥 核心优化：减速预警检测
        const isDecelerating = direction === 'long'
            ? (rsrsAcceleration < -params.decelerationThreshold)
            : (rsrsAcceleration > params.decelerationThreshold);

        const decelerationWarning = isExtreme && isDecelerating;

        conditions.push(checkCondition(
            'rsrs-final-signal',
            `RSRS ${isExtreme ? '极端' : '强'}${direction === 'long' ? '看多' : '看空'}信号 (Final: ${rsrsFinal.toFixed(3)}, R²: ${r2.toFixed(2)})${decelerationWarning ? ' ⚠️减速' : ''}`,
            rsrsCondition,
            Math.abs(rsrsFinal),
            Math.abs(direction === 'long' ? longThreshold : shortThreshold)
        ));

        // ========== 条件2: 加权共振验证 ==========
        const change15m = ticker.change15m || 0;
        const change1h = ticker.change1h || 0;
        const change4h = ticker.change4h || 0;

        // 加权评分制: 4h(40分) > 1h(30分) > 15m(15分)
        let trendScore = 0;
        const details: string[] = [];

        if (direction === 'long') {
            if (change4h > params.trendThresholds.change4h) { trendScore += 40; details.push('4h✓'); }
            if (change1h > params.trendThresholds.change1h) { trendScore += 30; details.push('1h✓'); }
            if (change15m > params.trendThresholds.change15m) { trendScore += 15; details.push('15m✓'); }
        } else {
            if (change4h < -params.trendThresholds.change4h) { trendScore += 40; details.push('4h✓'); }
            if (change1h < -params.trendThresholds.change1h) { trendScore += 30; details.push('1h✓'); }
            if (change15m < -params.trendThresholds.change15m) { trendScore += 15; details.push('15m✓'); }
        }

        const TREND_THRESHOLD = params.trendScoreThreshold;
        const trendCondition = trendScore >= TREND_THRESHOLD;
        const avgChange = Math.abs((change15m + change1h + change4h) / 3);

        conditions.push(checkCondition(
            'weighted-trend',
            `加权共振${trendScore}分 (${details.length > 0 ? details.join('+') : '无'}), 均${avgChange.toFixed(1)}%`,
            trendCondition,
            trendScore,
            TREND_THRESHOLD
        ));

        // ========== 条件3: 成交量共振验证 ==========
        const currentVolume = parseFloat(ticker.volume || '0');
        const avgVolume = ticker.volumeMA || currentVolume;
        const volumeRatio = avgVolume > 0 ? currentVolume / avgVolume : 1;

        const VOLUME_THRESHOLD = params.volumeRatioThreshold;
        const volumeCondition = volumeRatio > VOLUME_THRESHOLD;

        conditions.push(checkCondition(
            'volume-confirmation',
            `成交量共振 (当前/均值: ${volumeRatio.toFixed(2)}x)`,
            volumeCondition,
            volumeRatio,
            VOLUME_THRESHOLD
        ));

        // ========== 条件4: 布林带价格位置过滤 ==========
        const currentPrice = parseFloat(ticker.lastPrice);
        const { bollingerUpper, bollingerMid, bollingerLower } = ticker;

        let pricePositionCondition = false;
        let pricePositionDesc = '';

        if (direction === 'long') {
            // 多头：价格不在超买区（不在上轨以上）
            if (bollingerUpper && bollingerMid) {
                pricePositionCondition = currentPrice < bollingerUpper;
                const distanceToUpper = ((bollingerUpper - currentPrice) / currentPrice * 100).toFixed(1);
                pricePositionDesc = `价格未超买 (距上轨 ${distanceToUpper}%)`;
            } else {
                pricePositionCondition = true; // 无数据时默认通过
                pricePositionDesc = '价格位置正常（无布林带数据）';
            }
        } else {
            // 空头：价格不在超卖区（不在下轨以下）
            if (bollingerLower && bollingerMid) {
                pricePositionCondition = currentPrice > bollingerLower;
                const distanceToLower = ((currentPrice - bollingerLower) / currentPrice * 100).toFixed(1);
                pricePositionDesc = `价格未超卖 (距下轨 ${distanceToLower}%)`;
            } else {
                pricePositionCondition = true; // 无数据时默认通过
                pricePositionDesc = '价格位置正常（无布林带数据）';
            }
        }

        conditions.push(checkCondition(
            'price-position',
            pricePositionDesc,
            pricePositionCondition
        ));

        // 🔥 严格模式: 必须满足全部4个条件
        const REQUIRED_CONDITIONS = 4;

        // The original `conditions` array is already populated above.
        // The following lines from the instruction seem to be a redefinition or
        // an attempt to filter/re-evaluate conditions, but without the context
        // of `resonanceCondition`, `rSquaredCondition`, `rocCondition`, `accelerationCondition`
        // being defined, they would cause a reference error.
        // Assuming the intent is to use the `conditions` array already built.
        // const conditions = [resonanceCondition, rSquaredCondition, rocCondition, accelerationCondition];
        const conditionsMet = conditions.filter(c => c.met).length;

        if (params.rejectExtremeDecelerating && decelerationWarning) {
            return null;
        }

        if (conditionsMet >= REQUIRED_CONDITIONS) {
            let confidence = params.confidence.base;

            if (isExtreme) {
                confidence += params.confidence.extremeBonus;
            }

            if (decelerationWarning) {
                confidence -= params.confidence.decelerationPenalty;
            }

            if (Math.abs(rsrsROC) > params.confidence.rocBonusThreshold) {
                confidence += params.confidence.rocBonus;
            }

            if (volumeRatio >= params.confidence.strongVolumeRatioThreshold) {
                confidence += params.confidence.strongVolumeBonus;
            }

            if (conditionsMet === 4) {
                confidence += params.confidence.allConditionsBonus;
            }

            if (confidence < params.confidence.minConfidence) {
                return null;
            }

            // 记录信号，启动冷却期
            cooldownManager.record(ticker.symbol, 'rsrs-trend');
            const metConditions = conditions.filter(c => c.met).map(c => c.description);

            return {
                symbol: ticker.symbol,
                strategyId: 'rsrs-trend',
                strategyName: '🎯 RSRS 量化增强',
                direction,
                confidence: Math.min(params.confidence.maxConfidence, Math.max(0, confidence)),
                reason: `${metConditions.join(' | ')}`,
                metrics: {
                    rsrsFinal,
                    rsrsZScore: zScore,
                    rsrsBeta: beta,
                    rsrsR2: r2,
                    rsrsROC,
                    rsrsAcceleration,
                    change15m,
                    change1h,
                    change4h,
                    trendScore,
                    volumeRatio,
                    conditionsMet,
                    dynamicLongThreshold: longThreshold,
                    dynamicShortThreshold: shortThreshold
                },
                timestamp: Date.now(),
                isComposite: true,
                conditions,
                conditionsMet,
                totalConditions: 4,
                risk: (() => {
                    try {
                        return calculateRiskManagement('rsrs', {
                            entryPrice: parseFloat(ticker.lastPrice),
                            direction,
                            confidence: Math.min(params.confidence.maxConfidence, Math.max(0, confidence)),
                            bollingerLower: ticker.bollingerLower,
                            bollingerUpper: ticker.bollingerUpper,
                            rsrsZScore: zScore,
                            rsrsR2: r2,
                             // 从全局配置读取风控设置
                    accountBalance: APP_CONFIG.RISK.DEFAULT_ACCOUNT_BALANCE, // TODO: 支持从前端用户设置传入
                    riskPercentage: APP_CONFIG.RISK.DEFAULT_RISK_PER_TRADE,
                        });
                    } catch (error) {
                        logger.error('RSRS risk calculation failed', error as Error, { symbol: ticker.symbol });
                        return undefined;
                    }
                })()
            };
        }

        return null;
    }
};
