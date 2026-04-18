import type { TradingStrategy, StrategySignal, CompositeCondition } from '../lib/strategyTypes.ts';
import type { TickerData } from '../lib/types.ts';
import { cooldownManager } from '../lib/cooldownManager.ts';
import { logger } from '../lib/logger.ts';
import { APP_CONFIG } from '../lib/config.ts';
import { calculateRiskManagement } from '../lib/risk/riskCalculator.ts';
import { getStrategyParameterConfig, type WeiShenLedgerParameters } from '../lib/strategyParameters.ts';

type Direction = 'long' | 'short';

interface DirectionEvaluation {
    direction: Direction;
    score: number;
    conditions: CompositeCondition[];
    coreReady: boolean;
    ledgerTimeBonus: number;
}

const REGIME_WEIGHTS = {
    momentum: 24,
    structure: 18,
    oi: 14,
    funding: 10,
    liquidity: 10,
    volatility: 10,
    priceLocation: 8,
    orderFlow: 4,
    volumeProfile: 4,
    liquidationMagnet: 3,
    ledgerTime: 4,
} as const;

const MIN_REGIME_SCORE = 72;
const MIN_DIRECTION_SCORE_GAP = 6;

function checkCondition(
    name: string,
    description: string,
    met: boolean,
    value?: number,
    threshold?: number
): CompositeCondition {
    return { name, description, met, value, threshold };
}

function parseNumber(value: string | number | undefined, fallback = 0): number {
    if (typeof value === 'number') {
        return Number.isFinite(value) ? value : fallback;
    }

    if (typeof value === 'string') {
        const parsed = Number.parseFloat(value);
        return Number.isFinite(parsed) ? parsed : fallback;
    }

    return fallback;
}

function resolveUtcHour(ticker: TickerData): number {
    const timestamp = Number.isFinite(ticker.closeTime) && ticker.closeTime > 0
        ? ticker.closeTime
        : Date.now();

    return new Date(timestamp).getUTCHours();
}

function hasBearishStructure(ticker: TickerData): boolean {
    const emaDistance = ticker.ema5mDistancePercent;
    const emaBearish = typeof emaDistance === 'number' && Number.isFinite(emaDistance) && emaDistance <= 0;
    const trendBearish = ticker.gmmaTrend === 'bearish' || ticker.multiEmaTrend === 'bearish';
    const diBearish =
        typeof ticker.minusDI === 'number' &&
        typeof ticker.plusDI === 'number' &&
        ticker.minusDI > ticker.plusDI;

    return emaBearish || trendBearish || diBearish;
}

function hasBullishStructure(ticker: TickerData): boolean {
    const emaDistance = ticker.ema5mDistancePercent;
    const emaBullish = typeof emaDistance === 'number' && Number.isFinite(emaDistance) && emaDistance >= 0;
    const trendBullish = ticker.gmmaTrend === 'bullish' || ticker.multiEmaTrend === 'bullish';
    const diBullish =
        typeof ticker.plusDI === 'number' &&
        typeof ticker.minusDI === 'number' &&
        ticker.plusDI > ticker.minusDI;

    return emaBullish || trendBullish || diBullish;
}

function isLedgerFavoredHour(params: WeiShenLedgerParameters, direction: Direction, utcHour: number): boolean {
    return direction === 'short'
        ? params.shortEntryHoursUtc.includes(utcHour)
        : params.longEntryHoursUtc.includes(utcHour);
}

function buildDirectionEvaluation(
    ticker: TickerData,
    params: WeiShenLedgerParameters,
    direction: Direction,
    context: {
        utcHour: number;
        currentPrice: number;
        quoteVolume: number;
        volumeRatio: number;
        fundingRate: number;
        change15m: number;
        change1h: number;
        change4h: number;
        oiChangePercent: number;
        bandwidthPercentile?: number;
        atr?: number;
        adx: number;
    }
): DirectionEvaluation {
    const conditions: CompositeCondition[] = [];
    let score = 0;

    const ledgerHour = isLedgerFavoredHour(params, direction, context.utcHour);
    const ledgerTimeBonus = ledgerHour ? REGIME_WEIGHTS.ledgerTime : 0;
    score += ledgerTimeBonus;
    conditions.push(checkCondition(
        'ledger-time-bonus',
        ledgerHour
            ? `账本${direction === 'short' ? '空头' : '多头'}时间弱加分 (${context.utcHour}:00)`
            : `非账本${direction === 'short' ? '空头' : '多头'}优势时间，不硬过滤`,
        ledgerHour,
        context.utcHour
    ));

    const momentum = direction === 'short'
        ? (
            context.change1h <= params.shortMomentum.maxChange1h &&
            context.change4h <= params.shortMomentum.maxChange4h &&
            context.change15m <= params.shortMomentum.maxChange15m
        )
        : (
            context.change1h >= params.longMomentum.minChange1h &&
            context.change4h >= params.longMomentum.minChange4h &&
            context.change15m >= params.longMomentum.minChange15m
        );
    if (momentum) score += REGIME_WEIGHTS.momentum;
    conditions.push(checkCondition(
        'directional-momentum',
        `${direction === 'long' ? '多头' : '空头'}动量 15m:${context.change15m.toFixed(2)}%, 1h:${context.change1h.toFixed(2)}%, 4h:${context.change4h.toFixed(2)}%`,
        momentum,
        context.change1h,
        direction === 'long' ? params.longMomentum.minChange1h : params.shortMomentum.maxChange1h
    ));

    const directionalStructure = direction === 'long'
        ? hasBullishStructure(ticker)
        : hasBearishStructure(ticker);
    const structure = directionalStructure || (momentum && context.adx >= params.minAdx);
    if (structure) score += REGIME_WEIGHTS.structure;
    conditions.push(checkCondition(
        'directional-structure',
        `结构确认 GMMA:${ticker.gmmaTrend ?? 'NA'}, EMA偏离:${typeof ticker.ema5mDistancePercent === 'number' ? ticker.ema5mDistancePercent.toFixed(2) : 'NA'}%, ADX:${context.adx.toFixed(1)}`,
        structure,
        context.adx,
        params.minAdx
    ));

    const oiExpansion = context.oiChangePercent >= params.minOiExpansion;
    if (oiExpansion) score += REGIME_WEIGHTS.oi;
    conditions.push(checkCondition(
        'oi-expansion',
        `持仓扩张 ${context.oiChangePercent.toFixed(2)}%`,
        oiExpansion,
        context.oiChangePercent,
        params.minOiExpansion
    ));

    const funding = direction === 'long'
        ? context.fundingRate <= params.maxLongFundingRate
        : context.fundingRate >= params.minFundingRate;
    if (funding) score += REGIME_WEIGHTS.funding;
    conditions.push(checkCondition(
        'funding-sanity',
        `资金费率 ${context.fundingRate.toFixed(5)}，避免拥挤逆风`,
        funding,
        context.fundingRate,
        direction === 'long' ? params.maxLongFundingRate : params.minFundingRate
    ));

    const liquidity = context.quoteVolume >= params.minQuoteVolume || context.volumeRatio >= params.minVolumeRatio;
    if (liquidity) score += REGIME_WEIGHTS.liquidity;
    conditions.push(checkCondition(
        'liquidity',
        `成交额 $${(context.quoteVolume / 1_000_000).toFixed(1)}M / 量比 ${context.volumeRatio.toFixed(2)}x`,
        liquidity,
        context.quoteVolume,
        params.minQuoteVolume
    ));

    const volatility =
        (typeof context.bandwidthPercentile !== 'number' || context.bandwidthPercentile <= params.maxBandwidthPercentile) &&
        (typeof context.atr !== 'number' || context.atr <= params.maxAtrPercent);
    if (volatility) score += REGIME_WEIGHTS.volatility;
    conditions.push(checkCondition(
        'volatility-cap',
        `波动过滤 BW:${typeof context.bandwidthPercentile === 'number' ? context.bandwidthPercentile.toFixed(1) : 'NA'}, ATR:${typeof context.atr === 'number' ? context.atr.toFixed(2) : 'NA'}%`,
        volatility,
        typeof context.bandwidthPercentile === 'number' ? context.bandwidthPercentile : undefined,
        params.maxBandwidthPercentile
    ));

    const priceLocation = direction === 'long'
        ? (
            typeof ticker.bollingerUpper !== 'number' ||
            context.currentPrice < ticker.bollingerUpper * (1 - params.minDistanceBelowBollingerUpperPercent / 100)
        )
        : (
            typeof ticker.bollingerLower !== 'number' ||
            context.currentPrice > ticker.bollingerLower * (1 + params.minDistanceAboveBollingerLowerPercent / 100)
        );
    if (priceLocation) score += REGIME_WEIGHTS.priceLocation;
    conditions.push(checkCondition(
        'not-late-entry',
        direction === 'long'
            ? (
                typeof ticker.bollingerUpper === 'number'
                    ? `不追多至布林上轨上方 (上轨 ${ticker.bollingerUpper.toFixed(4)})`
                    : '不追多过滤（缺少布林带，下放行）'
            )
            : (
                typeof ticker.bollingerLower === 'number'
                    ? `不追空至布林下轨下方 (下轨 ${ticker.bollingerLower.toFixed(4)})`
                    : '不追空过滤（缺少布林带，下放行）'
            ),
        priceLocation,
        context.currentPrice,
        direction === 'long' ? ticker.bollingerUpper : ticker.bollingerLower
    ));

    const hasCvd = typeof ticker.cvdSlope === 'number' && Number.isFinite(ticker.cvdSlope);
    const orderFlow = hasCvd && (direction === 'long' ? ticker.cvdSlope! > 0 : ticker.cvdSlope! < 0);
    if (orderFlow) score += REGIME_WEIGHTS.orderFlow;
    conditions.push(checkCondition(
        'cvd-orderflow',
        hasCvd ? `CVD 主动成交斜率 ${ticker.cvdSlope!.toFixed(2)}` : '缺少 CVD，订单流不加分',
        orderFlow,
        hasCvd ? ticker.cvdSlope : undefined,
        0
    ));

    const hasPoc = typeof ticker.poc === 'number' && ticker.poc > 0;
    const volumeProfile = hasPoc && (direction === 'long' ? context.currentPrice >= ticker.poc! : context.currentPrice <= ticker.poc!);
    if (volumeProfile) score += REGIME_WEIGHTS.volumeProfile;
    conditions.push(checkCondition(
        'volume-profile',
        hasPoc ? `价格相对 POC ${ticker.poc!.toFixed(4)}` : '缺少成交密集区，VP 不加分',
        volumeProfile,
        hasPoc ? context.currentPrice - ticker.poc! : undefined,
        0
    ));

    const heatmap = ticker.liquidationHeatmap;
    const hasHeatmap = Boolean(heatmap);
    const liquidationMagnet = Boolean(heatmap) && (
        direction === 'long'
            ? heatmap!.shortLiquidations > heatmap!.longLiquidations
            : heatmap!.longLiquidations > heatmap!.shortLiquidations
    );
    if (liquidationMagnet) score += REGIME_WEIGHTS.liquidationMagnet;
    conditions.push(checkCondition(
        'liquidation-magnet',
        hasHeatmap
            ? `清算磁吸 多:${heatmap!.longLiquidations.toFixed(0)} 空:${heatmap!.shortLiquidations.toFixed(0)}`
            : '缺少清算热力，不加分',
        liquidationMagnet
    ));

    return {
        direction,
        score,
        conditions,
        ledgerTimeBonus,
        coreReady: momentum && funding && liquidity && volatility && priceLocation,
    };
}

export const weiShenStrategy: TradingStrategy = {
    id: 'wei-shen-ledger',
    name: '魏神策略',
    description: '账本反推：多维市场状态评分 + 小仓位长尾风控',
    category: 'special',
    enabled: true,

    detect: (ticker: TickerData): StrategySignal | null => {
        const params = getStrategyParameterConfig('wei-shen-ledger');
        if (cooldownManager.check(ticker.symbol, 'wei-shen-ledger', params.cooldownPeriodMs)) {
            return null;
        }

        const currentPrice = parseNumber(ticker.lastPrice);
        if (currentPrice <= 0) {
            return null;
        }

        const utcHour = resolveUtcHour(ticker);
        const quoteVolume = parseNumber(ticker.quoteVolume);
        const volumeRatio = ticker.volumeRatio ?? (
            ticker.volumeMA && ticker.volumeMA > 0
                ? parseNumber(ticker.quoteVolume) / ticker.volumeMA
                : 1
        );
        const fundingRate = parseNumber(ticker.fundingRate, 0);
        const change15m = ticker.change15m ?? 0;
        const change1h = ticker.change1h ?? 0;
        const change4h = ticker.change4h ?? 0;
        const change24h = parseNumber(ticker.priceChangePercent);
        const oiChangePercent = ticker.oiChangePercent ?? 0;
        const bandwidthPercentile = ticker.bandwidthPercentile;
        const atr = ticker.atr;
        const adx = ticker.adx ?? 0;
        const evaluationContext = {
            utcHour,
            currentPrice,
            quoteVolume,
            volumeRatio,
            fundingRate,
            change15m,
            change1h,
            change4h,
            oiChangePercent,
            bandwidthPercentile,
            atr,
            adx,
        };
        const longEvaluation = buildDirectionEvaluation(ticker, params, 'long', evaluationContext);
        const shortEvaluation = buildDirectionEvaluation(ticker, params, 'short', evaluationContext);
        const selected = longEvaluation.score >= shortEvaluation.score ? longEvaluation : shortEvaluation;
        const runnerUp = selected.direction === 'long' ? shortEvaluation : longEvaluation;

        if (
            !selected.coreReady ||
            selected.score < MIN_REGIME_SCORE ||
            selected.score - runnerUp.score < MIN_DIRECTION_SCORE_GAP
        ) {
            return null;
        }

        const conditions = selected.conditions;
        const direction = selected.direction;
        const conditionsMet = conditions.filter(condition => condition.met).length;
        let confidence = params.confidence.base + Math.max(0, selected.score - MIN_REGIME_SCORE) * 0.35;
        confidence += direction === 'short' && fundingRate > 0 ? params.confidence.positiveFundingBonus : 0;
        confidence += direction === 'long' && fundingRate < 0 ? params.confidence.favorableFundingBonus : 0;
        confidence += volumeRatio >= params.confidence.strongVolumeRatio ? params.confidence.strongVolumeBonus : 0;
        confidence += direction === 'short' && change24h <= params.confidence.dailyWeaknessThreshold ? params.confidence.dailyWeaknessBonus : 0;
        confidence += direction === 'long' && change24h >= params.confidence.dailyStrengthThreshold ? params.confidence.dailyStrengthBonus : 0;
        confidence = Math.min(params.confidence.maxConfidence, confidence);

        if (confidence < params.confidence.minConfidence) {
            return null;
        }

        let riskManagement;
        try {
            riskManagement = calculateRiskManagement('wei-shen-ledger', {
                entryPrice: currentPrice,
                direction,
                confidence,
                atr,
                keltnerMid: ticker.keltnerMid,
                keltnerUpper: ticker.keltnerUpper,
                keltnerLower: ticker.keltnerLower,
                bollingerLower: ticker.bollingerLower,
                bollingerUpper: ticker.bollingerUpper,
                bandwidthPercentile,
                adx,
                oiChangePercent,
                accountBalance: APP_CONFIG.RISK.DEFAULT_ACCOUNT_BALANCE,
                riskPercentage: params.riskPercentage,
            });
        } catch (error) {
            logger.error('Risk calculation failed for wei-shen-ledger', error as Error, { symbol: ticker.symbol });
        }

        cooldownManager.record(ticker.symbol, 'wei-shen-ledger');
        const metConditions = conditions.filter(condition => condition.met).map(condition => condition.description);

        return {
            symbol: ticker.symbol,
            strategyId: 'wei-shen-ledger',
            strategyName: '魏神策略',
            direction,
            confidence,
            reason: `${conditionsMet}/${conditions.length} 条件满足：${metConditions.join(' | ')}`,
            metrics: {
                utcHour,
                change15m,
                change1h,
                change4h,
                change24h,
                oiChangePercent,
                fundingRate,
                quoteVolume,
                volumeRatio,
                bandwidthPercentile: bandwidthPercentile ?? 0,
                atr: atr ?? 0,
                adx,
                conditionsMet,
                regimeScore: selected.score,
                oppositeRegimeScore: runnerUp.score,
                ledgerTimeBonus: selected.ledgerTimeBonus,
            },
            timestamp: Date.now(),
            isComposite: true,
            conditions,
            conditionsMet,
            totalConditions: conditions.length,
            risk: riskManagement,
        };
    },
};
