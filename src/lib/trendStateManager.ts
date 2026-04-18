import { DEFAULT_STRATEGY_PARAMETER_CONFIGS, getStrategyParameterConfig } from './strategyParameters.ts';
import type { TrendConfirmationRules } from './strategyParameters.ts';

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

export const TREND_CONFIRMATION_RULES = DEFAULT_STRATEGY_PARAMETER_CONFIGS['trend-confirmation'].rules;

export function getTrendConfirmationRules(): TrendConfirmationRules {
    return getStrategyParameterConfig('trend-confirmation').rules;
}

interface RangeRule {
    minEmaDistance: number;
    maxEmaDistance: number;
}

function inRange(value: number | null, rule: RangeRule): boolean {
    return value !== null && Number.isFinite(value) && value >= rule.minEmaDistance && value <= rule.maxEmaDistance;
}

export function buildTrendFlags(snapshot: TrendSnapshot): TrendFlags {
    const rules = getTrendConfirmationRules();
    const liquidityOk =
        snapshot.quoteVolume >= rules.minQuoteVolume &&
        snapshot.oiValue >= rules.minOiValue;
    const baseLiquidityOk =
        snapshot.quoteVolume >= rules.minBaseQuoteVolume &&
        snapshot.oiValue >= rules.minBaseOiValue;
    const participationOk = snapshot.oiChangePercent >= rules.minOiExpansion;
    const baseParticipationOk = snapshot.oiChangePercent >= rules.minBaseOiExpansion;

    const longStructureOk = snapshot.gmmaTrend === 'bullish' && snapshot.multiEmaTrend !== 'bearish';
    const shortStructureOk = snapshot.gmmaTrend === 'bearish' && snapshot.multiEmaTrend !== 'bullish';

    const longStartReady =
        liquidityOk &&
        participationOk &&
        longStructureOk &&
        snapshot.change15m >= rules.longStart.change15m &&
        snapshot.change1h >= rules.longStart.change1h &&
        snapshot.change4h >= rules.longStart.change4h &&
        inRange(snapshot.emaDistancePercent, rules.longStart);

    const shortStartReady =
        liquidityOk &&
        participationOk &&
        shortStructureOk &&
        snapshot.change15m <= rules.shortStart.change15m &&
        snapshot.change1h <= rules.shortStart.change1h &&
        snapshot.change4h <= rules.shortStart.change4h &&
        inRange(snapshot.emaDistancePercent, rules.shortStart);

    const longHoldOk =
        baseLiquidityOk &&
        baseParticipationOk &&
        longStructureOk &&
        snapshot.change15m >= rules.longHold.change15m &&
        snapshot.change1h >= rules.longHold.change1h &&
        snapshot.change4h >= rules.longHold.change4h &&
        inRange(snapshot.emaDistancePercent, rules.longHold);

    const shortHoldOk =
        baseLiquidityOk &&
        baseParticipationOk &&
        shortStructureOk &&
        snapshot.change15m <= rules.shortHold.change15m &&
        snapshot.change1h <= rules.shortHold.change1h &&
        snapshot.change4h <= rules.shortHold.change4h &&
        inRange(snapshot.emaDistancePercent, rules.shortHold);

    const longPullbackOk =
        baseLiquidityOk &&
        longStructureOk &&
        snapshot.change1h >= rules.longPullback.min1h &&
        snapshot.change4h >= rules.longPullback.min4h &&
        inRange(snapshot.emaDistancePercent, rules.longPullback);

    const shortPullbackOk =
        baseLiquidityOk &&
        shortStructureOk &&
        snapshot.change1h <= rules.shortPullback.max1h &&
        snapshot.change4h <= rules.shortPullback.max4h &&
        inRange(snapshot.emaDistancePercent, rules.shortPullback);

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
