import assert from 'node:assert/strict';
import test from 'node:test';

import {
    createRedisMarketCoordination,
    type SharedMarketMetadata,
} from './marketCoordination.ts';

const metadata: SharedMarketMetadata = {
    quality: 'enriched',
    symbolCount: 660,
    snapshotAt: 100_000,
    buildState: 'ready',
    updatedAt: 100_100,
};

test('redis market coordination writes expiring metadata and reads it back', async () => {
    const requests: unknown[][] = [];
    const coordination = createRedisMarketCoordination({
        url: 'https://redis.example.com',
        token: 'secret',
        fetchImpl: async (_input, init) => {
            const command = JSON.parse(String(init?.body)) as unknown[];
            requests.push(command);
            if (command[0] === 'GET') {
                return Response.json({ result: JSON.stringify(metadata) });
            }
            return Response.json({ result: 1 });
        },
    });

    await coordination.write(metadata, 900_000);
    const result = await coordination.read();

    assert.equal(requests[0][0], 'EVAL');
    assert.equal(requests[0][3], 'binance-dashboard:market-health:v1');
    assert.equal(requests[0].at(-6), JSON.stringify(metadata));
    assert.equal(requests[0].at(-5), metadata.snapshotAt);
    assert.equal(requests[0].at(-4), metadata.quality);
    assert.equal(requests[0].at(-3), 900_000);
    assert.equal(requests[0].at(-2), metadata.updatedAt);
    assert.equal(requests[0].at(-1), 600_000);
    assert.deepEqual(requests[1], ['GET', 'binance-dashboard:market-health:v1']);
    assert.deepEqual(result, metadata);
});

test('redis market coordination rejects malformed shared metadata', async () => {
    const coordination = createRedisMarketCoordination({
        url: 'https://redis.example.com',
        token: 'secret',
        fetchImpl: async () => Response.json({
            result: JSON.stringify({ quality: 'enriched', symbolCount: -1 }),
        }),
    });

    assert.equal(await coordination.read(), null);
});

test('redis market coordination surfaces upstream errors', async () => {
    const coordination = createRedisMarketCoordination({
        url: 'https://redis.example.com',
        token: 'secret',
        fetchImpl: async () => Response.json({ error: 'redis unavailable' }, { status: 503 }),
    });

    await assert.rejects(coordination.read(), /redis unavailable/);
});
