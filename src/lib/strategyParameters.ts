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
}

export interface StrategyParameterCandidate {
    id: string;
    label: string;
    overrides: DeepPartial<StrategyParameterConfigMap>;
}

export function getScopedStrategyParameterOverride<K extends StrategyId>(
    strategyId: K,
    overrides?: DeepPartial<StrategyParameterConfigMap>,
): DeepPartial<StrategyParameterConfigMap[K]> | undefined {
    return overrides?.[strategyId] as DeepPartial<StrategyParameterConfigMap[K]> | undefined;
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
        timeframes: {
            signalInterval: '1h',
            executionInterval: '15m',
            confirmInterval: '4h',
            dailyFilterInterval: '1d',
        },
        marketRegime: {
            emaPeriods: {
                fast: 20,
                mid: 60,
                slow: 120,
            },
            dailyEmaPeriod: 20,
            dailySlopeLookback: 3,
            dailySlopeMinPct: 0.15,
            rangeAdxMax: 18,
            rangeCompressionPct: 1.8,
            shock24hPct: 8.5,
            weakCloseLocationMax: 0.45,
        },
        relativeStrength: {
            rsWindow1h: 8,
            rsWindow4h: 6,
            relativeVolumeMa: 20,
            minVolume24hUsd: {
                BTCUSDT: 5_000_000_000,
                ETHUSDT: 2_000_000_000,
                SOLUSDT: 800_000_000,
                XRPUSDT: 600_000_000,
                DOGEUSDT: 900_000_000,
            },
            excessReturn4hMin: {
                BTCUSDT: 0,
                ETHUSDT: 0.3,
                SOLUSDT: 0.5,
                XRPUSDT: 0.8,
                DOGEUSDT: 1.2,
            },
        },
        entry: {
            atrPeriod: 14,
            atrExpansionMin: 1.05,
            atrExpansionMaxMultiplier: 2.2,
            donchianLookback: {
                BTCUSDT: 20,
                ETHUSDT: 24,
                SOLUSDT: 20,
                XRPUSDT: 30,
                DOGEUSDT: 36,
            },
            overheatThresholdPct: {
                BTCUSDT: 3.0,
                ETHUSDT: 2.8,
                SOLUSDT: 3.5,
                XRPUSDT: 1.8,
                DOGEUSDT: 1.6,
            },
            breakoutVolumeRatioMin: {
                BTCUSDT: 1.15,
                ETHUSDT: 1.2,
                SOLUSDT: 1.35,
                XRPUSDT: 1.55,
                DOGEUSDT: 1.8,
            },
            breakoutStrongVolumeRatioMultiplier: 1.12,
            breakoutSwingLookback: 5,
            breakoutStopAtrMultiplier: 1.2,
            breakoutStrongExcessReturnBonusPct: {
                BTCUSDT: 0,
                ETHUSDT: 0.2,
                SOLUSDT: 0.2,
                XRPUSDT: 0.2,
                DOGEUSDT: 0.6,
            },
            pullbackEmaPeriods: [20, 30],
            trendLegLookback: 8,
            trendLegMinReturnPct: {
                BTCUSDT: 1.2,
                ETHUSDT: 1.2,
                SOLUSDT: 1.4,
                XRPUSDT: 1.6,
                DOGEUSDT: 2.0,
            },
            pullbackRecentBars: 4,
            pullbackZoneBufferPct: 0.3,
            pullbackStructureBufferPct: 1.0,
            pullbackVolumeCompressionMax: 0.85,
            reclaimConfirmBars: 1,
            reclaimVolumeRatioMin: 1.05,
            pullbackStopAtrMultiplier: {
                BTCUSDT: 0.8,
                ETHUSDT: 0.8,
                SOLUSDT: 1.0,
                XRPUSDT: 0.8,
                DOGEUSDT: 1.0,
            },
            pullbackStrongExcessReturnBonusPct: {
                BTCUSDT: 0,
                ETHUSDT: 0.15,
                SOLUSDT: 0.2,
                XRPUSDT: 0.5,
                DOGEUSDT: 0.6,
            },
            allowPullbackSymbols: ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'XRPUSDT'],
        },
        grading: {
            tradableGrades: ['A', 'B'],
            baseConfidence: {
                A: 92,
                B: 84,
                C: 70,
            },
        },
        risk: {
            baseRiskPct: {
                A: 0.75,
                B: 0.5,
                C: 0,
            },
            symbolRiskMultiplier: {
                BTCUSDT: 1,
                ETHUSDT: 0.9,
                SOLUSDT: 0.75,
                XRPUSDT: 0.55,
                DOGEUSDT: 0.4,
            },
            maxConcurrentPositions: 3,
            coreClusterRiskCap: 1.25,
            specClusterRiskCap: 0.6,
            btcLeadAltRiskMultiplier: 0.7,
            maxConsecutiveLossesBeforeCooldown: 3,
            cooldownBars: 24,
            maxDailyDrawdownPct: 1.8,
            moveStopToEntryAtR: 1,
            partialTakeProfitAtR: 2,
            partialTakeProfitClosePct: 50,
            breakoutTimeStopBars: 72,
            pullbackTimeStopBars: 96,
            trailingEmaPeriod: 20,
            trailingDonchianLookback: 20,
        },
        candidateRanges: {
            rangeAdxMax: [18, 16, 14],
            rangeCompressionPct: [1.8, 1.5, 1.2],
            atrExpansionMin: [1.05, 1.1, 1.15],
            btcBreakoutVolumeRatioMin: [1.15, 1.2, 1.3],
            ethExcessReturn4hMin: [0.3, 0.45, 0.6],
        },
    },
};

export const DEFAULT_STRATEGY_PARAMETER_CONFIGS = BASELINE_STRATEGY_PARAMETER_CONFIGS;

const overrideStack: Array<DeepPartial<StrategyParameterConfigMap>> = [];

function pickRangeValue<T>(values: readonly T[], index: number): T {
    return values[Math.min(index, values.length - 1)];
}

export function getStrategyParameterConfig<K extends StrategyId>(
    strategyId: K,
    explicitOverride?: DeepPartial<StrategyParameterConfigMap[K]>,
): StrategyParameterConfigMap[K] {
    const mergedFromStack = overrideStack.reduce(
        (config, override) => deepMerge(config, getScopedStrategyParameterOverride(strategyId, override)),
        structuredClone(DEFAULT_STRATEGY_PARAMETER_CONFIGS[strategyId]),
    );

    return deepMerge(mergedFromStack, explicitOverride);
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
                        marketRegime: {
                            rangeAdxMax: pickRangeValue(baseline.candidateRanges.rangeAdxMax, tierIndex),
                            rangeCompressionPct: pickRangeValue(baseline.candidateRanges.rangeCompressionPct, tierIndex),
                        },
                        entry: {
                            atrExpansionMin: pickRangeValue(baseline.candidateRanges.atrExpansionMin, tierIndex),
                            breakoutVolumeRatioMin: {
                                ...baseline.entry.breakoutVolumeRatioMin,
                                BTCUSDT: pickRangeValue(baseline.candidateRanges.btcBreakoutVolumeRatioMin, tierIndex),
                            },
                        },
                        relativeStrength: {
                            excessReturn4hMin: {
                                ...baseline.relativeStrength.excessReturn4hMin,
                                ETHUSDT: pickRangeValue(baseline.candidateRanges.ethExcessReturn4hMin, tierIndex),
                            },
                        },
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
