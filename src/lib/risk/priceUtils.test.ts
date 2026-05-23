import test from 'node:test';
import assert from 'node:assert/strict';

import { formatPrice } from './priceUtils.ts';

test('formatPrice keeps four significant digits for small strategy prices', () => {
    assert.equal(formatPrice(0.00001234), '0.00001234');
    assert.equal(formatPrice(0.001234), '0.001234');
    assert.equal(formatPrice(0.1234), '0.1234');
});

