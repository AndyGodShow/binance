import type { TradingStrategy, StrategySignal, CompositeCondition } from '../lib/strategyTypes.ts';
import type { TickerData } from '../lib/types.ts';
import { cooldownManager } from '../lib/cooldownManager.ts';
import { logger } from '../lib/logger.ts';
import { APP_CONFIG } from '../lib/config.ts';
import { getTrendConfirmationRules, trendStateManager } from '../lib/trendStateManager.ts';
import { getStrategyParameterConfig } from '../lib/strategyParameters.ts';
import { calculateRiskManagement } from '../lib/risk/riskCalculator.ts';

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

// ==================== 复合策略 1: 强势突破（机构级优化版）====================
export const strongBreakoutStrategy: TradingStrategy = {
    id: 'strong-breakout',
    name: '🎯 强势突破',
    description: '21日新高 + 5m EMA 趋势 + 资金确认',
    category: 'trend',
    enabled: true,

    detect: (ticker: TickerData): StrategySignal | null => {
        const params = getStrategyParameterConfig('strong-breakout');
        if (cooldownManager.check(ticker.symbol, 'strong-breakout', params.cooldownPeriodMs)) {
            return null;
        }

        const conditions: CompositeCondition[] = [];
        const currentPrice = parseFloat(ticker.lastPrice);
        const change24h = parseFloat(ticker.priceChangePercent || '0');
        const breakout21dHigh = ticker.breakout21dHigh;
        const breakout21dPercent = ticker.breakout21dPercent;
        const ema20 = ticker.ema5m20;
        const ema60 = ticker.ema5m60;
        const ema100 = ticker.ema5m100;
        const emaDistancePercent = ticker.ema5mDistancePercent;

        // ========== 只做多：21根已完成日线高点突破 ==========
        const breakoutCondition =
            typeof breakout21dHigh === 'number' &&
            typeof breakout21dPercent === 'number' &&
            Number.isFinite(breakout21dHigh) &&
            Number.isFinite(breakout21dPercent) &&
            breakout21dPercent >= params.breakoutBufferPercent;

        conditions.push(checkCondition(
            'daily-breakout',
            breakoutCondition
                ? `突破过去21根已完成日线高点 (参考${breakout21dHigh!.toFixed(4)}, 当前突破${breakout21dPercent!.toFixed(2)}%)`
                : `未突破过去21根已完成日线高点${typeof breakout21dHigh === 'number' ? ` (参考${breakout21dHigh.toFixed(4)})` : ' (缺少日线数据)'}`,
            breakoutCondition,
            breakout21dPercent,
            params.breakoutBufferPercent
        ));

        if (!breakoutCondition) {
            return null;
        }

        // ========== 多周期动量：四个满足三个 ==========
        const change15m = ticker.change15m || 0;
        const change1h = ticker.change1h || 0;
        const change4h = ticker.change4h || 0;

        const momentumChecks = [
            change15m > params.momentumThresholds.change15m,
            change1h > params.momentumThresholds.change1h,
            change4h > params.momentumThresholds.change4h,
            change24h > params.momentumThresholds.change24h,
        ];
        const mtfMetCount = momentumChecks.filter(Boolean).length;
        const mtfCondition = mtfMetCount >= 3;

        conditions.push(checkCondition(
            'multi-timeframe',
            `多周期做多动量 (15m:${change15m.toFixed(1)}%, 1h:${change1h.toFixed(1)}%, 4h:${change4h.toFixed(1)}%, 24h:${change24h.toFixed(1)}%) [${mtfMetCount}/4满足]`,
            mtfCondition,
            mtfMetCount,
            3
        ));

        if (!mtfCondition) {
            return null;
        }

        // ========== 24h 成交额条件 ==========
        const volume = parseFloat(ticker.quoteVolume);
        const volumeCondition = volume > params.minVolume24h;

        conditions.push(checkCondition(
            'volume-threshold',
            `24h成交额 > $${(params.minVolume24h / 1000000).toFixed(0)}M (当前${(volume / 1000000).toFixed(1)}M)`,
            volumeCondition,
            volume,
            params.minVolume24h
        ));

        // ========== 4小时持仓量正增长 > 15% ==========
        const oiChangePercent = ticker.oiChangePercent || 0;
        const oiCondition = oiChangePercent > params.minOiChange4h;

        conditions.push(checkCondition(
            'oi-volatility',
            `4h持仓量正增长 > ${params.minOiChange4h}% (当前${oiChangePercent.toFixed(1)}%)`,
            oiCondition,
            oiChangePercent,
            params.minOiChange4h
        ));

        // ========== 5分钟 EMA 趋势条件 ==========
        const emaTrendCondition =
            typeof ema20 === 'number' &&
            typeof ema60 === 'number' &&
            typeof ema100 === 'number' &&
            Number.isFinite(ema20) &&
            Number.isFinite(ema60) &&
            Number.isFinite(ema100) &&
            ema20 > ema60 &&
            ema60 > ema100 &&
            currentPrice > ema20;

        conditions.push(checkCondition(
            'ema-trend',
            emaTrendCondition
                ? `5m趋势成立: EMA20 > EMA60 > EMA100，且价格位于 EMA20 上方`
                : `5m趋势未成立${typeof ema20 === 'number' && typeof ema60 === 'number' && typeof ema100 === 'number'
                    ? ` (价格:${currentPrice.toFixed(4)}, EMA20:${ema20.toFixed(4)}, EMA60:${ema60.toFixed(4)}, EMA100:${ema100.toFixed(4)})`
                    : ' (缺少5m EMA数据)'}`,
            emaTrendCondition
        ));

        const strengthCondition =
            typeof emaDistancePercent === 'number' &&
            Number.isFinite(emaDistancePercent) &&
            emaDistancePercent >= params.minEmaDistancePercent;

        conditions.push(checkCondition(
            'ema-strength',
            typeof emaDistancePercent === 'number'
                ? `价格高于 EMA20 至少 ${params.minEmaDistancePercent}% (当前${emaDistancePercent.toFixed(2)}%)`
                : `价格高于 EMA20 至少 ${params.minEmaDistancePercent}% (缺少5m EMA数据)`,
            strengthCondition,
            emaDistancePercent,
            params.minEmaDistancePercent
        ));

        const overheatCondition =
            typeof emaDistancePercent === 'number' &&
            Number.isFinite(emaDistancePercent) &&
            emaDistancePercent <= params.maxEmaDistancePercent;

        conditions.push(checkCondition(
            'ema-overheat',
            typeof emaDistancePercent === 'number'
                ? `价格不高于 EMA20 超过 ${params.maxEmaDistancePercent}% (当前${emaDistancePercent.toFixed(2)}%)`
                : `价格不高于 EMA20 超过 ${params.maxEmaDistancePercent}% (缺少5m EMA数据)`,
            overheatCondition,
            emaDistancePercent,
            params.maxEmaDistancePercent
        ));

        const conditionsMet = conditions.filter(c => c.met).length;

        if (conditionsMet === conditions.length) {
            let confidence = params.confidence.base;

            if (mtfMetCount === 4) {
                confidence += params.confidence.allMomentumBonus;
            }
            if (typeof breakout21dPercent === 'number' && breakout21dPercent >= params.confidence.strongBreakoutPercent) {
                confidence += params.confidence.strongBreakoutBonus;
            }
            if (oiChangePercent >= params.confidence.strongOiThreshold) {
                confidence += params.confidence.strongOiBonus;
            }
            if (volume >= params.confidence.strongVolumeThreshold) {
                confidence += params.confidence.strongVolumeBonus;
            }
            if (
                typeof emaDistancePercent === 'number' &&
                emaDistancePercent >= params.confidence.optimalEmaDistanceMin &&
                emaDistancePercent <= params.confidence.optimalEmaDistanceMax
            ) {
                confidence += params.confidence.optimalEmaBonus;
            }

            const metConditions = conditions.filter(c => c.met).map(c => c.description);

            cooldownManager.record(ticker.symbol, 'strong-breakout');

            // 🔥 计算风险管理参数
            let riskManagement;
            try {
                const atr = ticker.atr || 0;
                    riskManagement = calculateRiskManagement('strong-breakout', {
                        entryPrice: parseFloat(ticker.lastPrice),
                        direction: 'long',
                    confidence: Math.min(params.confidence.maxConfidence, confidence),
                    atr,
                    keltnerLower: ticker.keltnerLower,
                    keltnerUpper: ticker.keltnerUpper,
                    oiChangePercent: ticker.oiChangePercent,
                    volumeChangePercent: ticker.volumeChangePercent,
                    accountBalance: APP_CONFIG.RISK.DEFAULT_ACCOUNT_BALANCE, // TODO: 从用户设置获取
                    riskPercentage: APP_CONFIG.RISK.DEFAULT_RISK_PER_TRADE
                });
            } catch (error) {
                logger.error('Risk calculation failed for strong-breakout', error as Error, { symbol: ticker.symbol });
            }

            return {
                symbol: ticker.symbol,
                strategyId: 'strong-breakout',
                strategyName: '🎯 强势突破',
                direction: 'long',
                confidence: Math.min(params.confidence.maxConfidence, confidence),
                reason: `${conditionsMet}/${conditions.length} 条件满足：${metConditions.join(' | ')}`,
                metrics: {
                    change1h,
                    change15m,
                    change4h,
                    change24h,
                    volume,
                    oiChangePercent,
                    mtfMetCount,
                    conditionsMet,
                    breakout21dHigh: breakout21dHigh || 0,
                    breakout21dPercent: breakout21dPercent || 0,
                    ema20: ema20 || 0,
                    ema60: ema60 || 0,
                    ema100: ema100 || 0,
                    emaDistancePercent: emaDistancePercent || 0,
                },
                timestamp: Date.now(),
                isComposite: true,
                conditions,
                conditionsMet,
                totalConditions: conditions.length,
                risk: riskManagement
            };
        }

        return null;
    }
};


// ==================== 复合策略 2: 趋势确认（机构级优化版）====================
export const trendConfirmationStrategy: TradingStrategy = {
    id: 'trend-confirmation',
    name: '🎯 趋势确认',
    description: '多周期方向 + GMMA 状态 + EMA 趋势框架',
    category: 'trend',
    enabled: true,

    detect: (ticker: TickerData): StrategySignal | null => {
        const params = getStrategyParameterConfig('trend-confirmation');
        const trendRules = getTrendConfirmationRules();
        if (cooldownManager.check(ticker.symbol, 'trend-confirmation', params.cooldownPeriodMs)) {
            return null;
        }

        const conditions: CompositeCondition[] = [];
        const change15m = ticker.change15m || 0;
        const change1h = ticker.change1h || 0;
        const change4h = ticker.change4h || 0;
        const oiValue = parseFloat(ticker.openInterestValue || '0');
        const quoteVolume = parseFloat(ticker.quoteVolume || '0');
        const oiChangePercent = ticker.oiChangePercent || 0;
        const emaDistancePercent = typeof ticker.ema5mDistancePercent === 'number' && Number.isFinite(ticker.ema5mDistancePercent)
            ? ticker.ema5mDistancePercent
            : null;
        const gmmaTrend = ticker.gmmaTrend || 'mixed';
        const multiEmaTrend = ticker.multiEmaTrend || 'mixed';

        const evaluation = trendStateManager.evaluate(ticker.symbol, {
            change15m,
            change1h,
            change4h,
            quoteVolume,
            oiValue,
            oiChangePercent,
            emaDistancePercent,
            gmmaTrend,
            multiEmaTrend,
        });

        const direction = evaluation.direction;
        if (!direction || !evaluation.phase.startsWith('active_')) {
            return null;
        }
        const avgDirectionalChange = (Math.abs(change15m) + Math.abs(change1h) + Math.abs(change4h)) / 3;
        const startRule = direction === 'long'
            ? trendRules.longStart
            : trendRules.shortStart;
        const holdRule = direction === 'long'
            ? trendRules.longHold
            : trendRules.shortHold;
        const momentumReady = direction === 'long'
            ? (
                change15m >= holdRule.change15m &&
                change1h >= holdRule.change1h &&
                change4h >= holdRule.change4h
            )
            : (
                change15m <= holdRule.change15m &&
                change1h <= holdRule.change1h &&
                change4h <= holdRule.change4h
            );

        // 条件1: 多周期共振
        conditions.push(checkCondition(
            'multi-timeframe',
            `多周期${direction === 'long' ? '向上' : '向下'}推进 (15m:${change15m.toFixed(1)}%, 1h:${change1h.toFixed(1)}%, 4h:${change4h.toFixed(1)}%)`,
            momentumReady,
            Math.abs(avgDirectionalChange),
            Math.abs(holdRule.change4h)
        ));

        const liquidityCondition = evaluation.flags.baseLiquidityOk;

        conditions.push(checkCondition(
            'liquidity-threshold',
            `成交额>$${(trendRules.minBaseQuoteVolume / 1000000).toFixed(0)}M 且持仓>$${(trendRules.minBaseOiValue / 1000000).toFixed(0)}M (当前${(quoteVolume / 1000000).toFixed(1)}M / ${(oiValue / 1000000).toFixed(1)}M)`,
            liquidityCondition,
            oiValue,
            trendRules.minBaseOiValue
        ));

        const gmmaCondition = direction === 'long'
            ? gmmaTrend === 'bullish'
            : gmmaTrend === 'bearish';

        conditions.push(checkCondition(
            'gmma-structure',
            `GMMA 状态为${direction === 'long' ? '绿' : '红'} (当前:${gmmaTrend === 'bullish' ? '绿' : gmmaTrend === 'bearish' ? '红' : '灰'})`,
            gmmaCondition,
            gmmaTrend === 'mixed' ? 0 : 1,
            1
        ));

        const multiEmaAlignmentScore = ticker.multiEmaAlignmentScore || 0;
        const multiEmaCondition = direction === 'long'
            ? multiEmaTrend !== 'bearish'
            : multiEmaTrend !== 'bullish';

        conditions.push(checkCondition(
            'multi-ema-stack',
            `EMA 趋势框架 ${direction === 'long' ? '多头' : '空头'} (当前:${multiEmaTrend}, 排列:${multiEmaAlignmentScore})`,
            multiEmaCondition,
            multiEmaAlignmentScore,
            1
        ));

        const participationCondition = evaluation.flags.baseParticipationOk;

        conditions.push(checkCondition(
            'oi-expansion',
            `4h持仓扩张 > ${trendRules.minBaseOiExpansion}% (当前${oiChangePercent.toFixed(1)}%)`,
            participationCondition,
            oiChangePercent,
            trendRules.minBaseOiExpansion
        ));

        const stretchCondition = emaDistancePercent !== null && direction === 'long'
            ? emaDistancePercent >= holdRule.minEmaDistance && emaDistancePercent <= holdRule.maxEmaDistance
            : emaDistancePercent !== null &&
                emaDistancePercent >= holdRule.minEmaDistance &&
                emaDistancePercent <= holdRule.maxEmaDistance;

        conditions.push(checkCondition(
            'entry-stretch',
            direction === 'long'
                ? `价格高于 EMA20 ${holdRule.minEmaDistance.toFixed(1)}%~${holdRule.maxEmaDistance.toFixed(1)}% (当前${emaDistancePercent?.toFixed(2) ?? '无'}%)`
                : `价格低于 EMA20 ${Math.abs(holdRule.maxEmaDistance).toFixed(1)}%~${Math.abs(holdRule.minEmaDistance).toFixed(1)}% (当前${emaDistancePercent?.toFixed(2) ?? '无'}%)`,
            stretchCondition,
            emaDistancePercent ?? undefined,
            direction === 'long' ? holdRule.minEmaDistance : Math.abs(holdRule.maxEmaDistance)
        ));

        // ========== Beta 系数过滤（独立性验证）==========
        const beta = ticker.betaToBTC || 1.0;
        const correlation = ticker.correlationToBTC || 0;
        const isBTCCorrelated = Math.abs(correlation) > params.betaFilter.correlationThreshold;

        let betaCondition = true;
        let betaDesc = '';

        if (params.betaFilter.enabled && isBTCCorrelated && beta < params.betaFilter.minBetaWhenCorrelated) {
            betaCondition = false;
            betaDesc = `⚠️ 高度跟随 BTC (Beta=${beta.toFixed(2)}, 相关=${correlation.toFixed(2)})`;
        } else if (beta > params.confidence.betaStrengthThreshold) {
            betaCondition = true;
            betaDesc = `✓ 强于大盘 (Beta=${beta.toFixed(2)})`;
        } else {
            betaCondition = true;
            betaDesc = `独立行情 (Beta=${beta.toFixed(2)})`;
        }

        conditions.push(checkCondition(
            'beta-independence',
            betaDesc,
            betaCondition,
            beta,
            1.0
        ));

        const conditionsMet = conditions.filter(c => c.met).length;

        const coreConditionsMet =
            momentumReady &&
            liquidityCondition &&
            gmmaCondition &&
            multiEmaCondition &&
            participationCondition &&
            stretchCondition &&
            betaCondition;

        if (!coreConditionsMet) {
            return null;
        }

        let confidence = evaluation.event === 'reversal'
            ? params.confidence.reversal
            : evaluation.event === 'resume'
            ? params.confidence.resume
            : evaluation.event === 'start'
            ? params.confidence.start
            : params.confidence.active;

        if (
            (direction === 'long' && change15m >= startRule.change15m && change1h >= startRule.change1h && change4h >= startRule.change4h) ||
            (direction === 'short' && change15m <= startRule.change15m && change1h <= startRule.change1h && change4h <= startRule.change4h)
        ) {
            confidence += params.confidence.strongStartBonus;
        }
        if (quoteVolume >= params.confidence.highVolumeThreshold) {
            confidence += params.confidence.highVolumeBonus;
        }
        if (oiValue >= params.confidence.highOiValueThreshold) {
            confidence += params.confidence.highOiValueBonus;
        }
        if (oiChangePercent >= params.confidence.highOiExpansionThreshold) {
            confidence += params.confidence.highOiExpansionBonus;
        }
        if (
            emaDistancePercent !== null &&
            Math.abs(emaDistancePercent) >= params.confidence.optimalEmaDistanceMin &&
            Math.abs(emaDistancePercent) <= params.confidence.optimalEmaDistanceMax
        ) {
            confidence += params.confidence.optimalEmaBonus;
        }
        if (beta > params.confidence.betaStrengthThreshold) {
            confidence += params.confidence.betaStrengthBonus;
        }

        const metConditions = conditions.filter(c => c.met).map(c => c.description);

        cooldownManager.record(ticker.symbol, 'trend-confirmation');
        const eventLabel = evaluation.event === 'reversal'
            ? '趋势反转确认'
            : evaluation.event === 'resume'
            ? '回踩后再启动'
            : evaluation.event === 'start'
            ? '趋势启动'
            : '趋势延续';

        let riskManagement;
        try {
            riskManagement = calculateRiskManagement('trend-confirmation', {
                entryPrice: parseFloat(ticker.lastPrice),
                direction,
                confidence: Math.min(params.confidence.maxConfidence, confidence),
                atr: ticker.atr,
                keltnerMid: ticker.keltnerMid,
                keltnerUpper: ticker.keltnerUpper,
                keltnerLower: ticker.keltnerLower,
                bandwidthPercentile: ticker.bandwidthPercentile,
                fundingRateTrend: 'stable',
                betaToBTC: beta,
                accountBalance: APP_CONFIG.RISK.DEFAULT_ACCOUNT_BALANCE, // TODO: 从用户设置获取
                riskPercentage: APP_CONFIG.RISK.DEFAULT_RISK_PER_TRADE
            });
        } catch (error) {
            logger.error('Risk calculation failed for trend-confirmation', error as Error, { symbol: ticker.symbol });
        }

        return {
            symbol: ticker.symbol,
            strategyId: 'trend-confirmation',
            strategyName: '🎯 趋势确认',
            direction,
            confidence: Math.min(params.confidence.maxConfidence, confidence),
            reason: `${eventLabel}：${metConditions.join(' | ')}`,
            metrics: {
                change15m,
                change1h,
                change4h,
                avgChange: avgDirectionalChange,
                gmmaState: gmmaTrend === 'bullish' ? 1 : gmmaTrend === 'bearish' ? -1 : 0,
                multiEmaAlignmentScore,
                beta,
                correlation,
                oiValue,
                oiChangePercent,
                quoteVolume,
                emaDistancePercent: emaDistancePercent ?? 0,
                conditionsMet
            },
            timestamp: Date.now(),
            isComposite: true,
            conditions,
            conditionsMet,
            totalConditions: conditions.length,
            risk: riskManagement
        };
    }
};


// ==================== 复合策略 3: 资金流入（机构级优化版）====================
export const capitalInflowStrategy: TradingStrategy = {
    id: 'capital-inflow',
    name: '🎯 资金流入',
    description: 'CVD质量验证 + Volume Profile突破',
    category: 'volume',
    enabled: true,

    detect: (ticker: TickerData): StrategySignal | null => {
        const params = getStrategyParameterConfig('capital-inflow');
        if (cooldownManager.check(ticker.symbol, 'capital-inflow', params.cooldownPeriodMs)) {
            return null;
        }

        const conditions: CompositeCondition[] = [];

        // 条件1: 价格快速增长
        const change1h = ticker.change1h || 0;
        const change4h = ticker.change4h || 0;
        const change15m = ticker.change15m || 0;

        const priceGrowthCondition =
            change1h > params.priceGrowth.minChange1h &&
            change4h > params.priceGrowth.minChange4h &&
            change15m > change1h * params.priceGrowth.minChange15mTo1hRatio;
        conditions.push(checkCondition(
            'price-growth',
            `价格快速增长: 1h ${change1h.toFixed(1)}%, 4h ${change4h.toFixed(1)}%`,
            priceGrowthCondition,
            change1h,
            params.priceGrowth.minChange1h
        ));

        // ========== CVD 质量验证 ==========
        const volume = parseFloat(ticker.quoteVolume);
        const cvd = ticker.cvd;
        const cvdSlope = ticker.cvdSlope;
        const hasCvdData = typeof cvd === 'number' && typeof cvdSlope === 'number';

        const isActiveBuying =
            change1h > 0 &&
            hasCvdData &&
            cvdSlope > params.quality.minCvdSlope;

        const volumeCondition = volume > params.quality.minVolume24h;
        const qualityCondition =
            volumeCondition &&
            (!params.quality.requireCvdData || hasCvdData) &&
            hasCvdData &&
            cvdSlope > params.quality.minCvdSlope;

        conditions.push(checkCondition(
            'high-volume-quality',
            `成交量>$${(params.quality.minVolume24h / 1000000).toFixed(0)}M (当前${(volume / 1000000).toFixed(1)}M) ${!hasCvdData ? '⚠️缺少CVD数据' : isActiveBuying ? '✓主动买盘' : '⚠️被动推升'}`,
            qualityCondition,
            volume,
            params.quality.minVolume24h
        ));

        // ========== Volume Profile VAH 突破 ==========
        const change24h = parseFloat(ticker.priceChangePercent);
        const volumeRatio = ticker.volumeMA ? volume / ticker.volumeMA : 1;
        const currentPrice = parseFloat(ticker.lastPrice);

        const vah = ticker.vah;
        const poc = ticker.poc;

        let vpBreakout = false;
        let vpDesc = '';

        if (typeof vah === 'number' && typeof poc === 'number') {
            const aboveVAH = currentPrice > vah;
            const distanceFromPOC = ((currentPrice - poc) / poc * 100);

            vpBreakout = aboveVAH && distanceFromPOC > params.volumeProfile.minDistanceFromPocPercent;
            vpDesc = `${aboveVAH ? '已突破VAH' : '未突破VAH'} (距POC ${distanceFromPOC.toFixed(1)}%)`;
        } else if (params.volumeProfile.allowPriceOnlyFallback) {
            vpBreakout = change24h > params.volumeProfile.minChange24hFallback;
            vpDesc = '价格突破 (无VP数据)';
        } else {
            vpBreakout = false;
            vpDesc = '缺少VP数据';
        }

        const breakoutCondition =
            (!params.volumeProfile.requireVolumeProfile || (typeof vah === 'number' && typeof poc === 'number')) &&
            vpBreakout &&
            volumeRatio > params.volumeProfile.minVolumeRatio;

        conditions.push(checkCondition(
            'volume-profile-breakout',
            `${vpDesc} 且量增${volumeRatio.toFixed(1)}x`,
            breakoutCondition,
            change24h,
            params.volumeProfile.allowPriceOnlyFallback
                ? params.volumeProfile.minChange24hFallback
                : params.volumeProfile.minDistanceFromPocPercent
        ));

        const conditionsMet = conditions.filter(c => c.met).length;

        // 🔥 严格模式: 必须满足全部3个条件
        if (conditionsMet >= 3) {
            let confidence = params.confidence.base + (conditionsMet * params.confidence.conditionBonus);

            if (isActiveBuying) {
                confidence += params.confidence.activeBuyingBonus;
            }

            if (volume > params.confidence.hugeVolumeThreshold) {
                confidence += params.confidence.hugeVolumeBonus;
            }

            if (confidence < params.confidence.minConfidence) {
                return null;
            }

            const metConditions = conditions.filter(c => c.met).map(c => c.description);
            cooldownManager.record(ticker.symbol, 'capital-inflow');

            // 🔥 计算风险管理参数
            let riskManagement;
            try {
                riskManagement = calculateRiskManagement('capital-inflow', {
                    entryPrice: parseFloat(ticker.lastPrice),
                    direction: 'long',
                    confidence: Math.min(params.confidence.maxConfidence, confidence),
                    atr: ticker.atr,
                    vah: ticker.vah,
                    val: ticker.val,
                    poc: ticker.poc,
                    cvdSlope: ticker.cvdSlope,
                    // 从全局安全配置读取默认值
                    accountBalance: APP_CONFIG.RISK.DEFAULT_ACCOUNT_BALANCE, // TODO: 从用户设置获取
                    riskPercentage: APP_CONFIG.RISK.DEFAULT_RISK_PER_TRADE
                });
            } catch (error) {
                logger.error('Risk calculation failed for capital-inflow', error as Error, { symbol: ticker.symbol });
            }

            return {
                symbol: ticker.symbol,
                strategyId: 'capital-inflow',
                strategyName: '🎯 资金流入',
                direction: 'long',
                confidence: Math.min(params.confidence.maxConfidence, confidence),
                reason: `${conditionsMet}/3 条件满足：${metConditions.join(' | ')}`,
                metrics: {
                    change1h,
                    change4h,
                    change15m,
                    volume,
                    change24h,
                    volumeRatio,
                    cvd: cvd ?? 0,
                    cvdSlope: cvdSlope ?? 0,
                    vah: vah || 0,
                    poc: poc || 0,
                    conditionsMet
                },
                timestamp: Date.now(),
                isComposite: true,
                conditions,
                conditionsMet,
                totalConditions: 3,
                risk: riskManagement
            };
        }

        return null;
    }
};
