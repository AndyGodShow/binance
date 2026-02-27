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

// 🎯 差异化冷却期：根据策略类型调整
const COOLDOWN_PERIODS = {
    'strong-breakout': 45 * 60 * 1000,      // 45分钟 - 追涨型
    'trend-confirmation': 60 * 60 * 1000,   // 60分钟 - 趋势型
    'capital-inflow': 30 * 60 * 1000,       // 30分钟 - 短线型
};

// ==================== 复合策略 1: 强势突破（机构级优化版）====================
export const strongBreakoutStrategy: TradingStrategy = {
    id: 'strong-breakout',
    name: '🎯 强势突破',
    description: '波动率自适应 + VSA假突破过滤',
    category: 'trend',
    enabled: true,

    detect: (ticker: TickerData): StrategySignal | null => {
        // 冷却期检查
        if (cooldownManager.check(ticker.symbol, 'strong-breakout', COOLDOWN_PERIODS['strong-breakout'])) {
            return null;
        }

        const conditions: CompositeCondition[] = [];

        // ========== 多周期波动条件：15分钟2%, 1小时4%, 4小时10% (三个满足两个) ==========
        const change15m = ticker.change15m || 0;
        const change1h = ticker.change1h || 0;
        const change4h = ticker.change4h || 0;

        // 检查每个周期是否满足条件
        const is15mMet = Math.abs(change15m) > 2;
        const is1hMet = Math.abs(change1h) > 4;
        const is4hMet = Math.abs(change4h) > 10;

        const mtfMetCount = [is15mMet, is1hMet, is4hMet].filter(Boolean).length;
        const mtfCondition = mtfMetCount >= 2;

        conditions.push(checkCondition(
            'multi-timeframe',
            `多周期波动 (15m:${change15m.toFixed(1)}%${is15mMet ? '✓' : ''}, 1h:${change1h.toFixed(1)}%${is1hMet ? '✓' : ''}, 4h:${change4h.toFixed(1)}%${is4hMet ? '✓' : ''}) [${mtfMetCount}/3满足]`,
            mtfCondition,
            mtfMetCount,
            2
        ));

        // ========== 成交量条件：> $40M ==========
        const volume = parseFloat(ticker.quoteVolume);
        const change24h = parseFloat(ticker.priceChangePercent);
        const volumeCondition = volume > 40000000;

        // VSA 假突破过滤
        let isFakePump =
            change15m > 15 &&
            change1h < change15m * 0.5 &&
            ticker.volumeMA !== undefined &&
            volume < (ticker.volumeMA * 1.2);

        // VSA 上影线检测（供应进入测试）
        const latestCandle = ticker.ohlc?.[ticker.ohlc.length - 1];
        let vsaWarning = '';

        if (latestCandle && !isFakePump) {
            const candleRange = latestCandle.high - latestCandle.low;
            const upperWick = candleRange > 0
                ? (latestCandle.high - latestCandle.close) / candleRange
                : 0;

            if (upperWick > 0.4) {
                isFakePump = true;
                vsaWarning = ' ⚠️供应进入(上影线)';
            }
        }

        const validVolume = volumeCondition && !isFakePump;

        conditions.push(checkCondition(
            'volume-threshold',
            `成交量 > $40M (当前${(volume / 1000000).toFixed(1)}M)${isFakePump ? (vsaWarning || ' ⚠️疑似假突破') : ''}`,
            validVolume,
            volume,
            40000000
        ));

        // ========== 4小时持仓量波动 > 40% ==========
        const oiChangePercent = ticker.oiChangePercent || 0;
        const oiCondition = Math.abs(oiChangePercent) > 40;

        conditions.push(checkCondition(
            'oi-volatility',
            `4h持仓量波动 > 40% (当前${oiChangePercent.toFixed(1)}%)`,
            oiCondition,
            Math.abs(oiChangePercent),
            40
        ));

        const conditionsMet = conditions.filter(c => c.met).length;

        // 🔥 必须满足全部3个条件
        if (conditionsMet >= 3 && !isFakePump) {
            let confidence = 70 + (conditionsMet * 8);

            // 多周期全部满足加成
            if (mtfMetCount === 3) {
                confidence += 5;
            }

            // 持仓量超高波动加成
            if (Math.abs(oiChangePercent) > 60) {
                confidence += 5;
            }

            // 🔥 最低置信度过滤
            if (confidence < 75) {
                return null;
            }

            const metConditions = conditions.filter(c => c.met).map(c => c.description);
            cooldownManager.record(ticker.symbol, 'strong-breakout');

            // 🔥 计算风险管理参数
            let riskManagement;
            try {
                const { calculateRiskManagement } = require('@/lib/risk/riskCalculator');

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
                    accountBalance: 10000,
                    riskPercentage: 1
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
                reason: `${conditionsMet}/3 条件满足：${metConditions.join(' | ')}`,
                metrics: {
                    change1h,
                    change15m,
                    change4h,
                    volume,
                    change24h,
                    oiChangePercent,
                    mtfMetCount,
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


// ==================== 复合策略 2: 趋势确认（机构级优化版）====================
export const trendConfirmationStrategy: TradingStrategy = {
    id: 'trend-confirmation',
    name: '🎯 趋势确认',
    description: '多周期共振 + Beta独立性验证',
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

        // ========== 多周期共振：三个满足两个就行 ==========
        const is15mMet = Math.abs(change15m) > 3;
        const is1hMet = Math.abs(change1h) > 3;
        const is4hMet = Math.abs(change4h) > 3;

        const mtfMetCount = [is15mMet, is1hMet, is4hMet].filter(Boolean).length;
        const mtfCondition = mtfMetCount >= 2;

        if (!mtfCondition) {
            return null;
        }

        // 判断方向（做多或做空）
        const avgChange = (change15m + change1h + change4h) / 3;
        const direction: 'long' | 'short' = avgChange > 0 ? 'long' : 'short';

        // 条件1: 多周期共振
        conditions.push(checkCondition(
            'multi-timeframe',
            `多周期${direction === 'long' ? '向上' : '向下'}共振 (15m:${change15m.toFixed(1)}%${is15mMet ? '✓' : ''}, 1h:${change1h.toFixed(1)}%${is1hMet ? '✓' : ''}, 4h:${change4h.toFixed(1)}%${is4hMet ? '✓' : ''}) [${mtfMetCount}/3满足]`,
            mtfCondition,
            Math.abs(avgChange),
            3
        ));

        // ========== 持仓量条件：> $10M ==========
        const oiCondition = oiValue > 10000000;

        conditions.push(checkCondition(
            'oi-threshold',
            `持仓量 > $10M (当前$${(oiValue / 1000000).toFixed(1)}M)`,
            oiCondition,
            oiValue,
            10000000
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

        // 🔥 必须满足全部3个条件
        if (conditionsMet >= 3) {
            let confidence = 70 + (conditionsMet * 6);

            // 多周期全部满足加成
            if (mtfMetCount === 3) {
                confidence += 8;
            }

            // 趋势极强加成
            if (Math.abs(change15m) > 5 && Math.abs(change1h) > 5 && Math.abs(change4h) > 5) {
                confidence += 5;
            }

            // 强于大盘加成
            if (beta > 1.2) {
                confidence += 5;
            }

            // 大持仓量加成
            if (oiValue > 50000000) {
                confidence += 3;
            }

            // 🔥 最低置信度过滤
            if (confidence < 75) {
                return null;
            }

            const metConditions = conditions.filter(c => c.met).map(c => c.description);
            cooldownManager.record(ticker.symbol, 'trend-confirmation');

            // 🔥 计算风险管理参数
            let riskManagement;
            try {
                const { calculateRiskManagement } = require('@/lib/risk/riskCalculator');
                riskManagement = calculateRiskManagement('trend-confirmation', {
                    entryPrice: parseFloat(ticker.lastPrice),
                    direction,
                    confidence: Math.min(92, confidence),
                    atr: ticker.atr,
                    keltnerMid: ticker.keltnerMid,
                    keltnerUpper: ticker.keltnerUpper,
                    keltnerLower: ticker.keltnerLower,
                    fundingRateTrend: 'stable',
                    betaToBTC: beta,
                    accountBalance: 10000,
                    riskPercentage: 1
                });
            } catch (error) {
                logger.error('Risk calculation failed for trend-confirmation', error as Error, { symbol: ticker.symbol });
            }

            return {
                symbol: ticker.symbol,
                strategyId: 'trend-confirmation',
                strategyName: '🎯 趋势确认',
                direction,
                confidence: Math.min(92, confidence),
                reason: `${conditionsMet}/3 条件满足：${metConditions.join(' | ')}`,
                metrics: {
                    change15m,
                    change1h,
                    change4h,
                    avgChange,
                    mtfMetCount,
                    beta,
                    correlation,
                    oiValue,
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
        const cvd = ticker.cvd || 0;
        const cvdSlope = ticker.cvdSlope || 0;

        // 价格上涨 + CVD 斜率向上 = 主动买盘（高质量）
        const isActiveBuying = change1h > 0 && cvdSlope > 0;

        const volumeCondition = volume > 30000000;
        const qualityCondition = volumeCondition && (cvdSlope >= 0 || cvd === 0);

        conditions.push(checkCondition(
            'high-volume-quality',
            `成交量>$30M (当前${(volume / 1000000).toFixed(1)}M) ${isActiveBuying ? '✓主动买盘' : (cvdSlope < 0 ? '⚠️被动推升' : '')}`,
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
                const { calculateRiskManagement } = require('@/lib/risk/riskCalculator');
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
                    accountBalance: 10000,
                    riskPercentage: 1
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
                    cvd,
                    cvdSlope,
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
