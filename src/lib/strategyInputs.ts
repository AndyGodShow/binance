import type { TickerData } from './types.ts';

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

export const STRONG_BREAKOUT_INPUT_FIELDS = [
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

export const TREND_CONFIRMATION_INPUT_FIELDS = [
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

export const CAPITAL_INFLOW_INPUT_FIELDS = [
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

export const RSRS_INPUT_FIELDS = [
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

export const VOLATILITY_SQUEEZE_INPUT_FIELDS = [
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

export const WEI_SHEN_INPUT_FIELDS = [
    'symbol',
    'lastPrice',
    'closeTime',
    'strategyContexts',
] as const;

export type StrongBreakoutStrategyInput = Pick<TickerData, (typeof STRONG_BREAKOUT_INPUT_FIELDS)[number]>;
export type TrendConfirmationStrategyInput = Pick<TickerData, (typeof TREND_CONFIRMATION_INPUT_FIELDS)[number]>;
export type CapitalInflowStrategyInput = Pick<TickerData, (typeof CAPITAL_INFLOW_INPUT_FIELDS)[number]>;
export type RsrsStrategyInput = Pick<TickerData, (typeof RSRS_INPUT_FIELDS)[number]>;
export type VolatilitySqueezeStrategyInput = Pick<TickerData, (typeof VOLATILITY_SQUEEZE_INPUT_FIELDS)[number]>;
export type WeiShenStrategyInput = Pick<TickerData, (typeof WEI_SHEN_INPUT_FIELDS)[number]>;

export const STRATEGY_INPUT_CONTRACTS = {
    'strong-breakout': STRONG_BREAKOUT_INPUT_FIELDS,
    'trend-confirmation': TREND_CONFIRMATION_INPUT_FIELDS,
    'capital-inflow': CAPITAL_INFLOW_INPUT_FIELDS,
    'rsrs-trend': RSRS_INPUT_FIELDS,
    'volatility-squeeze': VOLATILITY_SQUEEZE_INPUT_FIELDS,
    'wei-shen-ledger': WEI_SHEN_INPUT_FIELDS,
} as const;

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
