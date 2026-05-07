import test from 'node:test';
import assert from 'node:assert/strict';

import {
    buildHolderConcentration,
    classifyHolderAddress,
} from './addressClassifier.ts';
import type { TopHolderItem } from './types.ts';

function holder(overrides: Partial<TopHolderItem>): TopHolderItem {
    return {
        address: '0xabc',
        label: null,
        entity: null,
        percentage: 1,
        balance: null,
        usdValue: null,
        isContract: false,
        ...overrides,
    };
}

test('classifyHolderAddress identifies burn addresses', () => {
    const classified = classifyHolderAddress(holder({
        address: '0x000000000000000000000000000000000000dEaD',
        percentage: 12,
    }));

    assert.equal(classified.class, 'burn');
    assert.equal(classified.confidence, 'high');
});

test('classifyHolderAddress identifies CEX labels', () => {
    const classified = classifyHolderAddress(holder({
        address: '0xcex',
        label: 'Binance Hot Wallet',
        percentage: 18,
    }));

    assert.equal(classified.class, 'cex');
    assert.equal(classified.confidence, 'high');
});

test('classifyHolderAddress identifies LP pool labels', () => {
    const classified = classifyHolderAddress(holder({
        address: '0xpool',
        label: 'Uniswap V2 Pair',
        isContract: true,
        percentage: 22,
    }));

    assert.equal(classified.class, 'lp_pool');
    assert.equal(classified.confidence, 'high');
});

test('classifyHolderAddress identifies staking vesting and treasury labels', () => {
    assert.equal(classifyHolderAddress(holder({ label: 'Staking Vault', isContract: true })).class, 'staking');
    assert.equal(classifyHolderAddress(holder({ label: 'Team Vesting Contract', isContract: true })).class, 'vesting');
    assert.equal(classifyHolderAddress(holder({ entity: 'Foundation Treasury' })).class, 'treasury');
});

test('classifyHolderAddress falls back to contract or unknown when labels are missing', () => {
    assert.equal(classifyHolderAddress(holder({ isContract: true })).class, 'contract');
    assert.equal(classifyHolderAddress(holder({ isContract: false })).class, 'unknown');
});

test('buildHolderConcentration excludes infrastructure addresses from float TopN', () => {
    const concentration = buildHolderConcentration([
        holder({ address: '0xpool', label: 'Uniswap Pool', isContract: true, percentage: 30 }),
        holder({ address: '0xdead', label: 'Burn Address', percentage: 20 }),
        holder({ address: '0xbinance', label: 'Binance', percentage: 15 }),
        holder({ address: '0xuser1', label: 'Wallet 1', percentage: 8 }),
        holder({ address: '0xuser2', label: 'Wallet 2', percentage: 5 }),
        holder({ address: '0xunknown', percentage: 4 }),
    ]);

    assert.equal(concentration.rawTop5, 78);
    assert.equal(concentration.floatTop5, 17);
    assert.deepEqual(
        concentration.excludedTopHolders.map((item) => item.class),
        ['lp_pool', 'burn', 'cex']
    );
});

test('buildHolderConcentration reports unknown and excluded pollution shares', () => {
    const concentration = buildHolderConcentration([
        holder({ address: '0xpool', label: 'Pancake Pair', isContract: true, percentage: 45 }),
        holder({ address: '0xunknown1', percentage: 20 }),
        holder({ address: '0xunknown2', percentage: 15 }),
        holder({ address: '0xuser', label: 'Wallet', percentage: 5 }),
    ]);

    assert.equal(concentration.excludedSharePercent, 45);
    assert.equal(concentration.unknownSharePercent, 35);
    assert.match(concentration.warnings.join(' '), /未知地址占比|原始集中度/);
});
