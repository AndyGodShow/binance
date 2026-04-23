import assert from 'node:assert/strict';
import test from 'node:test';

import { runStrategyOptimization } from './strategyOptimizationRunner.ts';

test('runStrategyOptimization trims wei-shen optimization symbols to the explicit whitelist', async () => {
    const results = await runStrategyOptimization({
        baseUrl: 'http://127.0.0.1:3000',
        strategyIds: ['wei-shen-ledger'],
        symbols: ['ADAUSDT', 'ETHUSDT', 'DOGEUSDT', 'SOLUSDT'],
        windows: [],
    });

    assert.equal(results.length, 1);
    assert.deepEqual(results[0].symbols, ['ETHUSDT', 'SOLUSDT', 'DOGEUSDT']);
});
