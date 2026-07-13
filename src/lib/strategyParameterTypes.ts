import type { SentimentHotspotParameters } from './sentimentHotspot.ts';

export type StrategyId =
    | 'strong-breakout'
    | 'trend-confirmation'
    | 'capital-inflow'
    | 'rsrs-trend'
    | 'volatility-squeeze'
    | 'wei-shen-ledger'
    | 'sentiment-hotspot';

export type DeepPartial<T> = {
    [K in keyof T]?: T[K] extends readonly unknown[]
        ? T[K]
        : T[K] extends object
            ? DeepPartial<T[K]>
            : T[K];
};

interface StrongBreakoutParameters {
    cooldownPeriodMs: number;
    breakoutBufferPercent: number;
    minVolume24h: number;
    minOiChange4h: number;
    minEmaDistancePercent: number;
    maxEmaDistancePercent: number;
    momentumThresholds: {
        change15m: number;
        change1h: number;
        change4h: number;
        change24h: number;
    };
    confidence: {
        base: number;
        allMomentumBonus: number;
        strongBreakoutPercent: number;
        strongBreakoutBonus: number;
        strongOiThreshold: number;
        strongOiBonus: number;
        strongVolumeThreshold: number;
        strongVolumeBonus: number;
        optimalEmaDistanceMin: number;
        optimalEmaDistanceMax: number;
        optimalEmaBonus: number;
        maxConfidence: number;
    };
    candidateRanges: {
        breakoutBufferPercent: readonly number[];
        minVolume24h: readonly number[];
        minOiChange4h: readonly number[];
        minEmaDistancePercent: readonly number[];
        maxEmaDistancePercent: readonly number[];
        momentumThresholds: ReadonlyArray<StrongBreakoutParameters['momentumThresholds']>;
    };
}

interface TrendConfirmationRangeRule {
    change15m?: number;
    change1h?: number;
    change4h?: number;
    minEmaDistance: number;
    maxEmaDistance: number;
}

interface TrendConfirmationPullbackRule {
    min1h?: number;
    max1h?: number;
    min4h?: number;
    max4h?: number;
    minEmaDistance: number;
    maxEmaDistance: number;
}

export interface TrendConfirmationRules {
    minQuoteVolume: number;
    minBaseQuoteVolume: number;
    minOiValue: number;
    minBaseOiValue: number;
    minOiExpansion: number;
    minBaseOiExpansion: number;
    longStart: TrendConfirmationRangeRule & Required<Pick<TrendConfirmationRangeRule, 'change15m' | 'change1h' | 'change4h'>>;
    shortStart: TrendConfirmationRangeRule & Required<Pick<TrendConfirmationRangeRule, 'change15m' | 'change1h' | 'change4h'>>;
    longHold: TrendConfirmationRangeRule & Required<Pick<TrendConfirmationRangeRule, 'change15m' | 'change1h' | 'change4h'>>;
    shortHold: TrendConfirmationRangeRule & Required<Pick<TrendConfirmationRangeRule, 'change15m' | 'change1h' | 'change4h'>>;
    longPullback: TrendConfirmationPullbackRule & Required<Pick<TrendConfirmationPullbackRule, 'min1h' | 'min4h'>>;
    shortPullback: TrendConfirmationPullbackRule & Required<Pick<TrendConfirmationPullbackRule, 'max1h' | 'max4h'>>;
}

interface TrendConfirmationParameters {
    cooldownPeriodMs: number;
    rules: TrendConfirmationRules;
    betaFilter: {
        enabled: boolean;
        correlationThreshold: number;
        minBetaWhenCorrelated: number;
    };
    confidence: {
        reversal: number;
        resume: number;
        start: number;
        active: number;
        strongStartBonus: number;
        highVolumeThreshold: number;
        highVolumeBonus: number;
        highOiValueThreshold: number;
        highOiValueBonus: number;
        highOiExpansionThreshold: number;
        highOiExpansionBonus: number;
        optimalEmaDistanceMin: number;
        optimalEmaDistanceMax: number;
        optimalEmaBonus: number;
        betaStrengthThreshold: number;
        betaStrengthBonus: number;
        maxConfidence: number;
    };
    candidateRanges: {
        minBaseQuoteVolume: readonly number[];
        minBaseOiValue: readonly number[];
        minBaseOiExpansion: readonly number[];
        holdChange1h: readonly number[];
        holdChange4h: readonly number[];
        longHoldEmaWindows: ReadonlyArray<Pick<TrendConfirmationRangeRule, 'minEmaDistance' | 'maxEmaDistance'>>;
        shortHoldEmaWindows: ReadonlyArray<Pick<TrendConfirmationRangeRule, 'minEmaDistance' | 'maxEmaDistance'>>;
    };
}

interface CapitalInflowParameters {
    cooldownPeriodMs: number;
    priceGrowth: {
        minChange1h: number;
        minChange4h: number;
        minChange15mTo1hRatio: number;
    };
    quality: {
        minVolume24h: number;
        requireCvdData: boolean;
        minCvdSlope: number;
    };
    volumeProfile: {
        requireVolumeProfile: boolean;
        allowPriceOnlyFallback: boolean;
        minChange24hFallback: number;
        minDistanceFromPocPercent: number;
        minVolumeRatio: number;
    };
    confidence: {
        base: number;
        conditionBonus: number;
        activeBuyingBonus: number;
        hugeVolumeThreshold: number;
        hugeVolumeBonus: number;
        minConfidence: number;
        maxConfidence: number;
    };
    candidateRanges: {
        minChange1h: readonly number[];
        minChange4h: readonly number[];
        minChange15mTo1hRatio: readonly number[];
        minVolume24h: readonly number[];
        minVolumeRatio: readonly number[];
        minDistanceFromPocPercent: readonly number[];
    };
}

interface RsrsTrendParameters {
    cooldownPeriodMs: number;
    extremeMultiplier: number;
    trendScoreThreshold: number;
    trendThresholds: {
        change15m: number;
        change1h: number;
        change4h: number;
    };
    volumeRatioThreshold: number;
    r2Floor: number;
    rocFloor: number;
    decelerationThreshold: number;
    rejectExtremeDecelerating: boolean;
    confidence: {
        base: number;
        extremeBonus: number;
        decelerationPenalty: number;
        rocBonusThreshold: number;
        rocBonus: number;
        strongVolumeRatioThreshold: number;
        strongVolumeBonus: number;
        allConditionsBonus: number;
        minConfidence: number;
        maxConfidence: number;
    };
    candidateRanges: {
        trendScoreThreshold: readonly number[];
        volumeRatioThreshold: readonly number[];
        r2Floor: readonly number[];
        rocFloor: readonly number[];
        extremeMultiplier: readonly number[];
    };
}

interface VolatilitySqueezeParameters {
    cooldownPeriodMs: number;
    minSqueezeDuration: number;
    maxReleaseBarsAgo: number;
    requireImmediateRelease: boolean;
    maxSqueezeBandwidthPercentile: number;
    strongSqueezeBandwidthPercentile: number;
    minVolumeRatio: number;
    minAdx: number;
    strongAdx: number;
    minBreakoutBodyPercent: number;
    minConfidence: number;
    confidenceWeights: {
        squeezeBase: number;
        strongBandwidth: number;
        normalBandwidth: number;
        longDuration: number;
        normalDuration: number;
        immediateRelease: number;
        delayedRelease: number;
        strongMomentum: number;
        normalMomentum: number;
        structureBase: number;
        strongBody: number;
        normalBody: number;
        strongVolume: number;
        normalVolume: number;
        strongAdx: number;
        normalAdx: number;
        maxConfidence: number;
    };
    candidateRanges: {
        minSqueezeDuration: readonly number[];
        maxSqueezeBandwidthPercentile: readonly number[];
        releaseWindow: readonly ('0~1' | '0 only')[];
        minVolumeRatio: readonly number[];
        minAdx: readonly number[];
        minBreakoutBodyPercent: readonly number[];
    };
}

export interface WeiShenLedgerParameters {
    timeframes: {
        signalInterval: '1h';
        executionInterval: '15m';
        confirmInterval: '4h';
        dailyFilterInterval: '1d';
    };
    marketRegime: {
        emaPeriods: {
            fast: number;
            mid: number;
            slow: number;
        };
        dailyEmaPeriod: number;
        dailySlopeLookback: number;
        dailySlopeMinPct: number;
        rangeAdxMax: number;
        rangeCompressionPct: number;
        shock24hPct: number;
        weakCloseLocationMax: number;
    };
    relativeStrength: {
        rsWindow1h: number;
        rsWindow4h: number;
        relativeVolumeMa: number;
        minVolume24hUsd: Record<string, number>;
        excessReturn4hMin: Record<string, number>;
    };
    entry: {
        atrPeriod: number;
        atrExpansionMin: number;
        atrExpansionMaxMultiplier: number;
        donchianLookback: Record<string, number>;
        overheatThresholdPct: Record<string, number>;
        breakoutVolumeRatioMin: Record<string, number>;
        breakoutStrongVolumeRatioMultiplier: number;
        breakoutSwingLookback: number;
        breakoutStopAtrMultiplier: number;
        breakoutStrongExcessReturnBonusPct: Record<string, number>;
        pullbackEmaPeriods: readonly [number, number];
        trendLegLookback: number;
        trendLegMinReturnPct: Record<string, number>;
        pullbackRecentBars: number;
        pullbackZoneBufferPct: number;
        pullbackStructureBufferPct: number;
        pullbackVolumeCompressionMax: number;
        reclaimConfirmBars: number;
        reclaimVolumeRatioMin: number;
        pullbackStopAtrMultiplier: Record<string, number>;
        pullbackStrongExcessReturnBonusPct: Record<string, number>;
        allowPullbackSymbols: readonly string[];
    };
    grading: {
        tradableGrades: readonly ('A' | 'B')[];
        baseConfidence: {
            A: number;
            B: number;
            C: number;
        };
    };
    risk: {
        baseRiskPct: {
            A: number;
            B: number;
            C: number;
        };
        symbolRiskMultiplier: Record<string, number>;
        maxConcurrentPositions: number;
        coreClusterRiskCap: number;
        specClusterRiskCap: number;
        btcLeadAltRiskMultiplier: number;
        maxConsecutiveLossesBeforeCooldown: number;
        cooldownBars: number;
        maxDailyDrawdownPct: number;
        moveStopToEntryAtR: number;
        partialTakeProfitAtR: number;
        partialTakeProfitClosePct: number;
        breakoutTimeStopBars: number;
        pullbackTimeStopBars: number;
        trailingEmaPeriod: number;
        trailingDonchianLookback: number;
    };
    candidateRanges: {
        rangeAdxMax: readonly number[];
        rangeCompressionPct: readonly number[];
        atrExpansionMin: readonly number[];
        btcBreakoutVolumeRatioMin: readonly number[];
        ethExcessReturn4hMin: readonly number[];
    };
}

export interface StrategyParameterConfigMap {
    'strong-breakout': StrongBreakoutParameters;
    'trend-confirmation': TrendConfirmationParameters;
    'capital-inflow': CapitalInflowParameters;
    'rsrs-trend': RsrsTrendParameters;
    'volatility-squeeze': VolatilitySqueezeParameters;
    'wei-shen-ledger': WeiShenLedgerParameters;
    'sentiment-hotspot': SentimentHotspotParameters;
}

export interface StrategyParameterCandidate {
    id: string;
    label: string;
    overrides: DeepPartial<StrategyParameterConfigMap>;
}
