import assert from 'node:assert/strict';
import test from 'node:test';

import type { TradingStrategy } from './strategyTypes.ts';
import { StrategyRegistry } from '../strategies/registry.ts';

function createStrategy(id: string, enabled: boolean): TradingStrategy {
    return {
        id,
        name: id,
        description: id,
        category: 'special',
        enabled,
        detect: () => null,
    };
}

test('strategy registry restores persisted enabled strategy ids', () => {
    const writes: Record<string, string> = {
        strategyEnabledIds: JSON.stringify(['b']),
    };
    const storage = {
        getItem: (key: string) => writes[key] ?? null,
        setItem: (key: string, value: string) => {
            writes[key] = value;
        },
    };

    const registry = new StrategyRegistry({
        strategies: [
            createStrategy('a', true),
            createStrategy('b', false),
        ],
        storage,
    });

    assert.deepEqual(registry.getEnabled().map((strategy) => strategy.id), ['b']);

    registry.toggleStrategy('a');
    assert.deepEqual(JSON.parse(writes.strategyEnabledIds), ['b', 'a']);
});
