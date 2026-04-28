import assert from 'node:assert/strict';
import test from 'node:test';

import { createDismissedSignalKey } from './strategySignalKeys.ts';

test('dismissed signal keys include strategy id so one symbol can carry independent strategy state', () => {
    const breakoutKey = createDismissedSignalKey({
        symbol: 'BTCUSDT',
        strategyId: 'strong-breakout',
    });
    const rsrsKey = createDismissedSignalKey({
        symbol: 'BTCUSDT',
        strategyId: 'rsrs-trend',
    });

    assert.notEqual(breakoutKey, rsrsKey);
    assert.equal(breakoutKey, 'BTCUSDT:strong-breakout');
});
