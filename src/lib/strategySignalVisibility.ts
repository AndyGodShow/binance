import { APP_CONFIG } from './config.ts';
import type { StrategySignal } from './strategyTypes.ts';

export function isStrategySignalVisible(signal: StrategySignal, minimumConfidence = APP_CONFIG.STRATEGY.MIN_CONFIDENCE): boolean {
    if (signal.executionMode === 'observe') {
        return true;
    }

    if (signal.strategyId === 'wei-shen-ledger') {
        return true;
    }

    return signal.confidence >= minimumConfidence;
}
