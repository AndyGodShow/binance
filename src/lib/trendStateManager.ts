export type TrendDirection = 'long' | 'short';
export type TrendPhase =
    | 'idle'
    | 'active_long'
    | 'active_short'
    | 'pullback_long'
    | 'pullback_short';
export type TrendEvent = 'start' | 'resume' | 'reversal' | null;

export interface TrendSnapshot {
    change15m: number;
    change1h: number;
    change4h: number;
    quoteVolume: number;
    oiValue: number;
    oiChangePercent: number;
    emaDistancePercent: number | null;
    gmmaTrend: 'bullish' | 'bearish' | 'mixed';
    multiEmaTrend: 'bullish' | 'bearish' | 'mixed';
}

export interface TrendFlags {
    liquidityOk: boolean;
    baseLiquidityOk: boolean;
    participationOk: boolean;
    baseParticipationOk: boolean;
    longStructureOk: boolean;
    shortStructureOk: boolean;
    longStartReady: boolean;
    shortStartReady: boolean;
    longHoldOk: boolean;
    shortHoldOk: boolean;
    longPullbackOk: boolean;
    shortPullbackOk: boolean;
}

export interface TrendStateEvaluation {
    phase: TrendPhase;
    direction: TrendDirection | null;
    event: TrendEvent;
    flags: TrendFlags;
}

export const TREND_CONFIRMATION_RULES = {
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
} as const;

interface RangeRule {
    minEmaDistance: number;
    maxEmaDistance: number;
}

function inRange(value: number | null, rule: RangeRule): boolean {
    return value !== null && Number.isFinite(value) && value >= rule.minEmaDistance && value <= rule.maxEmaDistance;
}

export function buildTrendFlags(snapshot: TrendSnapshot): TrendFlags {
    const liquidityOk =
        snapshot.quoteVolume >= TREND_CONFIRMATION_RULES.minQuoteVolume &&
        snapshot.oiValue >= TREND_CONFIRMATION_RULES.minOiValue;
    const baseLiquidityOk =
        snapshot.quoteVolume >= TREND_CONFIRMATION_RULES.minBaseQuoteVolume &&
        snapshot.oiValue >= TREND_CONFIRMATION_RULES.minBaseOiValue;
    const participationOk = snapshot.oiChangePercent >= TREND_CONFIRMATION_RULES.minOiExpansion;
    const baseParticipationOk = snapshot.oiChangePercent >= TREND_CONFIRMATION_RULES.minBaseOiExpansion;

    const longStructureOk = snapshot.gmmaTrend === 'bullish' && snapshot.multiEmaTrend !== 'bearish';
    const shortStructureOk = snapshot.gmmaTrend === 'bearish' && snapshot.multiEmaTrend !== 'bullish';

    const longStartReady =
        liquidityOk &&
        participationOk &&
        longStructureOk &&
        snapshot.change15m >= TREND_CONFIRMATION_RULES.longStart.change15m &&
        snapshot.change1h >= TREND_CONFIRMATION_RULES.longStart.change1h &&
        snapshot.change4h >= TREND_CONFIRMATION_RULES.longStart.change4h &&
        inRange(snapshot.emaDistancePercent, TREND_CONFIRMATION_RULES.longStart);

    const shortStartReady =
        liquidityOk &&
        participationOk &&
        shortStructureOk &&
        snapshot.change15m <= TREND_CONFIRMATION_RULES.shortStart.change15m &&
        snapshot.change1h <= TREND_CONFIRMATION_RULES.shortStart.change1h &&
        snapshot.change4h <= TREND_CONFIRMATION_RULES.shortStart.change4h &&
        inRange(snapshot.emaDistancePercent, TREND_CONFIRMATION_RULES.shortStart);

    const longHoldOk =
        baseLiquidityOk &&
        baseParticipationOk &&
        longStructureOk &&
        snapshot.change15m >= TREND_CONFIRMATION_RULES.longHold.change15m &&
        snapshot.change1h >= TREND_CONFIRMATION_RULES.longHold.change1h &&
        snapshot.change4h >= TREND_CONFIRMATION_RULES.longHold.change4h &&
        inRange(snapshot.emaDistancePercent, TREND_CONFIRMATION_RULES.longHold);

    const shortHoldOk =
        baseLiquidityOk &&
        baseParticipationOk &&
        shortStructureOk &&
        snapshot.change15m <= TREND_CONFIRMATION_RULES.shortHold.change15m &&
        snapshot.change1h <= TREND_CONFIRMATION_RULES.shortHold.change1h &&
        snapshot.change4h <= TREND_CONFIRMATION_RULES.shortHold.change4h &&
        inRange(snapshot.emaDistancePercent, TREND_CONFIRMATION_RULES.shortHold);

    const longPullbackOk =
        baseLiquidityOk &&
        longStructureOk &&
        snapshot.change1h >= TREND_CONFIRMATION_RULES.longPullback.min1h &&
        snapshot.change4h >= TREND_CONFIRMATION_RULES.longPullback.min4h &&
        inRange(snapshot.emaDistancePercent, TREND_CONFIRMATION_RULES.longPullback);

    const shortPullbackOk =
        baseLiquidityOk &&
        shortStructureOk &&
        snapshot.change1h <= TREND_CONFIRMATION_RULES.shortPullback.max1h &&
        snapshot.change4h <= TREND_CONFIRMATION_RULES.shortPullback.max4h &&
        inRange(snapshot.emaDistancePercent, TREND_CONFIRMATION_RULES.shortPullback);

    return {
        liquidityOk,
        baseLiquidityOk,
        participationOk,
        baseParticipationOk,
        longStructureOk,
        shortStructureOk,
        longStartReady,
        shortStartReady,
        longHoldOk,
        shortHoldOk,
        longPullbackOk,
        shortPullbackOk,
    };
}

class TrendStateManager {
    private phases = new Map<string, TrendPhase>();

    evaluate(symbol: string, snapshot: TrendSnapshot): TrendStateEvaluation {
        const phase = this.phases.get(symbol) || 'idle';
        const flags = buildTrendFlags(snapshot);

        const commit = (nextPhase: TrendPhase, event: TrendEvent): TrendStateEvaluation => {
            this.phases.set(symbol, nextPhase);

            return {
                phase: nextPhase,
                direction: nextPhase.endsWith('long')
                    ? 'long'
                    : nextPhase.endsWith('short')
                    ? 'short'
                    : null,
                event,
                flags,
            };
        };

        switch (phase) {
            case 'active_long':
                if (flags.shortStartReady) {
                    return commit('active_short', 'reversal');
                }
                if (flags.longHoldOk) {
                    return commit('active_long', null);
                }
                if (flags.longPullbackOk) {
                    return commit('pullback_long', null);
                }
                return commit('idle', null);

            case 'pullback_long':
                if (flags.shortStartReady) {
                    return commit('active_short', 'reversal');
                }
                if (flags.longStartReady) {
                    return commit('active_long', 'resume');
                }
                if (flags.longPullbackOk) {
                    return commit('pullback_long', null);
                }
                return commit('idle', null);

            case 'active_short':
                if (flags.longStartReady) {
                    return commit('active_long', 'reversal');
                }
                if (flags.shortHoldOk) {
                    return commit('active_short', null);
                }
                if (flags.shortPullbackOk) {
                    return commit('pullback_short', null);
                }
                return commit('idle', null);

            case 'pullback_short':
                if (flags.longStartReady) {
                    return commit('active_long', 'reversal');
                }
                if (flags.shortStartReady) {
                    return commit('active_short', 'resume');
                }
                if (flags.shortPullbackOk) {
                    return commit('pullback_short', null);
                }
                return commit('idle', null);

            case 'idle':
            default:
                if (flags.longStartReady) {
                    return commit('active_long', 'start');
                }
                if (flags.shortStartReady) {
                    return commit('active_short', 'start');
                }
                return commit('idle', null);
        }
    }

    clear(): void {
        this.phases.clear();
    }

    snapshot(): Map<string, TrendPhase> {
        return new Map(this.phases);
    }

    restore(snapshot: Map<string, TrendPhase>): void {
        this.phases = new Map(snapshot);
    }
}

export const trendStateManager = new TrendStateManager();
