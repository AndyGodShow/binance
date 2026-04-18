import test from 'node:test';
import assert from 'node:assert/strict';

import { shouldGenerateDailyNewsOnRead } from './dailyNewsReadPolicy.ts';

test('shouldGenerateDailyNewsOnRead only allows automatic generation outside production', () => {
    assert.equal(shouldGenerateDailyNewsOnRead('development'), true);
    assert.equal(shouldGenerateDailyNewsOnRead('test'), true);
    assert.equal(shouldGenerateDailyNewsOnRead('production'), false);
});
