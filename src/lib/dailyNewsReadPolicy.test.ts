import test from 'node:test';
import assert from 'node:assert/strict';

import { shouldGenerateDailyNewsOnRead } from './dailyNewsReadPolicy.ts';

test('shouldGenerateDailyNewsOnRead defaults to allowing automatic generation even in production', () => {
    assert.equal(shouldGenerateDailyNewsOnRead('development'), true);
    assert.equal(shouldGenerateDailyNewsOnRead('test'), true);
    assert.equal(shouldGenerateDailyNewsOnRead('production'), true);
});

test('shouldGenerateDailyNewsOnRead respects an explicit false override', () => {
    assert.equal(shouldGenerateDailyNewsOnRead('production', 'false'), false);
    assert.equal(shouldGenerateDailyNewsOnRead('production', '0'), false);
    assert.equal(shouldGenerateDailyNewsOnRead('production', 'off'), false);
});
