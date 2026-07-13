import type { TickerData } from './types.ts';
import type { StrategyId } from './strategyParameters.ts';
import { isWeiShenUniverseSymbol } from './weiShenUniverse.ts';

function pickTickerFields<const K extends readonly (keyof TickerData)[]>(
    ticker: TickerData,
    fields: K,
): Pick<TickerData, K[number]> {
    const selected: Record<string, unknown> = {};

    fields.forEach((field) => {
        selected[field] = ticker[field];
    });

    return selected as Pick<TickerData, K[number]>;
}

const STRONG_BREAKOUT_INPUT_FIELDS = [
    'symbol',
    'lastPrice',
    'priceChangePercent',
    'breakout21dHigh',
    'breakout21dPercent',
    'ema5m20',
    'ema5m60',
    'ema5m100',
    'ema5mDistancePercent',
    'change15m',
    'change1h',
    'change4h',
    'quoteVolume',
    'oiChangePercent',
    'atr',
    'keltnerLower',
    'keltnerUpper',
    'volumeChangePercent',
] as const;

const TREND_CONFIRMATION_INPUT_FIELDS = [
    'symbol',
    'lastPrice',
    'change15m',
    'change1h',
    'change4h',
    'openInterestValue',
    'quoteVolume',
    'oiChangePercent',
    'ema5mDistancePercent',
    'gmmaTrend',
    'multiEmaTrend',
    'multiEmaAlignmentScore',
    'betaToBTC',
    'correlationToBTC',
    'atr',
    'keltnerMid',
    'keltnerUpper',
    'keltnerLower',
    'bandwidthPercentile',
] as const;

const CAPITAL_INFLOW_INPUT_FIELDS = [
    'symbol',
    'lastPrice',
    'priceChangePercent',
    'quoteVolume',
    'change15m',
    'change1h',
    'change4h',
    'volumeMA',
    'cvd',
    'cvdSlope',
    'atr',
    'vah',
    'val',
    'poc',
] as const;

const RSRS_INPUT_FIELDS = [
    'symbol',
    'lastPrice',
    'volume',
    'change15m',
    'change1h',
    'change4h',
    'volumeMA',
    'rsrs',
    'rsrsFinal',
    'rsrsZScore',
    'rsrsR2',
    'rsrsROC',
    'rsrsAcceleration',
    'rsrsDynamicLongThreshold',
    'rsrsDynamicShortThreshold',
    'bollingerUpper',
    'bollingerMid',
    'bollingerLower',
] as const;

const VOLATILITY_SQUEEZE_INPUT_FIELDS = [
    'symbol',
    'lastPrice',
    'quoteVolume',
    'ohlc',
    'squeezeStatus',
    'squeezeDuration',
    'lastSqueezeDuration',
    'squeezeStrength',
    'releaseBarsAgo',
    'squeezeBoxHigh',
    'squeezeBoxLow',
    'keltnerUpper',
    'keltnerMid',
    'keltnerLower',
    'momentumValue',
    'momentumColor',
    'adx',
    'plusDI',
    'minusDI',
    'bandwidthPercentile',
    'volumeMA',
    'volumeRatio',
    'atr',
] as const;

const WEI_SHEN_INPUT_FIELDS = [
    'symbol',
    'lastPrice',
    'closeTime',
    'strategyContexts',
] as const;

const SENTIMENT_HOTSPOT_INPUT_FIELDS = [
    'symbol',
    'lastPrice',
    'priceChangePercent',
    'quoteVolume',
    'fundingRate',
    'strategyContexts',
] as const;

export type StrongBreakoutStrategyInput = Pick<TickerData, (typeof STRONG_BREAKOUT_INPUT_FIELDS)[number]>;
export type TrendConfirmationStrategyInput = Pick<TickerData, (typeof TREND_CONFIRMATION_INPUT_FIELDS)[number]>;
export type CapitalInflowStrategyInput = Pick<TickerData, (typeof CAPITAL_INFLOW_INPUT_FIELDS)[number]>;
export type RsrsStrategyInput = Pick<TickerData, (typeof RSRS_INPUT_FIELDS)[number]>;
export type VolatilitySqueezeStrategyInput = Pick<TickerData, (typeof VOLATILITY_SQUEEZE_INPUT_FIELDS)[number]>;
export type WeiShenStrategyInput = Pick<TickerData, (typeof WEI_SHEN_INPUT_FIELDS)[number]>;
export type SentimentHotspotStrategyInput = Pick<TickerData, (typeof SENTIMENT_HOTSPOT_INPUT_FIELDS)[number]>;

export const STRATEGY_INPUT_CONTRACTS = {
    'strong-breakout': STRONG_BREAKOUT_INPUT_FIELDS,
    'trend-confirmation': TREND_CONFIRMATION_INPUT_FIELDS,
    'capital-inflow': CAPITAL_INFLOW_INPUT_FIELDS,
    'rsrs-trend': RSRS_INPUT_FIELDS,
    'volatility-squeeze': VOLATILITY_SQUEEZE_INPUT_FIELDS,
    'wei-shen-ledger': WEI_SHEN_INPUT_FIELDS,
    'sentiment-hotspot': SENTIMENT_HOTSPOT_INPUT_FIELDS,
} as const;

type StrategyInputPath = keyof TickerData | 'strategyContexts.weiShen' | 'strategyContexts.sentimentHotspot';

interface StrategyInputReadinessEntry {
    symbolsMissingRequiredFields: number;
    missingFieldCounts: Record<string, number>;
    sampleSymbols: string[];
}

export interface StrategyInputReadinessSummary {
    totalSymbols: number;
    byStrategy: Record<StrategyId, StrategyInputReadinessEntry>;
}

const STRATEGY_REQUIRED_INPUT_FIELDS: Record<StrategyId, readonly StrategyInputPath[]> = {
    'strong-breakout': [
        'breakout21dHigh',
        'breakout21dPercent',
        'ema5m20',
        'ema5m60',
        'ema5m100',
        'change15m',
        'change1h',
        'change4h',
        'quoteVolume',
        'oiChangePercent',
    ],
    'trend-confirmation': [
        'change15m',
        'change1h',
        'change4h',
        'openInterestValue',
        'quoteVolume',
        'oiChangePercent',
        'ema5mDistancePercent',
        'gmmaTrend',
        'multiEmaTrend',
        'multiEmaAlignmentScore',
    ],
    'capital-inflow': [
        'change15m',
        'change1h',
        'change4h',
        'volumeMA',
        'cvd',
        'cvdSlope',
        'vah',
        'val',
        'poc',
    ],
    'rsrs-trend': [
        'volumeMA',
        'rsrs',
        'rsrsFinal',
        'rsrsZScore',
        'rsrsR2',
        'rsrsDynamicLongThreshold',
        'rsrsDynamicShortThreshold',
        'bollingerUpper',
        'bollingerMid',
        'bollingerLower',
    ],
    'volatility-squeeze': [
        'ohlc',
        'squeezeStatus',
        'lastSqueezeDuration',
        'releaseBarsAgo',
        'keltnerMid',
        'momentumValue',
        'momentumColor',
        'adx',
        'plusDI',
        'minusDI',
        'bandwidthPercentile',
        'volumeRatio',
    ],
    'wei-shen-ledger': [
        'strategyContexts.weiShen',
    ],
    'sentiment-hotspot': [
        'fundingRate',
        'strategyContexts.sentimentHotspot',
    ],
};

const ALL_STRATEGY_IDS = Object.keys(STRATEGY_REQUIRED_INPUT_FIELDS) as StrategyId[];

function getTickerPathValue(ticker: TickerData, path: StrategyInputPath): unknown {
    if (path === 'strategyContexts.weiShen') {
        return ticker.strategyContexts?.weiShen;
    }

    if (path === 'strategyContexts.sentimentHotspot') {
        return ticker.strategyContexts?.sentimentHotspot;
    }

    return ticker[path];
}

function isMissingStrategyInputValue(value: unknown): boolean {
    if (value === undefined || value === null) {
        return true;
    }

    if (typeof value === 'number') {
        return !Number.isFinite(value);
    }

    if (Array.isArray(value)) {
        return value.length === 0;
    }

    return false;
}

function isStrategyReadinessApplicable(ticker: TickerData, strategyId: StrategyId): boolean {
    if (strategyId === 'strong-breakout') {
        return ticker.breakout21dHigh !== undefined || ticker.breakout21dPercent !== undefined;
    }

    if (strategyId === 'wei-shen-ledger') {
        return isWeiShenUniverseSymbol(ticker.symbol);
    }

    if (strategyId === 'sentiment-hotspot') {
        return Boolean(ticker.strategyContexts?.sentimentHotspot);
    }

    return true;
}

export function buildStrategyInputReadinessSummary(
    tickers: TickerData[],
    strategyIds: readonly StrategyId[],
): StrategyInputReadinessSummary {
    const byStrategy = ALL_STRATEGY_IDS.reduce((acc, strategyId) => {
        acc[strategyId] = {
            symbolsMissingRequiredFields: 0,
            missingFieldCounts: {},
            sampleSymbols: [],
        };
        return acc;
    }, {} as Record<StrategyId, StrategyInputReadinessEntry>);

    strategyIds.forEach((strategyId) => {
        const requiredFields = STRATEGY_REQUIRED_INPUT_FIELDS[strategyId];
        const entry = byStrategy[strategyId];

        tickers.forEach((ticker) => {
            if (!isStrategyReadinessApplicable(ticker, strategyId)) {
                return;
            }

            const missingFields = requiredFields.filter((field) =>
                isMissingStrategyInputValue(getTickerPathValue(ticker, field))
            );

            if (missingFields.length === 0) {
                return;
            }

            entry.symbolsMissingRequiredFields += 1;
            if (entry.sampleSymbols.length < 5) {
                entry.sampleSymbols.push(ticker.symbol);
            }

            missingFields.forEach((field) => {
                const key = String(field);
                entry.missingFieldCounts[key] = (entry.missingFieldCounts[key] || 0) + 1;
            });
        });
    });

    return {
        totalSymbols: tickers.length,
        byStrategy,
    };
}

export function toStrongBreakoutStrategyInput(ticker: TickerData): StrongBreakoutStrategyInput {
    return pickTickerFields(ticker, STRONG_BREAKOUT_INPUT_FIELDS);
}

export function toTrendConfirmationStrategyInput(ticker: TickerData): TrendConfirmationStrategyInput {
    return pickTickerFields(ticker, TREND_CONFIRMATION_INPUT_FIELDS);
}

export function toCapitalInflowStrategyInput(ticker: TickerData): CapitalInflowStrategyInput {
    return pickTickerFields(ticker, CAPITAL_INFLOW_INPUT_FIELDS);
}

export function toRsrsStrategyInput(ticker: TickerData): RsrsStrategyInput {
    return pickTickerFields(ticker, RSRS_INPUT_FIELDS);
}

export function toVolatilitySqueezeStrategyInput(ticker: TickerData): VolatilitySqueezeStrategyInput {
    return pickTickerFields(ticker, VOLATILITY_SQUEEZE_INPUT_FIELDS);
}

export function toWeiShenStrategyInput(ticker: TickerData): WeiShenStrategyInput {
    return pickTickerFields(ticker, WEI_SHEN_INPUT_FIELDS);
}

export function toSentimentHotspotStrategyInput(ticker: TickerData): SentimentHotspotStrategyInput {
    return pickTickerFields(ticker, SENTIMENT_HOTSPOT_INPUT_FIELDS);
}
