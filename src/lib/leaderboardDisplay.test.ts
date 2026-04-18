import test from 'node:test';
import assert from 'node:assert/strict';

import { trimLeaderboardDisplaySymbol } from './leaderboardDisplay.ts';

test('trimLeaderboardDisplaySymbol removes only the trailing USDT suffix', () => {
    assert.equal(trimLeaderboardDisplaySymbol('PORTALUSDT'), 'PORTAL');
    assert.equal(trimLeaderboardDisplaySymbol('币安人生 我踏马来了USDT'), '币安人生 我踏马来了');
    assert.equal(trimLeaderboardDisplaySymbol('USDTDOM'), 'USDTDOM');
});
