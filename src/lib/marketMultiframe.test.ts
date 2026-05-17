import assert from 'node:assert/strict';
import test from 'node:test';

import { fetchRequestedMultiframeData } from './marketMultiframe.ts';

test('fetchRequestedMultiframeData fetches requested symbols with bounded concurrency', async () => {
    const starts: string[] = [];
    const finishes: string[] = [];
    let active = 0;
    let maxActive = 0;

    const data = await fetchRequestedMultiframeData(
        ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT'],
        {
            concurrency: 2,
            loadArchive: () => null,
            fetchKlines: async (symbol) => {
                starts.push(symbol);
                active += 1;
                maxActive = Math.max(maxActive, active);
                await new Promise((resolve) => setTimeout(resolve, symbol === 'BTCUSDT' ? 20 : 5));
                active -= 1;
                finishes.push(symbol);

                return [
                    [1, '100', '110', '90', '105'],
                    [2, '101', '110', '90', '105'],
                    [3, '102', '110', '90', '105'],
                    [4, '103', '110', '90', '105'],
                    [5, '104', '110', '90', '105'],
                    [6, '105', '110', '90', '105'],
                    [7, '106', '110', '90', '105'],
                    [8, '107', '110', '90', '105'],
                    [9, '108', '110', '90', '105'],
                    [10, '109', '110', '90', '105'],
                    [11, '110', '110', '90', '105'],
                    [12, '111', '110', '90', '105'],
                    [13, '112', '110', '90', '105'],
                    [14, '113', '110', '90', '105'],
                    [15, '114', '110', '90', '105'],
                    [16, '115', '110', '90', '105'],
                    [17, '116', '110', '90', '105'],
                    [18, '117', '110', '90', '105'],
                ];
            },
        }
    );

    assert.equal(maxActive, 2);
    assert.deepEqual(starts, ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT']);
    assert.deepEqual(finishes.sort(), ['BNBUSDT', 'BTCUSDT', 'ETHUSDT', 'SOLUSDT']);
    assert.deepEqual(data.BTCUSDT, { o15m: 117, o1h: 113, o4h: 101 });
    assert.deepEqual(Object.keys(data).sort(), ['BNBUSDT', 'BTCUSDT', 'ETHUSDT', 'SOLUSDT']);
});

test('fetchRequestedMultiframeData falls back to local archive when upstream fails', async () => {
    const data = await fetchRequestedMultiframeData(
        ['BTCUSDT'],
        {
            concurrency: 2,
            loadArchive: () => ({
                klines: [
                    { open: '10' },
                    { open: '11' },
                    { open: '12' },
                    { open: '13' },
                    { open: '14' },
                    { open: '15' },
                    { open: '16' },
                    { open: '17' },
                    { open: '18' },
                    { open: '19' },
                    { open: '20' },
                    { open: '21' },
                    { open: '22' },
                    { open: '23' },
                    { open: '24' },
                    { open: '25' },
                    { open: '26' },
                    { open: '27' },
                ],
            }),
            fetchKlines: async () => {
                throw new Error('upstream reset');
            },
        }
    );

    assert.deepEqual(data.BTCUSDT, { o15m: 27, o1h: 23, o4h: 11 });
});
