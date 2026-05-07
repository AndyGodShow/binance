import test from 'node:test';
import assert from 'node:assert/strict';

import { buildOnchainStorageKey } from './presenter.ts';
import type { HistoricalHoldersPoint } from './types.ts';

function buildVisibleHistory(points: HistoricalHoldersPoint[], limit = 7) {
    const sorted = [...points].sort((a, b) => (
        new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
    ));

    return sorted.slice(-limit);
}

test('buildOnchainStorageKey creates stable default cache key', () => {
    assert.equal(
        buildOnchainStorageKey('PEPE'),
        'persistent-swr:v3:onchain:PEPE:default'
    );
});

test('buildVisibleHistory returns latest items in ascending order', () => {
    const points: HistoricalHoldersPoint[] = [
        { timestamp: '2026-04-13T00:00:00.000Z', totalHolders: 3, netHolderChange: 0, holderPercentChange: 0, newHoldersByAcquisition: { swap: 0, transfer: 0, airdrop: 0 }, holdersIn: { whales: 0, sharks: 0, dolphins: 0, fish: 0, octopus: 0, crabs: 0, shrimps: 0 }, holdersOut: { whales: 0, sharks: 0, dolphins: 0, fish: 0, octopus: 0, crabs: 0, shrimps: 0 } },
        { timestamp: '2026-04-11T00:00:00.000Z', totalHolders: 1, netHolderChange: 0, holderPercentChange: 0, newHoldersByAcquisition: { swap: 0, transfer: 0, airdrop: 0 }, holdersIn: { whales: 0, sharks: 0, dolphins: 0, fish: 0, octopus: 0, crabs: 0, shrimps: 0 }, holdersOut: { whales: 0, sharks: 0, dolphins: 0, fish: 0, octopus: 0, crabs: 0, shrimps: 0 } },
        { timestamp: '2026-04-12T00:00:00.000Z', totalHolders: 2, netHolderChange: 0, holderPercentChange: 0, newHoldersByAcquisition: { swap: 0, transfer: 0, airdrop: 0 }, holdersIn: { whales: 0, sharks: 0, dolphins: 0, fish: 0, octopus: 0, crabs: 0, shrimps: 0 }, holdersOut: { whales: 0, sharks: 0, dolphins: 0, fish: 0, octopus: 0, crabs: 0, shrimps: 0 } },
    ];

    const visible = buildVisibleHistory(points, 2);

    assert.deepEqual(visible.map((point) => point.totalHolders), [2, 3]);
});
