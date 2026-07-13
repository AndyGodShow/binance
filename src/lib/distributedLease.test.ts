import assert from 'node:assert/strict';
import test from 'node:test';

import { createRedisRestLease } from './distributedLease.ts';

test('redis lease acquires with SET NX PX and releases only its owner token', async () => {
    const commands: unknown[][] = [];
    const lease = createRedisRestLease({
        url: 'https://redis.example.com',
        token: 'secret',
        fetchImpl: async (_url, init) => {
            const command = JSON.parse(String(init?.body)) as unknown[];
            commands.push(command);
            return Response.json({ result: command[0] === 'SET' ? 'OK' : 1 });
        },
        createOwnerToken: () => 'owner-1',
    });

    const owner = await lease.acquire('market-build', 240_000);
    assert.equal(owner, 'owner-1');
    await lease.release('market-build', owner!);
    assert.deepEqual(commands[0], ['SET', 'market-build', 'owner-1', 'NX', 'PX', 240000]);
    assert.equal(commands[1][0], 'EVAL');
    assert.equal(commands[1].at(-1), 'owner-1');
});

test('redis lease returns null when another producer owns the key', async () => {
    const lease = createRedisRestLease({
        url: 'https://redis.example.com',
        token: 'secret',
        fetchImpl: async () => Response.json({ result: null }),
    });

    assert.equal(await lease.acquire('market-build', 240_000), null);
});

test('redis lease renews only while the same owner still holds the key', async () => {
    const commands: unknown[][] = [];
    const lease = createRedisRestLease({
        url: 'https://redis.example.com',
        token: 'secret',
        fetchImpl: async (_url, init) => {
            const command = JSON.parse(String(init?.body)) as unknown[];
            commands.push(command);
            return Response.json({ result: 1 });
        },
    });

    assert.equal(await lease.renew('market-build', 'owner-1', 260_000), true);
    assert.equal(commands[0][0], 'EVAL');
    assert.equal(commands[0].at(-2), 'owner-1');
    assert.equal(commands[0].at(-1), 260_000);
});

test('redis lease ownership check returns false after ownership is lost', async () => {
    const lease = createRedisRestLease({
        url: 'https://redis.example.com',
        token: 'secret',
        fetchImpl: async () => Response.json({ result: 0 }),
    });

    assert.equal(await lease.isOwner('market-build', 'owner-1'), false);
});
