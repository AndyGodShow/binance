import { TradingStrategy, StrategySignal, CompositeCondition } from '../lib/strategyTypes';
import { TickerData } from '../lib/types';
import { cooldownManager } from '../lib/cooldownManager';
import { logger } from '../lib/logger';

// 辅助函数：检查条件并创建条件对象
function checkCondition(
    name: string,
    description: string,
    met: boolean,
    value?: number,
    threshold?: number
): CompositeCondition {
    return { name, description, met, value, threshold };
}

// 冷却期：60分钟 - 狙击型策略
const COOLDOWN_PERIOD = 60 * 60 * 1000;

// ==================== 策略 5: 波动率挤压（狙击型）====================
export const volatilitySqueezeStrategy: TradingStrategy = {
    id: 'volatility-squeeze',
    name: '🎯 波动率挤压',
    description: 'BB/KC挤压 + 动能突破 + 狙击入场',
    category: 'trend',
    enabled: true,

    detect: (ticker: TickerData): StrategySignal | null => {
        // 冷却期检查
        if (cooldownManager.check(ticker.symbol, 'volatility-squeeze', COOLDOWN_PERIOD)) {
            return null;
        }

        // 需要完整的 Squeeze 数据
        if (!ticker.squeezeStatus || !ticker.momentumColor || !ticker.keltnerMid) {
            return null;
        }

        const conditions: CompositeCondition[] = [];

        // ========== 条件1: Squeeze 状态释放 ==========
        const squeezeStatus = ticker.squeezeStatus;
        const squeezeDuration = ticker.squeezeDuration || 0;
        const squeezeStrength = ticker.squeezeStrength || 0;
        const prevSqueezeStatus = ticker.prevSqueezeStatus || 'off'; // 需要追踪前一状态

        // 检测 Squeeze Off（从 On 转为 Off）
        const isSqueezeRelease = prevSqueezeStatus === 'on' && squeezeStatus === 'off';

        // 要求至少蓄力 9 根 K 线
        const hasSufficientCompression = squeezeDuration >= 9 || prevSqueezeStatus === 'on';

        const squeezeCondition = isSqueezeRelease && hasSufficientCompression;

        conditions.push(checkCondition(
            'squeeze-release',
            `挤压释放 (蓄力${squeezeDuration}根K线[≥ 9根], 强度${(squeezeStrength * 100).toFixed(0)}%)`,
            squeezeCondition,
            squeezeDuration,
            9
        ));

        // ========== 条件2: 动能方向确认 ==========
        const momentumColor = ticker.momentumColor;
        const momentumValue = ticker.momentumValue || 0;

        // 做多：青色（正向加速）
        // 做空：红色（负向加速）
        const isLongMomentum = momentumColor === 'cyan';
        const isShortMomentum = momentumColor === 'red';

        if (!isLongMomentum && !isShortMomentum) {
            return null; // 没有明确的方向信号
        }

        const direction: 'long' | 'short' = isLongMomentum ? 'long' : 'short';
        const momentumCondition = true; // 已通过方向筛选

        conditions.push(checkCondition(
            'momentum-direction',
            `动能${direction === 'long' ? '正向加速' : '负向加速'} (${momentumColor})`,
            momentumCondition,
            Math.abs(momentumValue),
            0
        ));

        // ========== 条件3: 价格位置验证 ==========
        const currentPrice = parseFloat(ticker.lastPrice);
        const keltnerMid = ticker.keltnerMid;

        const pricePositionValid = direction === 'long'
            ? currentPrice > keltnerMid
            : currentPrice < keltnerMid;

        const priceDistance = ((currentPrice - keltnerMid) / keltnerMid * 100);

        conditions.push(checkCondition(
            'price-position',
            `价格${direction === 'long' ? '站上' : '跌破'}KC中轨 (距${Math.abs(priceDistance).toFixed(2)}%)`,
            pricePositionValid,
            currentPrice,
            keltnerMid
        ));

        // ========== 条件4: 进阶过滤（可选但推荐）==========
        const bandwidthPercentile = ticker.bandwidthPercentile || 50;
        const adx = ticker.adx || 0;

        // 带宽处于低 10% 分位（严格挤压）
        const isTightSqueeze = bandwidthPercentile < 10;

        // ADX > 20 表示趋势强度足够
        const hasTrendStrength = adx > 20;

        const advancedFilter = isTightSqueeze || hasTrendStrength;

        conditions.push(checkCondition(
            'advanced-filter',
            `${isTightSqueeze ? '✓严格挤压' : ''} ${hasTrendStrength ? `ADX=${adx.toFixed(1)}` : ''}`,
            advancedFilter,
            bandwidthPercentile,
            10
        ));

        // 🔥 严格模式: 必须满足全部4个条件
        const conditionsMet = conditions.filter(c => c.met).length;

        if (conditionsMet >= 4) {
            // 计算置信度
            let confidence = 75 + (conditionsMet * 6);

            // 蓄力时间越长，置信度越高
            if (squeezeDuration >= 15) {
                confidence += 10; // 超长挤压
            } else if (squeezeDuration >= 10) {
                confidence += 5;
            }

            // 严格挤压 + ADX 双重确认
            if (isTightSqueeze && hasTrendStrength) {
                confidence += 5;
            }

            // 🔥 严格模式: 最低置信度过滤
            if (confidence < 85) {
                return null;
            }

            const metConditions = conditions.filter(c => c.met).map(c => c.description);
            cooldownManager.record(ticker.symbol, 'volatility-squeeze');

            // 🔥 计算风险管理参数
            let riskManagement;
            try {
                const { calculateRiskManagement } = require('@/lib/risk/riskCalculator');

                riskManagement = calculateRiskManagement('volatility-squeeze', {
                    entryPrice: currentPrice,
                    direction,
                    confidence: Math.min(95, confidence),
                    keltnerUpper: ticker.keltnerUpper,
                    keltnerLower: ticker.keltnerLower,
                    keltnerMid,
                    momentumColor,
                    squeezeDuration,
                    bandwidthPercentile,
                    adx,
                    accountBalance: 10000, // TODO: 从用户设置获取
                    riskPercentage: 1
                });
            } catch (error) {
                logger.error('Risk calculation failed for volatility-squeeze', error as Error, { symbol: ticker.symbol });
            }

            return {
                symbol: ticker.symbol,
                strategyId: 'volatility-squeeze',
                strategyName: '🎯 波动率挤压',
                direction,
                confidence: Math.min(95, confidence),
                reason: `${conditionsMet}/4 条件满足：${metConditions.join(' | ')}`,
                metrics: {
                    squeezeDuration,
                    squeezeStrength,
                    momentumValue,
                    keltnerMid,
                    currentPrice,
                    bandwidthPercentile,
                    adx,
                    conditionsMet
                },
                timestamp: Date.now(),
                isComposite: true,
                conditions,
                conditionsMet,
                totalConditions: 4,
                risk: riskManagement // 🔥 附加风控信息
            };
        }

        return null;
    }
};
