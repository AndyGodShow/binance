export type StrategyId =
    | 'strong-breakout'
    | 'trend-confirmation'
    | 'capital-inflow'
    | 'rsrs-trend'
    | 'volatility-squeeze'
    | 'wei-shen-ledger';

export type DeepPartial<T> = {
    [K in keyof T]?: T[K] extends readonly unknown[]
        ? T[K]
        : T[K] extends object
            ? DeepPartial<T[K]>
            : T[K];
};

export interface StrongBreakoutParameters {
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

export interface TrendConfirmationRangeRule {
    change15m?: number;
    change1h?: number;
    change4h?: number;
    minEmaDistance: number;
    maxEmaDistance: number;
}

export interface TrendConfirmationPullbackRule {
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

export interface TrendConfirmationParameters {
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

export interface CapitalInflowParameters {
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

export interface RsrsTrendParameters {
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

export interface VolatilitySqueezeParameters {
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
    cooldownPeriodMs: number;
    shortEntryHoursUtc: readonly number[];
    longEntryHoursUtc: readonly number[];
    minConditions: number;
    minQuoteVolume: number;
    minVolumeRatio: number;
    minOiExpansion: number;
    minFundingRate: number;
    maxLongFundingRate: number;
    maxBandwidthPercentile: number;
    maxAtrPercent: number;
    minAdx: number;
    minDistanceAboveBollingerLowerPercent: number;
    minDistanceBelowBollingerUpperPercent: number;
    riskPercentage: number;
    shortMomentum: {
        maxChange15m: number;
        maxChange1h: number;
        maxChange4h: number;
    };
    longMomentum: {
        minChange15m: number;
        minChange1h: number;
        minChange4h: number;
    };
    confidence: {
        base: number;
        timeWindowBonus: number;
        oiExpansionBonus: number;
        positiveFundingBonus: number;
        favorableFundingBonus: number;
        strongVolumeRatio: number;
        strongVolumeBonus: number;
        structureBonus: number;
        dailyWeaknessThreshold: number;
        dailyWeaknessBonus: number;
        dailyStrengthThreshold: number;
        dailyStrengthBonus: number;
        minConfidence: number;
        maxConfidence: number;
    };
    candidateRanges: {
        minQuoteVolume: readonly number[];
        minOiExpansion: readonly number[];
        minVolumeRatio: readonly number[];
        maxBandwidthPercentile: readonly number[];
        minConditions: readonly number[];
        shortMomentum: ReadonlyArray<WeiShenLedgerParameters['shortMomentum']>;
    };
}

export interface StrategyParameterConfigMap {
    'strong-breakout': StrongBreakoutParameters;
    'trend-confirmation': TrendConfirmationParameters;
    'capital-inflow': CapitalInflowParameters;
    'rsrs-trend': RsrsTrendParameters;
    'volatility-squeeze': VolatilitySqueezeParameters;
    'wei-shen-ledger': WeiShenLedgerParameters;
}

export interface StrategyParameterCandidate {
    id: string;
    label: string;
    overrides: DeepPartial<StrategyParameterConfigMap>;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function deepMerge<T>(base: T, override?: DeepPartial<T>): T {
    const result = structuredClone(base);
    if (!override) {
        return result;
    }

    Object.entries(override).forEach(([key, value]) => {
        if (value === undefined) {
            return;
        }

        const current = (result as Record<string, unknown>)[key];
        if (isPlainObject(current) && isPlainObject(value)) {
            (result as Record<string, unknown>)[key] = deepMerge(current, value as DeepPartial<typeof current>);
            return;
        }

        (result as Record<string, unknown>)[key] = structuredClone(value);
    });

    return result;
}

export const BASELINE_STRATEGY_PARAMETER_CONFIGS: StrategyParameterConfigMap = {
    'strong-breakout': {
        cooldownPeriodMs: 45 * 60 * 1000,
        breakoutBufferPercent: 0.3,
        minVolume24h: 10_000_000,
        minOiChange4h: 15,
        minEmaDistancePercent: 1,
        maxEmaDistancePercent: 8,
        momentumThresholds: {
            change15m: 2,
            change1h: 4,
            change4h: 8,
            change24h: 12,
        },
        confidence: {
            base: 86,
            allMomentumBonus: 4,
            strongBreakoutPercent: 1,
            strongBreakoutBonus: 2,
            strongOiThreshold: 25,
            strongOiBonus: 2,
            strongVolumeThreshold: 50_000_000,
            strongVolumeBonus: 2,
            optimalEmaDistanceMin: 1.5,
            optimalEmaDistanceMax: 4,
            optimalEmaBonus: 2,
            maxConfidence: 95,
        },
        candidateRanges: {
            breakoutBufferPercent: [0.3, 0.5, 0.8],
            minVolume24h: [10_000_000, 20_000_000, 30_000_000],
            minOiChange4h: [15, 18, 22],
            minEmaDistancePercent: [1.0, 1.2, 1.5],
            maxEmaDistancePercent: [6, 7, 8],
            momentumThresholds: [
                { change15m: 2, change1h: 4, change4h: 8, change24h: 12 },
                { change15m: 2.5, change1h: 4.5, change4h: 9, change24h: 14 },
                { change15m: 3, change1h: 5, change4h: 10, change24h: 15 },
            ],
        },
    },
    'trend-confirmation': {
        cooldownPeriodMs: 60 * 60 * 1000,
        rules: {
            minQuoteVolume: 12_000_000,
            minBaseQuoteVolume: 8_000_000,
            minOiValue: 6_000_000,
            minBaseOiValue: 4_000_000,
            minOiExpansion: 4,
            minBaseOiExpansion: 2,
            longStart: {
                change15m: 0.2,
                change1h: 0.8,
                change4h: 2.2,
                minEmaDistance: 0.1,
                maxEmaDistance: 5.0,
            },
            shortStart: {
                change15m: -0.2,
                change1h: -0.8,
                change4h: -2.2,
                minEmaDistance: -5.0,
                maxEmaDistance: -0.1,
            },
            longHold: {
                change15m: -0.05,
                change1h: 0.35,
                change4h: 1.3,
                minEmaDistance: -0.4,
                maxEmaDistance: 6.5,
            },
            shortHold: {
                change15m: 0.05,
                change1h: -0.35,
                change4h: -1.3,
                minEmaDistance: -6.5,
                maxEmaDistance: 0.4,
            },
            longPullback: {
                min1h: -1.0,
                min4h: 0.8,
                minEmaDistance: -2.2,
                maxEmaDistance: 6.5,
            },
            shortPullback: {
                max1h: 1.0,
                max4h: -0.8,
                minEmaDistance: -6.5,
                maxEmaDistance: 2.2,
            },
        },
        betaFilter: {
            enabled: false,
            correlationThreshold: 0.9,
            minBetaWhenCorrelated: 1.1,
        },
        confidence: {
            reversal: 90,
            resume: 88,
            start: 87,
            active: 85,
            strongStartBonus: 2,
            highVolumeThreshold: 50_000_000,
            highVolumeBonus: 2,
            highOiValueThreshold: 30_000_000,
            highOiValueBonus: 1,
            highOiExpansionThreshold: 15,
            highOiExpansionBonus: 2,
            optimalEmaDistanceMin: 0.8,
            optimalEmaDistanceMax: 3.2,
            optimalEmaBonus: 1,
            betaStrengthThreshold: 1.2,
            betaStrengthBonus: 2,
            maxConfidence: 95,
        },
        candidateRanges: {
            minBaseQuoteVolume: [8_000_000, 12_000_000, 16_000_000],
            minBaseOiValue: [4_000_000, 6_000_000, 8_000_000],
            minBaseOiExpansion: [2, 3, 4],
            holdChange1h: [0.35, 0.5, 0.65],
            holdChange4h: [1.3, 1.6, 2.0],
            longHoldEmaWindows: [
                { minEmaDistance: -0.4, maxEmaDistance: 6.5 },
                { minEmaDistance: -0.2, maxEmaDistance: 5.8 },
                { minEmaDistance: 0.0, maxEmaDistance: 5.2 },
            ],
            shortHoldEmaWindows: [
                { minEmaDistance: -6.5, maxEmaDistance: 0.4 },
                { minEmaDistance: -5.8, maxEmaDistance: 0.2 },
                { minEmaDistance: -5.2, maxEmaDistance: 0.0 },
            ],
        },
    },
    'capital-inflow': {
        cooldownPeriodMs: 30 * 60 * 1000,
        priceGrowth: {
            minChange1h: 8,
            minChange4h: 5,
            minChange15mTo1hRatio: 0.6,
        },
        quality: {
            minVolume24h: 30_000_000,
            requireCvdData: true,
            minCvdSlope: 0,
        },
        volumeProfile: {
            requireVolumeProfile: false,
            allowPriceOnlyFallback: true,
            minChange24hFallback: 10,
            minDistanceFromPocPercent: 2,
            minVolumeRatio: 1.5,
        },
        confidence: {
            base: 68,
            conditionBonus: 7,
            activeBuyingBonus: 5,
            hugeVolumeThreshold: 100_000_000,
            hugeVolumeBonus: 3,
            minConfidence: 80,
            maxConfidence: 88,
        },
        candidateRanges: {
            minChange1h: [6, 8, 10],
            minChange4h: [4, 5, 6],
            minChange15mTo1hRatio: [0.5, 0.6, 0.7],
            minVolume24h: [30_000_000, 40_000_000, 50_000_000],
            minVolumeRatio: [1.5, 1.8, 2.0],
            minDistanceFromPocPercent: [2, 3, 4],
        },
    },
    'rsrs-trend': {
        cooldownPeriodMs: 120 * 60 * 1000,
        extremeMultiplier: 1.5,
        trendScoreThreshold: 60,
        trendThresholds: {
            change15m: 3,
            change1h: 3,
            change4h: 3,
        },
        volumeRatioThreshold: 1.5,
        r2Floor: 0,
        rocFloor: 0,
        decelerationThreshold: 5,
        rejectExtremeDecelerating: false,
        confidence: {
            base: 80,
            extremeBonus: 5,
            decelerationPenalty: 10,
            rocBonusThreshold: 10,
            rocBonus: 5,
            strongVolumeRatioThreshold: 2,
            strongVolumeBonus: 5,
            allConditionsBonus: 5,
            minConfidence: 85,
            maxConfidence: 100,
        },
        candidateRanges: {
            trendScoreThreshold: [60, 70, 75],
            volumeRatioThreshold: [1.5, 1.8, 2.0],
            r2Floor: [0.55, 0.65, 0.75],
            rocFloor: [0, 5, 8],
            extremeMultiplier: [1.3, 1.5, 1.8],
        },
    },
    'volatility-squeeze': {
        cooldownPeriodMs: 60 * 60 * 1000,
        minSqueezeDuration: 10,
        maxReleaseBarsAgo: 1,
        requireImmediateRelease: false,
        maxSqueezeBandwidthPercentile: 12,
        strongSqueezeBandwidthPercentile: 8,
        minVolumeRatio: 1.5,
        minAdx: 20,
        strongAdx: 25,
        minBreakoutBodyPercent: 1.0,
        minConfidence: 85,
        confidenceWeights: {
            squeezeBase: 18,
            strongBandwidth: 7,
            normalBandwidth: 4,
            longDuration: 5,
            normalDuration: 3,
            immediateRelease: 15,
            delayedRelease: 11,
            strongMomentum: 15,
            normalMomentum: 11,
            structureBase: 15,
            strongBody: 10,
            normalBody: 7,
            strongVolume: 8,
            normalVolume: 6,
            strongAdx: 7,
            normalAdx: 5,
            maxConfidence: 95,
        },
        candidateRanges: {
            minSqueezeDuration: [10, 12, 14],
            maxSqueezeBandwidthPercentile: [12, 10, 8],
            releaseWindow: ['0~1', '0 only'],
            minVolumeRatio: [1.5, 1.8, 2.0],
            minAdx: [20, 22, 25],
            minBreakoutBodyPercent: [1.0, 1.2, 1.5],
        },
    },
    'wei-shen-ledger': {
        cooldownPeriodMs: 90 * 60 * 1000,
        shortEntryHoursUtc: [1, 2, 4, 19],
        longEntryHoursUtc: [18, 22],
        minConditions: 6,
        minQuoteVolume: 20_000_000,
        minVolumeRatio: 1.2,
        minOiExpansion: 2,
        minFundingRate: -0.0002,
        maxLongFundingRate: 0.00025,
        maxBandwidthPercentile: 85,
        maxAtrPercent: 6,
        minAdx: 22,
        minDistanceAboveBollingerLowerPercent: 0.2,
        minDistanceBelowBollingerUpperPercent: 0.2,
        riskPercentage: 0.6,
        shortMomentum: {
            maxChange15m: 0.2,
            maxChange1h: -0.35,
            maxChange4h: -1.3,
        },
        longMomentum: {
            minChange15m: 0.2,
            minChange1h: 0.8,
            minChange4h: 2.0,
        },
        confidence: {
            base: 70,
            timeWindowBonus: 5,
            oiExpansionBonus: 4,
            positiveFundingBonus: 4,
            favorableFundingBonus: 4,
            strongVolumeRatio: 1.5,
            strongVolumeBonus: 4,
            structureBonus: 4,
            dailyWeaknessThreshold: -2,
            dailyWeaknessBonus: 3,
            dailyStrengthThreshold: 2,
            dailyStrengthBonus: 3,
            minConfidence: 80,
            maxConfidence: 92,
        },
        candidateRanges: {
            minQuoteVolume: [20_000_000, 30_000_000, 50_000_000],
            minOiExpansion: [2, 3, 5],
            minVolumeRatio: [1.2, 1.5, 1.8],
            maxBandwidthPercentile: [85, 75, 65],
            minConditions: [6, 7, 8],
            shortMomentum: [
                { maxChange15m: 0.2, maxChange1h: -0.35, maxChange4h: -1.3 },
                { maxChange15m: 0, maxChange1h: -0.6, maxChange4h: -1.8 },
                { maxChange15m: -0.2, maxChange1h: -0.9, maxChange4h: -2.4 },
            ],
        },
    },
};

export const DEFAULT_STRATEGY_PARAMETER_CONFIGS = BASELINE_STRATEGY_PARAMETER_CONFIGS;

const overrideStack: Array<DeepPartial<StrategyParameterConfigMap>> = [];

function pickRangeValue<T>(values: readonly T[], index: number): T {
    return values[Math.min(index, values.length - 1)];
}

export function getStrategyParameterConfig<K extends StrategyId>(strategyId: K): StrategyParameterConfigMap[K] {
    return overrideStack.reduce(
        (config, override) => deepMerge(config, override[strategyId] as DeepPartial<StrategyParameterConfigMap[K]> | undefined),
        structuredClone(DEFAULT_STRATEGY_PARAMETER_CONFIGS[strategyId]),
    );
}

export function getAllStrategyParameterConfigs(): StrategyParameterConfigMap {
    return {
        'strong-breakout': getStrategyParameterConfig('strong-breakout'),
        'trend-confirmation': getStrategyParameterConfig('trend-confirmation'),
        'capital-inflow': getStrategyParameterConfig('capital-inflow'),
        'rsrs-trend': getStrategyParameterConfig('rsrs-trend'),
        'volatility-squeeze': getStrategyParameterConfig('volatility-squeeze'),
        'wei-shen-ledger': getStrategyParameterConfig('wei-shen-ledger'),
    };
}

export function buildStrategyParameterCandidates(strategyId: StrategyId): StrategyParameterCandidate[] {
    const tiers = [1, 2];

    switch (strategyId) {
        case 'strong-breakout': {
            const baseline = BASELINE_STRATEGY_PARAMETER_CONFIGS['strong-breakout'];
            return tiers.map((tierIndex) => ({
                id: `strong-breakout-tier-${tierIndex}`,
                label: tierIndex === 1 ? '中等保守' : '严格保守',
                overrides: {
                    'strong-breakout': {
                        breakoutBufferPercent: pickRangeValue(baseline.candidateRanges.breakoutBufferPercent, tierIndex),
                        minVolume24h: pickRangeValue(baseline.candidateRanges.minVolume24h, tierIndex),
                        minOiChange4h: pickRangeValue(baseline.candidateRanges.minOiChange4h, tierIndex),
                        minEmaDistancePercent: pickRangeValue(baseline.candidateRanges.minEmaDistancePercent, tierIndex),
                        maxEmaDistancePercent: pickRangeValue(baseline.candidateRanges.maxEmaDistancePercent, tierIndex),
                        momentumThresholds: pickRangeValue(baseline.candidateRanges.momentumThresholds, tierIndex),
                    },
                },
            }));
        }

        case 'trend-confirmation': {
            const baseline = BASELINE_STRATEGY_PARAMETER_CONFIGS['trend-confirmation'];
            return tiers.map((tierIndex) => {
                const holdChange1h = pickRangeValue(baseline.candidateRanges.holdChange1h, tierIndex);
                const holdChange4h = pickRangeValue(baseline.candidateRanges.holdChange4h, tierIndex);

                return {
                    id: `trend-confirmation-tier-${tierIndex}`,
                    label: tierIndex === 1 ? '中等保守' : '严格保守',
                    overrides: {
                        'trend-confirmation': {
                            betaFilter: {
                                enabled: true,
                            },
                            rules: {
                                minBaseQuoteVolume: pickRangeValue(baseline.candidateRanges.minBaseQuoteVolume, tierIndex),
                                minBaseOiValue: pickRangeValue(baseline.candidateRanges.minBaseOiValue, tierIndex),
                                minBaseOiExpansion: pickRangeValue(baseline.candidateRanges.minBaseOiExpansion, tierIndex),
                                longHold: {
                                    change1h: holdChange1h,
                                    change4h: holdChange4h,
                                    ...pickRangeValue(baseline.candidateRanges.longHoldEmaWindows, tierIndex),
                                },
                                shortHold: {
                                    change1h: -holdChange1h,
                                    change4h: -holdChange4h,
                                    ...pickRangeValue(baseline.candidateRanges.shortHoldEmaWindows, tierIndex),
                                },
                            },
                        },
                    },
                };
            });
        }

        case 'capital-inflow': {
            const baseline = BASELINE_STRATEGY_PARAMETER_CONFIGS['capital-inflow'];
            return tiers.map((tierIndex) => ({
                id: `capital-inflow-tier-${tierIndex}`,
                label: tierIndex === 1 ? '中等保守' : '严格保守',
                overrides: {
                    'capital-inflow': {
                        priceGrowth: {
                            minChange1h: pickRangeValue(baseline.candidateRanges.minChange1h, tierIndex),
                            minChange4h: pickRangeValue(baseline.candidateRanges.minChange4h, tierIndex),
                            minChange15mTo1hRatio: pickRangeValue(baseline.candidateRanges.minChange15mTo1hRatio, tierIndex),
                        },
                        quality: {
                            minVolume24h: pickRangeValue(baseline.candidateRanges.minVolume24h, tierIndex),
                            requireCvdData: true,
                        },
                        volumeProfile: {
                            requireVolumeProfile: true,
                            allowPriceOnlyFallback: false,
                            minDistanceFromPocPercent: pickRangeValue(baseline.candidateRanges.minDistanceFromPocPercent, tierIndex),
                            minVolumeRatio: pickRangeValue(baseline.candidateRanges.minVolumeRatio, tierIndex),
                        },
                    },
                },
            }));
        }

        case 'rsrs-trend': {
            const baseline = BASELINE_STRATEGY_PARAMETER_CONFIGS['rsrs-trend'];
            return tiers.map((tierIndex) => ({
                id: `rsrs-trend-tier-${tierIndex}`,
                label: tierIndex === 1 ? '中等保守' : '严格保守',
                overrides: {
                    'rsrs-trend': {
                        trendScoreThreshold: pickRangeValue(baseline.candidateRanges.trendScoreThreshold, tierIndex),
                        volumeRatioThreshold: pickRangeValue(baseline.candidateRanges.volumeRatioThreshold, tierIndex),
                        r2Floor: pickRangeValue(baseline.candidateRanges.r2Floor, tierIndex),
                        rocFloor: pickRangeValue(baseline.candidateRanges.rocFloor, tierIndex),
                        extremeMultiplier: pickRangeValue(baseline.candidateRanges.extremeMultiplier, tierIndex),
                        rejectExtremeDecelerating: true,
                    },
                },
            }));
        }

        case 'volatility-squeeze': {
            const baseline = BASELINE_STRATEGY_PARAMETER_CONFIGS['volatility-squeeze'];
            return tiers.map((tierIndex) => {
                const releaseWindow = pickRangeValue(baseline.candidateRanges.releaseWindow, tierIndex);
                return {
                    id: `volatility-squeeze-tier-${tierIndex}`,
                    label: tierIndex === 1 ? '中等保守' : '严格保守',
                    overrides: {
                        'volatility-squeeze': {
                            minSqueezeDuration: pickRangeValue(baseline.candidateRanges.minSqueezeDuration, tierIndex),
                            maxSqueezeBandwidthPercentile: pickRangeValue(baseline.candidateRanges.maxSqueezeBandwidthPercentile, tierIndex),
                            requireImmediateRelease: releaseWindow === '0 only',
                            maxReleaseBarsAgo: releaseWindow === '0 only' ? 0 : 1,
                            minVolumeRatio: pickRangeValue(baseline.candidateRanges.minVolumeRatio, tierIndex),
                            minAdx: pickRangeValue(baseline.candidateRanges.minAdx, tierIndex),
                            minBreakoutBodyPercent: pickRangeValue(baseline.candidateRanges.minBreakoutBodyPercent, tierIndex),
                        },
                    },
                };
            });
        }

        case 'wei-shen-ledger': {
            const baseline = BASELINE_STRATEGY_PARAMETER_CONFIGS['wei-shen-ledger'];
            return tiers.map((tierIndex) => ({
                id: `wei-shen-ledger-tier-${tierIndex}`,
                label: tierIndex === 1 ? '中等保守' : '严格保守',
                overrides: {
                    'wei-shen-ledger': {
                        minQuoteVolume: pickRangeValue(baseline.candidateRanges.minQuoteVolume, tierIndex),
                        minOiExpansion: pickRangeValue(baseline.candidateRanges.minOiExpansion, tierIndex),
                        minVolumeRatio: pickRangeValue(baseline.candidateRanges.minVolumeRatio, tierIndex),
                        maxBandwidthPercentile: pickRangeValue(baseline.candidateRanges.maxBandwidthPercentile, tierIndex),
                        minConditions: pickRangeValue(baseline.candidateRanges.minConditions, tierIndex),
                        shortMomentum: pickRangeValue(baseline.candidateRanges.shortMomentum, tierIndex),
                    },
                },
            }));
        }
    }
}

export function withStrategyParameterOverrides<T>(
    overrides: DeepPartial<StrategyParameterConfigMap>,
    task: () => T | Promise<T>,
): T | Promise<T> {
    overrideStack.push(overrides);
    let cleanupScheduled = false;

    try {
        const result = task();
        if (result && typeof (result as Promise<T>).then === 'function') {
            cleanupScheduled = true;
            return (result as Promise<T>).finally(() => {
                overrideStack.pop();
            });
        }

        overrideStack.pop();
        return result;
    } finally {
        if (!cleanupScheduled && overrideStack[overrideStack.length - 1] === overrides) {
            overrideStack.pop();
        }
    }
}

export function resetStrategyParameterOverrides(): void {
    overrideStack.length = 0;
}
