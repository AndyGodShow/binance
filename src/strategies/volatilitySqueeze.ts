import { TradingStrategy, StrategySignal, CompositeCondition } from '../lib/strategyTypes';
import { TickerData } from '../lib/types';
import { cooldownManager } from '../lib/cooldownManager';
import { logger } from '../lib/logger';
import { APP_CONFIG } from '../lib/config';
import { calculateRiskManagement } from '../lib/risk/riskCalculator';

// ========== Squeeze 策略所需参数 ==========：检查条件并创建条件对象
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
const MIN_SQUEEZE_DURATION = 10;
const MAX_RELEASE_BARS_AGO = 1;
const MAX_SQUEEZE_BANDWIDTH_PERCENTILE = 12;
const STRONG_SQUEEZE_BANDWIDTH_PERCENTILE = 8;
const MIN_VOLUME_RATIO = 1.5;
const MIN_ADX = 20;
const STRONG_ADX = 25;
const MIN_BREAKOUT_BODY_PERCENT = 1.0;
const MIN_CONFIDENCE = 85;

function buildRecentBreakoutLevels(ticker: TickerData): { recentHigh: number | null; recentLow: number | null; bodyPercent: number } {
    const candles = ticker.ohlc || [];
    const latest = candles[candles.length - 1];
    const priorCandles = candles.slice(-6, -1);

    const recentHigh = priorCandles.length > 0 ? Math.max(...priorCandles.map(candle => candle.high)) : null;
    const recentLow = priorCandles.length > 0 ? Math.min(...priorCandles.map(candle => candle.low)) : null;

    let bodyPercent = 0;
    if (latest && latest.open > 0) {
        bodyPercent = Math.abs((latest.close - latest.open) / latest.open) * 100;
    }

    return { recentHigh, recentLow, bodyPercent };
}

// ==================== 策略 5: 波动率挤压（狙击型）====================
export const volatilitySqueezeStrategy: TradingStrategy = {
    id: 'volatility-squeeze',
    name: '🎯 波动率挤压',
    description: '高质量挤压释放 + 放量突破 + 首段启动',
    category: 'trend',
    enabled: true,

    detect: (ticker: TickerData): StrategySignal | null => {
        // 冷却期检查
        if (cooldownManager.check(ticker.symbol, 'volatility-squeeze', COOLDOWN_PERIOD)) {
            return null;
        }

        // 需要完整的 Squeeze 数据
        if (!ticker.squeezeStatus || !ticker.momentumColor || !ticker.keltnerMid || !ticker.ohlc || ticker.ohlc.length < 6) {
            return null;
        }

        const conditions: CompositeCondition[] = [];
        const currentPrice = parseFloat(ticker.lastPrice);
        if (!Number.isFinite(currentPrice) || currentPrice <= 0) {
            return null;
        }

        // ========== 条件1: 高质量挤压背景 ==========
        const squeezeDuration = ticker.lastSqueezeDuration || ticker.squeezeDuration || 0;
        const squeezeStrength = ticker.squeezeStrength || 0;
        const bandwidthPercentile = ticker.bandwidthPercentile ?? 100;
        const hasQualifiedSqueeze = squeezeDuration >= MIN_SQUEEZE_DURATION && bandwidthPercentile < MAX_SQUEEZE_BANDWIDTH_PERCENTILE;

        conditions.push(checkCondition(
            'squeeze-quality',
            `挤压背景 (持续${squeezeDuration}根, 带宽分位${bandwidthPercentile.toFixed(1)}[< ${MAX_SQUEEZE_BANDWIDTH_PERCENTILE}])`,
            hasQualifiedSqueeze,
            squeezeDuration,
            MIN_SQUEEZE_DURATION
        ));

        // ========== 条件2: 释放窗口 ==========
        const releaseBarsAgo = ticker.releaseBarsAgo;
        const inReleaseWindow =
            typeof releaseBarsAgo === 'number' &&
            Number.isFinite(releaseBarsAgo) &&
            releaseBarsAgo >= 0 &&
            releaseBarsAgo <= MAX_RELEASE_BARS_AGO;

        conditions.push(checkCondition(
            'release-window',
            inReleaseWindow
                ? `释放窗口内 (距释放${releaseBarsAgo}根K线)`
                : '释放过久或未检测到释放',
            inReleaseWindow,
            typeof releaseBarsAgo === 'number' ? releaseBarsAgo : undefined,
            MAX_RELEASE_BARS_AGO
        ));

        // ========== 条件3: 动能方向确认 ==========
        const momentumColor = ticker.momentumColor;
        const momentumValue = ticker.momentumValue || 0;
        const strongLongMomentum = momentumColor === 'cyan';
        const strongShortMomentum = momentumColor === 'red';
        const longMomentum = strongLongMomentum || (momentumColor === 'blue' && momentumValue > 0);
        const shortMomentum = strongShortMomentum || (momentumColor === 'yellow' && momentumValue < 0);

        if (!longMomentum && !shortMomentum) {
            return null;
        }

        const direction: 'long' | 'short' = longMomentum ? 'long' : 'short';
        const momentumCondition = Math.abs(momentumValue) > 0;

        conditions.push(checkCondition(
            'momentum-direction',
            `动能${direction === 'long' ? '向上' : '向下'} (${momentumColor})`,
            momentumCondition,
            Math.abs(momentumValue),
            0
        ));

        // ========== 条件4: 价格位置与突破 ==========
        const keltnerMid = ticker.keltnerMid;
        const { recentHigh, recentLow, bodyPercent } = buildRecentBreakoutLevels(ticker);
        const squeezeBoxHigh = ticker.squeezeBoxHigh;
        const squeezeBoxLow = ticker.squeezeBoxLow;

        const pricePositionValid = direction === 'long'
            ? currentPrice > keltnerMid &&
                (recentHigh === null || currentPrice > recentHigh) &&
                (squeezeBoxHigh === undefined || currentPrice > squeezeBoxHigh)
            : currentPrice < keltnerMid &&
                (recentLow === null || currentPrice < recentLow) &&
                (squeezeBoxLow === undefined || currentPrice < squeezeBoxLow);

        const breakoutBarrier = direction === 'long'
            ? Math.max(recentHigh ?? -Infinity, squeezeBoxHigh ?? -Infinity)
            : Math.min(recentLow ?? Infinity, squeezeBoxLow ?? Infinity);

        conditions.push(checkCondition(
            'price-breakout',
            direction === 'long'
                ? `价格站上中轨并突破压缩区 (${Number.isFinite(breakoutBarrier) ? breakoutBarrier.toFixed(4) : '无盒体'})`
                : `价格跌破中轨并跌穿压缩区 (${Number.isFinite(breakoutBarrier) ? breakoutBarrier.toFixed(4) : '无盒体'})`,
            pricePositionValid,
            currentPrice,
            Number.isFinite(breakoutBarrier) ? breakoutBarrier : keltnerMid
        ));

        // ========== 条件5: 放量实体 ==========
        const volumeRatio = ticker.volumeRatio ?? (ticker.volumeMA ? parseFloat(ticker.quoteVolume) / ticker.volumeMA : 1);
        const volumeExpansion = Number.isFinite(volumeRatio) && volumeRatio >= MIN_VOLUME_RATIO && bodyPercent >= MIN_BREAKOUT_BODY_PERCENT;

        conditions.push(checkCondition(
            'volume-expansion',
            `量比${Number.isFinite(volumeRatio) ? volumeRatio.toFixed(2) : '0.00'}x, 实体${bodyPercent.toFixed(2)}%`,
            volumeExpansion,
            Number.isFinite(volumeRatio) ? volumeRatio : undefined,
            MIN_VOLUME_RATIO
        ));

        // ========== 条件6: 趋势过滤 ==========
        const adx = ticker.adx || 0;
        const plusDI = ticker.plusDI || 0;
        const minusDI = ticker.minusDI || 0;
        const trendFilter = adx >= MIN_ADX && (
            direction === 'long'
                ? plusDI > minusDI
                : minusDI > plusDI
        );

        conditions.push(checkCondition(
            'trend-filter',
            `ADX=${adx.toFixed(1)}, +DI=${plusDI.toFixed(1)}, -DI=${minusDI.toFixed(1)}`,
            trendFilter,
            adx,
            MIN_ADX
        ));

        const conditionsMet = conditions.filter(c => c.met).length;
        if (conditionsMet < conditions.length) {
            return null;
        }

        // 100分制：专门筛高质量首段启动
        let confidence = 0;

        // 挤压质量 30分
        confidence += 18;
        confidence += bandwidthPercentile < STRONG_SQUEEZE_BANDWIDTH_PERCENTILE ? 7 : 4;
        confidence += squeezeDuration >= 14 ? 5 : 3;

        // 释放与动能 30分
        confidence += releaseBarsAgo === 0 ? 15 : 11;
        confidence += (direction === 'long' ? strongLongMomentum : strongShortMomentum) ? 15 : 11;

        // 结构确认 25分
        confidence += 15;
        confidence += bodyPercent >= 1.4 ? 10 : 7;

        // 量能与趋势 15分
        confidence += volumeRatio >= 1.8 ? 8 : 6;
        confidence += adx >= STRONG_ADX ? 7 : 5;

        confidence = Math.min(95, confidence);
        if (confidence < MIN_CONFIDENCE) {
            return null;
        }

        const metConditions = conditions.filter(c => c.met).map(c => c.description);
        cooldownManager.record(ticker.symbol, 'volatility-squeeze');

        // 🔥 计算风险管理参数
        let riskManagement;
        try {
            riskManagement = calculateRiskManagement('volatility-squeeze', {
                entryPrice: currentPrice,
                direction,
                confidence: Math.min(95, confidence),
                atr: ticker.atr,
                keltnerUpper: ticker.keltnerUpper,
                keltnerLower: ticker.keltnerLower,
                keltnerMid,
                momentumColor,
                squeezeDuration,
                bandwidthPercentile,
                adx,
                accountBalance: APP_CONFIG.RISK.DEFAULT_ACCOUNT_BALANCE,
                riskPercentage: 0.8,
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
            reason: `${conditionsMet}/6 条件满足：${metConditions.join(' | ')}`,
            metrics: {
                squeezeDuration,
                squeezeStrength,
                momentumValue,
                keltnerMid,
                currentPrice,
                bandwidthPercentile,
                adx,
                volumeRatio,
                releaseBarsAgo: releaseBarsAgo ?? -1,
                bodyPercent,
                conditionsMet
            },
            timestamp: Date.now(),
            isComposite: true,
            conditions,
            conditionsMet,
            totalConditions: 6,
            risk: riskManagement
        };
    }
};
