import type { TickerData } from './types.ts';

export interface TrendStructureInput {
    currentPrice: number;
    ema20?: number | null;
    ema60?: number | null;
    ema100?: number | null;
    gmmaShortValues?: Array<number | null>;
    gmmaLongValues?: Array<number | null>;
    multiEmaValues?: Array<number | null>;
}

export type TrendStructureFields = Pick<
    TickerData,
    | 'ema5m20'
    | 'ema5m60'
    | 'ema5m100'
    | 'ema5mDistancePercent'
    | 'gmmaTrend'
    | 'gmmaShortScore'
    | 'gmmaLongScore'
    | 'gmmaSeparationPercent'
    | 'multiEmaTrend'
    | 'multiEmaAlignmentScore'
>;

export function calculatePercentageChange(current: number, baseline: number): number {
    if (!Number.isFinite(current) || !Number.isFinite(baseline) || baseline <= 0) {
        return 0;
    }

    return ((current - baseline) / baseline) * 100;
}

export function calculateBreakoutMetrics(
    currentPrice: number,
    breakoutHigh: number,
): Pick<TickerData, 'breakout21dHigh' | 'breakout21dPercent'> | null {
    if (!Number.isFinite(currentPrice) || !Number.isFinite(breakoutHigh) || breakoutHigh <= 0) {
        return null;
    }

    return {
        breakout21dHigh: breakoutHigh,
        breakout21dPercent: calculatePercentageChange(currentPrice, breakoutHigh),
    };
}

export function determineOrderedTrend(values: Array<number | null>): 'bullish' | 'bearish' | 'mixed' {
    if (values.length < 2 || values.some((value) => value === null)) {
        return 'mixed';
    }

    const definedValues = values as number[];
    const bullish = definedValues.every((value, index) => index === 0 || definedValues[index - 1] > value);
    if (bullish) {
        return 'bullish';
    }

    const bearish = definedValues.every((value, index) => index === 0 || definedValues[index - 1] < value);
    if (bearish) {
        return 'bearish';
    }

    return 'mixed';
}

export function calculateDirectionalAlignmentScore(values: Array<number | null>, direction: 'bullish' | 'bearish'): number {
    if (values.length < 2 || values.some((value) => value === null)) {
        return 0;
    }

    const definedValues = values as number[];
    let score = 0;
    for (let index = 1; index < definedValues.length; index++) {
        const prev = definedValues[index - 1];
        const current = definedValues[index];
        const aligned = direction === 'bullish' ? prev > current : prev < current;
        if (aligned) {
            score += 1;
        }
    }

    return score;
}

export function deriveTrendStructure(input: TrendStructureInput): Partial<TrendStructureFields> {
    const result: Partial<TrendStructureFields> = {};

    if (typeof input.ema20 === 'number' && Number.isFinite(input.ema20)) {
        result.ema5m20 = input.ema20;
        result.ema5mDistancePercent = input.ema20 > 0
            ? calculatePercentageChange(input.currentPrice, input.ema20)
            : undefined;
    }

    if (typeof input.ema60 === 'number' && Number.isFinite(input.ema60)) {
        result.ema5m60 = input.ema60;
    }

    if (typeof input.ema100 === 'number' && Number.isFinite(input.ema100)) {
        result.ema5m100 = input.ema100;
    }

    const gmmaShortValues = input.gmmaShortValues ?? [];
    const gmmaLongValues = input.gmmaLongValues ?? [];
    const gmmaShortTrend = determineOrderedTrend(gmmaShortValues);
    const gmmaLongTrend = determineOrderedTrend(gmmaLongValues);

    if (
        gmmaShortValues.length > 0 &&
        gmmaLongValues.length > 0 &&
        !gmmaShortValues.some((value) => value === null) &&
        !gmmaLongValues.some((value) => value === null)
    ) {
        const shortDefined = gmmaShortValues as number[];
        const longDefined = gmmaLongValues as number[];
        const shortAvg = shortDefined.reduce((sum, value) => sum + value, 0) / shortDefined.length;
        const longAvg = longDefined.reduce((sum, value) => sum + value, 0) / longDefined.length;

        result.gmmaShortScore = gmmaShortTrend === 'bullish'
            ? calculateDirectionalAlignmentScore(gmmaShortValues, 'bullish')
            : gmmaShortTrend === 'bearish'
            ? calculateDirectionalAlignmentScore(gmmaShortValues, 'bearish')
            : 0;
        result.gmmaLongScore = gmmaLongTrend === 'bullish'
            ? calculateDirectionalAlignmentScore(gmmaLongValues, 'bullish')
            : gmmaLongTrend === 'bearish'
            ? calculateDirectionalAlignmentScore(gmmaLongValues, 'bearish')
            : 0;
        result.gmmaSeparationPercent = longAvg > 0
            ? calculatePercentageChange(shortAvg, longAvg)
            : undefined;

        if (
            gmmaShortTrend === 'bullish' &&
            gmmaLongTrend === 'bullish' &&
            Math.min(...shortDefined) > Math.max(...longDefined)
        ) {
            result.gmmaTrend = 'bullish';
        } else if (
            gmmaShortTrend === 'bearish' &&
            gmmaLongTrend === 'bearish' &&
            Math.max(...shortDefined) < Math.min(...longDefined)
        ) {
            result.gmmaTrend = 'bearish';
        } else {
            result.gmmaTrend = 'mixed';
        }
    }

    const multiEmaValues = input.multiEmaValues ?? [];
    if (multiEmaValues.length > 0) {
        const multiTrend = determineOrderedTrend(multiEmaValues);
        result.multiEmaTrend = multiTrend;
        result.multiEmaAlignmentScore = multiTrend === 'bullish'
            ? calculateDirectionalAlignmentScore(multiEmaValues, 'bullish')
            : multiTrend === 'bearish'
            ? calculateDirectionalAlignmentScore(multiEmaValues, 'bearish')
            : 0;
    }

    return result;
}
