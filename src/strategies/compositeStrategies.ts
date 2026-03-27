import { TradingStrategy, StrategySignal, CompositeCondition } from '../lib/strategyTypes';
import { TickerData } from '../lib/types';
import { cooldownManager } from '../lib/cooldownManager';
import { logger } from '../lib/logger';
import { APP_CONFIG } from '../lib/config';
import { TREND_CONFIRMATION_RULES, trendStateManager } from '../lib/trendStateManager';
import { calculateRiskManagement } from '@/lib/risk/riskCalculator';

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

// 🎯 差异化冷却期：根据策略类型调整
const COOLDOWN_PERIODS = {
    'strong-breakout': 45 * 60 * 1000,      // 45分钟 - 追涨型
    'trend-confirmation': 60 * 60 * 1000,   // 60分钟 - 趋势型
    'capital-inflow': 30 * 60 * 1000,       // 30分钟 - 短线型
};

const STRONG_BREAKOUT_RULES = {
    breakoutBufferPercent: 0.3,
    minVolume24h: 10000000,
    minOiChange4h: 15,
    minEmaDistancePercent: 1,
    maxEmaDistancePercent: 8,
    momentumThresholds: {
        change15m: 2,
        change1h: 4,
        change4h: 8,
        change24h: 12,
    },
} as const;

// ==================== 复合策略 1: 强势突破（机构级优化版）====================
export const strongBreakoutStrategy: TradingStrategy = {
    id: 'strong-breakout',
    name: '🎯 强势突破',
    description: '21日新高 + 5m EMA 趋势 + 资金确认',
    category: 'trend',
    enabled: true,

    detect: (ticker: TickerData): StrategySignal | null => {
        if (cooldownManager.check(ticker.symbol, 'strong-breakout', COOLDOWN_PERIODS['strong-breakout'])) {
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
            breakout21dPercent >= STRONG_BREAKOUT_RULES.breakoutBufferPercent;

        conditions.push(checkCondition(
            'daily-breakout',
            breakoutCondition
                ? `突破过去21根已完成日线高点 (参考${breakout21dHigh!.toFixed(4)}, 当前突破${breakout21dPercent!.toFixed(2)}%)`
                : `未突破过去21根已完成日线高点${typeof breakout21dHigh === 'number' ? ` (参考${breakout21dHigh.toFixed(4)})` : ' (缺少日线数据)'}`,
            breakoutCondition,
            breakout21dPercent,
            STRONG_BREAKOUT_RULES.breakoutBufferPercent
        ));

        if (!breakoutCondition) {
            return null;
        }

        // ========== 多周期动量：四个满足三个 ==========
        const change15m = ticker.change15m || 0;
        const change1h = ticker.change1h || 0;
        const change4h = ticker.change4h || 0;

        const momentumChecks = [
            change15m > STRONG_BREAKOUT_RULES.momentumThresholds.change15m,
            change1h > STRONG_BREAKOUT_RULES.momentumThresholds.change1h,
            change4h > STRONG_BREAKOUT_RULES.momentumThresholds.change4h,
            change24h > STRONG_BREAKOUT_RULES.momentumThresholds.change24h,
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

        // ========== 24h 成交额条件：> $20M ==========
        const volume = parseFloat(ticker.quoteVolume);
        const volumeCondition = volume > STRONG_BREAKOUT_RULES.minVolume24h;

        conditions.push(checkCondition(
            'volume-threshold',
            `24h成交额 > $10M (当前${(volume / 1000000).toFixed(1)}M)`,
            volumeCondition,
            volume,
            STRONG_BREAKOUT_RULES.minVolume24h
        ));

        // ========== 4小时持仓量正增长 > 15% ==========
        const oiChangePercent = ticker.oiChangePercent || 0;
        const oiCondition = oiChangePercent > STRONG_BREAKOUT_RULES.minOiChange4h;

        conditions.push(checkCondition(
            'oi-volatility',
            `4h持仓量正增长 > 15% (当前${oiChangePercent.toFixed(1)}%)`,
            oiCondition,
            oiChangePercent,
            STRONG_BREAKOUT_RULES.minOiChange4h
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
            emaDistancePercent >= STRONG_BREAKOUT_RULES.minEmaDistancePercent;

        conditions.push(checkCondition(
            'ema-strength',
            typeof emaDistancePercent === 'number'
                ? `价格高于 EMA20 至少 1% (当前${emaDistancePercent.toFixed(2)}%)`
                : '价格高于 EMA20 至少 1% (缺少5m EMA数据)',
            strengthCondition,
            emaDistancePercent,
            STRONG_BREAKOUT_RULES.minEmaDistancePercent
        ));

        const overheatCondition =
            typeof emaDistancePercent === 'number' &&
            Number.isFinite(emaDistancePercent) &&
            emaDistancePercent <= STRONG_BREAKOUT_RULES.maxEmaDistancePercent;

        conditions.push(checkCondition(
            'ema-overheat',
            typeof emaDistancePercent === 'number'
                ? `价格不高于 EMA20 超过 8% (当前${emaDistancePercent.toFixed(2)}%)`
                : '价格不高于 EMA20 超过 8% (缺少5m EMA数据)',
            overheatCondition,
            emaDistancePercent,
            STRONG_BREAKOUT_RULES.maxEmaDistancePercent
        ));

        const conditionsMet = conditions.filter(c => c.met).length;

        if (conditionsMet === conditions.length) {
            let confidence = 86;

            if (mtfMetCount === 4) {
                confidence += 4;
            }
            if (typeof breakout21dPercent === 'number' && breakout21dPercent >= 1) {
                confidence += 2;
            }
            if (oiChangePercent >= 25) {
                confidence += 2;
            }
            if (volume >= 50000000) {
                confidence += 2;
            }
            if (typeof emaDistancePercent === 'number' && emaDistancePercent >= 1.5 && emaDistancePercent <= 4) {
                confidence += 2;
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
                    confidence: Math.min(95, confidence),
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
                confidence: Math.min(95, confidence),
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
        if (cooldownManager.check(ticker.symbol, 'trend-confirmation', COOLDOWN_PERIODS['trend-confirmation'])) {
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
            ? TREND_CONFIRMATION_RULES.longStart
            : TREND_CONFIRMATION_RULES.shortStart;
        const holdRule = direction === 'long'
            ? TREND_CONFIRMATION_RULES.longHold
            : TREND_CONFIRMATION_RULES.shortHold;
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
            `成交额>$${(TREND_CONFIRMATION_RULES.minBaseQuoteVolume / 1000000).toFixed(0)}M 且持仓>$${(TREND_CONFIRMATION_RULES.minBaseOiValue / 1000000).toFixed(0)}M (当前${(quoteVolume / 1000000).toFixed(1)}M / ${(oiValue / 1000000).toFixed(1)}M)`,
            liquidityCondition,
            oiValue,
            TREND_CONFIRMATION_RULES.minBaseOiValue
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
            `4h持仓扩张 > ${TREND_CONFIRMATION_RULES.minBaseOiExpansion}% (当前${oiChangePercent.toFixed(1)}%)`,
            participationCondition,
            oiChangePercent,
            TREND_CONFIRMATION_RULES.minBaseOiExpansion
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
        const isBTCCorrelated = Math.abs(correlation) > 0.9;

        let betaCondition = true;
        let betaDesc = '';

        if (isBTCCorrelated && beta < 1.2) {
            // 高度跟随 BTC 且不强于大盘，降低评级
            betaCondition = false;
            betaDesc = `⚠️ 高度跟随 BTC (Beta=${beta.toFixed(2)}, 相关=${correlation.toFixed(2)})`;
        } else if (beta > 1.2) {
            // 强于大盘
            betaCondition = true;
            betaDesc = `✓ 强于大盘 (Beta=${beta.toFixed(2)})`;
        } else {
            // 独立行情
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
            stretchCondition;

        if (!coreConditionsMet) {
            return null;
        }

        let confidence = evaluation.event === 'reversal'
            ? 90
            : evaluation.event === 'resume'
            ? 88
            : evaluation.event === 'start'
            ? 87
            : 85;

        if (
            (direction === 'long' && change15m >= startRule.change15m && change1h >= startRule.change1h && change4h >= startRule.change4h) ||
            (direction === 'short' && change15m <= startRule.change15m && change1h <= startRule.change1h && change4h <= startRule.change4h)
        ) {
            confidence += 2;
        }
        if (quoteVolume >= 50_000_000) {
            confidence += 2;
        }
        if (oiValue >= 30_000_000) {
            confidence += 1;
        }
        if (oiChangePercent >= 15) {
            confidence += 2;
        }
        if (emaDistancePercent !== null && Math.abs(emaDistancePercent) >= 0.8 && Math.abs(emaDistancePercent) <= 3.2) {
            confidence += 1;
        }
        if (beta > 1.2) {
            confidence += 2;
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
                confidence: Math.min(95, confidence),
                atr: ticker.atr,
                keltnerMid: ticker.keltnerMid,
                keltnerUpper: ticker.keltnerUpper,
                keltnerLower: ticker.keltnerLower,
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
            confidence: Math.min(95, confidence),
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
        if (cooldownManager.check(ticker.symbol, 'capital-inflow', COOLDOWN_PERIODS['capital-inflow'])) {
            return null;
        }

        const conditions: CompositeCondition[] = [];

        // 条件1: 价格快速增长
        const change1h = ticker.change1h || 0;
        const change4h = ticker.change4h || 0;
        const change15m = ticker.change15m || 0;

        const priceGrowthCondition = change1h > 8 && change4h > 5 && change15m > change1h * 0.6;
        conditions.push(checkCondition(
            'price-growth',
            `价格快速增长: 1h ${change1h.toFixed(1)}%, 4h ${change4h.toFixed(1)}%`,
            priceGrowthCondition,
            change1h,
            8
        ));

        // ========== CVD 质量验证 ==========
        const volume = parseFloat(ticker.quoteVolume);
        const cvd = ticker.cvd;
        const cvdSlope = ticker.cvdSlope;
        const hasCvdData = typeof cvd === 'number' && typeof cvdSlope === 'number';

        // 价格上涨 + CVD 斜率向上 = 主动买盘（高质量）
        const isActiveBuying = change1h > 0 && hasCvdData && cvdSlope > 0;

        const volumeCondition = volume > 30000000;
        const qualityCondition = volumeCondition && hasCvdData && cvdSlope > 0;

        conditions.push(checkCondition(
            'high-volume-quality',
            `成交量>$30M (当前${(volume / 1000000).toFixed(1)}M) ${!hasCvdData ? '⚠️缺少CVD数据' : isActiveBuying ? '✓主动买盘' : '⚠️被动推升'}`,
            qualityCondition,
            volume,
            30000000
        ));

        // ========== Volume Profile VAH 突破 ==========
        const change24h = parseFloat(ticker.priceChangePercent);
        const volumeRatio = ticker.volumeMA ? volume / ticker.volumeMA : 1;
        const currentPrice = parseFloat(ticker.lastPrice);

        const vah = ticker.vah;
        const poc = ticker.poc;

        let vpBreakout = false;
        let vpDesc = '';

        if (vah && poc) {
            const aboveVAH = currentPrice > vah;
            const distanceFromPOC = ((currentPrice - poc) / poc * 100);

            // 价格突破 VAH 且远离 POC（脱离密集成交区）
            vpBreakout = aboveVAH && distanceFromPOC > 2;
            vpDesc = `${aboveVAH ? '已突破VAH' : '未突破VAH'} (距POC ${distanceFromPOC.toFixed(1)}%)`;
        } else {
            vpBreakout = change24h > 10; // 无数据时降级为价格突破
            vpDesc = '价格突破 (无VP数据)';
        }

        const breakoutCondition = vpBreakout && volumeRatio > 1.5;

        conditions.push(checkCondition(
            'volume-profile-breakout',
            `${vpDesc} 且量增${volumeRatio.toFixed(1)}x`,
            breakoutCondition,
            change24h,
            10
        ));

        const conditionsMet = conditions.filter(c => c.met).length;

        // 🔥 严格模式: 必须满足全部3个条件
        if (conditionsMet >= 3) {
            let confidence = 68 + (conditionsMet * 7);

            // CVD 主动买盘加成
            if (isActiveBuying) {
                confidence += 5;
            }

            // 超大成交量加成
            if (volume > 100000000) {
                confidence += 3;
            }

            // 🔥 严格模式: 最低置信度过滤
            if (confidence < 80) {
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
                    confidence: Math.min(88, confidence),
                    atr: ticker.atr,
                    vah: ticker.vah,
                    val: ticker.val,
                    poc: ticker.poc,
                    cvdSlope: ticker.cvdSlope,
                    turnoverRatio: 0,
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
                confidence: Math.min(88, confidence),
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
