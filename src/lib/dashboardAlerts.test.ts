import assert from 'node:assert/strict';
import test from 'node:test';

import {
    hasUsableOpenInterest,
    shouldShowMarketConnectionAlert,
    shouldShowOpenInterestUnavailableAlert,
} from './dashboardAlerts.ts';

test('shouldShowMarketConnectionAlert stays hidden when base market data is rendering', () => {
    assert.equal(
        shouldShowMarketConnectionAlert({
            shouldRunLiveMarketRequests: true,
            marketError: null,
            auxiliaryError: new Error('multiframe failed'),
            processedDataLength: 573,
        }),
        false
    );
});

test('shouldShowMarketConnectionAlert appears when the critical market request fails without renderable data', () => {
    assert.equal(
        shouldShowMarketConnectionAlert({
            shouldRunLiveMarketRequests: true,
            marketError: new Error('market failed'),
            auxiliaryError: null,
            processedDataLength: 0,
        }),
        true
    );
});

test('hasUsableOpenInterest recognizes symbol level open interest values', () => {
    assert.equal(hasUsableOpenInterest([{ symbol: 'BTCUSDT', openInterestValue: '8320000000' }]), true);
    assert.equal(hasUsableOpenInterest([{ symbol: 'ETHUSDT', openInterest: '2180505.078' }]), true);
    assert.equal(hasUsableOpenInterest([{ symbol: 'SOLUSDT' }]), false);
});

test('shouldShowOpenInterestUnavailableAlert hides stale warning when rendered rows have OI values', () => {
    assert.equal(
        shouldShowOpenInterestUnavailableAlert({
            shouldRunLiveMarketRequests: true,
            hasOpenInterestPayload: true,
            isOpenInterestDegraded: true,
            processedData: [{ symbol: 'BTCUSDT', openInterestValue: '8320000000' }],
        }),
        false
    );
});

test('shouldShowOpenInterestUnavailableAlert appears only when degraded OI has no usable values', () => {
    assert.equal(
        shouldShowOpenInterestUnavailableAlert({
            shouldRunLiveMarketRequests: true,
            hasOpenInterestPayload: true,
            isOpenInterestDegraded: true,
            processedData: [{ symbol: 'BTCUSDT' }],
        }),
        true
    );
});
