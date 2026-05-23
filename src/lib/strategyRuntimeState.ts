import { CooldownManager, cooldownManager, type CooldownStateStore } from './cooldownManager.ts';
import { TrendStateManager, trendStateManager, type TrendStateStore } from './trendStateManager.ts';
import type { StrategyDetectionContext } from './strategyTypes.ts';

export interface StrategyRuntimeState {
    cooldown: CooldownStateStore;
    trend: TrendStateStore;
}

export const singletonStrategyRuntimeState: StrategyRuntimeState = {
    cooldown: cooldownManager,
    trend: trendStateManager,
};

export function createStrategyRuntimeState(): StrategyRuntimeState {
    return {
        cooldown: new CooldownManager({ enableAutoCleanup: false }),
        trend: new TrendStateManager(),
    };
}

export function getStrategyRuntimeState(context?: StrategyDetectionContext): StrategyRuntimeState {
    return context?.runtimeState ?? singletonStrategyRuntimeState;
}

export function shouldEnforceStrategyCooldown(context?: StrategyDetectionContext): boolean {
    return context?.cooldownPolicy !== 'evaluate-only';
}

export function shouldRecordStrategyCooldown(context?: StrategyDetectionContext): boolean {
    return context?.cooldownPolicy !== 'evaluate-only';
}
