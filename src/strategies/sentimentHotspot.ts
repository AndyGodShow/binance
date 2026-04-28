import type { TradingStrategy, StrategyDetectionContext, StrategySignal, CompositeCondition } from '../lib/strategyTypes.ts';
import type { TickerData } from '../lib/types.ts';
import {
    classifySentimentHotspotCandidate,
} from '../lib/sentimentHotspot.ts';
import { getStrategyRuntimeState } from '../lib/strategyRuntimeState.ts';
import { getStrategyParameterConfig } from '../lib/strategyParameters.ts';
import { toSentimentHotspotStrategyInput } from '../lib/strategyInputs.ts';

function checkCondition(name: string, description: string, met: boolean): CompositeCondition {
    return { name, description, met };
}

function toNumber(value: unknown, fallback = 0): number {
    const numeric = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(numeric) ? numeric : fallback;
}

function describeEntryHint(entryHint: string | undefined): string {
    switch (entryHint) {
        case 'breakout-ready':
            return '入场提示: 已突破近1h高点';
        case 'pullback-watch':
            return '入场提示: 等回踩不破或再次突破';
        case 'avoid-chase':
            return '入场提示: 15m单根过热，不追';
        default:
            return '入场提示: 等待结构确认';
    }
}

export const sentimentHotspotStrategy: TradingStrategy = {
    id: 'sentiment-hotspot',
    name: '情绪热点',
    description: '多重热度 + 放量/广场确认 + OI持续放大 + 明显负费率 + 温和上涨',
    category: 'special',
    enabled: true,

    detect: (ticker: TickerData, context?: StrategyDetectionContext): StrategySignal | null => {
        const input = toSentimentHotspotStrategyInput(ticker);
        const params = getStrategyParameterConfig('sentiment-hotspot', context?.parameterOverrides?.['sentiment-hotspot']);
        const hotspot = input.strategyContexts?.sentimentHotspot;
        if (!hotspot) {
            return null;
        }

        const runtimeState = getStrategyRuntimeState(context);
        if (runtimeState.cooldown.check(input.symbol, 'sentiment-hotspot', params.cooldownMs)) {
            return null;
        }

        const volume24h = toNumber(input.quoteVolume);
        const priceChange24h = toNumber(input.priceChangePercent);
        const classification = classifySentimentHotspotCandidate({
            heatSourceCount: hotspot.heatSourceCount,
            hasSquare: hotspot.hasSquare,
            hasCoinGecko: hotspot.hasCoinGecko,
            hasVolSurge: hotspot.hasVolSurge,
            volume24h,
            oiUsd: hotspot.oiUsd,
            oiRising: hotspot.oiRising,
            oiChangePct: hotspot.oiChangePct,
            fundingRatePct: hotspot.fundingRatePct,
            priceChange24h,
        }, params);

        if (classification.type !== 'A_PLUS_LONG' && classification.type !== 'CORE_LONG') {
            return null;
        }

        const isAPlus = classification.type === 'A_PLUS_LONG';
        const entry = hotspot.entry;
        const conditions = [
            checkCondition(
                'multi-heat',
                `热度来源${hotspot.heatSourceCount}个${hotspot.hasVolSurge ? `，放量${hotspot.volumeSurgeRatio.toFixed(1)}x` : ''}`,
                hotspot.heatSourceCount >= params.minHeatSourceCount
            ),
            checkCondition(
                'quality-heat',
                `热度质量: ${hotspot.hasSquare ? '广场' : ''}${hotspot.hasSquare && hotspot.hasVolSurge ? '+' : ''}${hotspot.hasVolSurge ? '放量' : ''}`,
                hotspot.hasSquare || hotspot.hasVolSurge
            ),
            checkCondition(
                'liquidity',
                `24h成交额${(volume24h / 1_000_000).toFixed(1)}M，OI${(hotspot.oiUsd / 1_000_000).toFixed(1)}M`,
                volume24h >= params.minVolume24h &&
                hotspot.oiUsd >= params.minOiUsd
            ),
            checkCondition(
                'oi-rising',
                `OI 16h四段递增，涨幅${hotspot.oiChangePct.toFixed(1)}%`,
                hotspot.oiRising && hotspot.oiChangePct >= params.minOiChangePct
            ),
            checkCondition(
                'negative-funding',
                `资金费率${hotspot.fundingRatePct.toFixed(3)}%`,
                hotspot.fundingRatePct <= params.maxFundingRatePct
            ),
            checkCondition(
                'controlled-price',
                `24h涨幅${priceChange24h.toFixed(1)}%`,
                priceChange24h >= params.minPriceChange24h &&
                priceChange24h <= params.maxCorePriceChange24h
            ),
        ];
        const entryDescription = describeEntryHint(entry?.entryHint);

        const conditionsMet = conditions.filter((condition) => condition.met).length;
        runtimeState.cooldown.record(input.symbol, 'sentiment-hotspot');

        const confidence = isAPlus ? 94 : 88;

        return {
            symbol: input.symbol,
            strategyId: 'sentiment-hotspot',
            strategyName: '情绪热点',
            direction: 'long',
            confidence,
            reason: `${classification.reason}：信号只负责选币，${entryDescription}。${conditions.map((condition) => condition.description).join(' | ')}`,
            metrics: {
                heatSourceCount: hotspot.heatSourceCount,
                volume24h,
                volumeSurgeRatio: hotspot.volumeSurgeRatio,
                oiUsd: hotspot.oiUsd,
                oiChangePct: hotspot.oiChangePct,
                fundingRatePct: hotspot.fundingRatePct,
                priceChange24h,
                hasSquare: Number(hotspot.hasSquare),
                hasCoinGecko: Number(hotspot.hasCoinGecko),
                hasVolSurge: Number(hotspot.hasVolSurge),
                signalTier: isAPlus ? 2 : 1,
                fundingTurnedNegative: Number(Boolean(hotspot.fundingTurnedNegative)),
                prevFundingRatePct: hotspot.prevFundingRatePct ?? 0,
                oneHourHigh: entry?.oneHourHigh ?? 0,
                launchZoneLow: entry?.launchZoneLow ?? 0,
                last15mChangePct: entry?.last15mChangePct ?? 0,
                breakoutConfirmed: Number(Boolean(entry?.breakoutConfirmed)),
                avoidChase: Number(Boolean(entry?.avoidChase)),
            },
            timestamp: context?.now ?? Date.now(),
            isComposite: true,
            conditions,
            conditionsMet,
            totalConditions: conditions.length,
            grade: isAPlus ? 'A' : 'B',
            executionMode: 'trade',
        };
    },
};
