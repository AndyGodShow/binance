import assert from 'node:assert/strict';
import test from 'node:test';

import { createFixedWindowRateLimiter, createRedisFixedWindowRateLimiter } from './rateLimit.ts';

test('fixed window limiter allows the budget and rejects excess requests with retry metadata', () => {
    let now = 1_000;
    const limiter = createFixedWindowRateLimiter({ limit: 2, windowMs: 10_000, now: () => now });

    assert.deepEqual(limiter.check('client-a'), { allowed: true, remaining: 1, retryAfterSeconds: 0 });
    assert.deepEqual(limiter.check('client-a'), { allowed: true, remaining: 0, retryAfterSeconds: 0 });
    const rejected = limiter.check('client-a');
    assert.equal(rejected.allowed, false);
    assert.equal(rejected.remaining, 0);
    assert.equal(rejected.retryAfterSeconds, 10);

    now = 11_001;
    assert.equal(limiter.check('client-a').allowed, true);
});

test('fixed window limiter isolates clients and bounds retained keys', () => {
    const limiter = createFixedWindowRateLimiter({ limit: 1, windowMs: 1_000, maxKeys: 2, now: () => 0 });

    assert.equal(limiter.check('a').allowed, true);
    assert.equal(limiter.check('b').allowed, true);
    assert.equal(limiter.check('c').allowed, true);
    assert.equal(limiter.size(), 2);
});

test('redis fixed window limiter enforces one shared deployment budget', async () => {
    const commands: unknown[][] = [];
    const limiter = createRedisFixedWindowRateLimiter({
        url: 'https://redis.example.com',
        token: 'secret',
        limit: 2,
        windowMs: 60_000,
        fetchImpl: async (_url, init) => {
            commands.push(JSON.parse(String(init?.body)) as unknown[]);
            return Response.json({ result: [3, 42_500] });
        },
    });

    assert.deepEqual(await limiter.check('client-hash'), {
        allowed: false,
        remaining: 0,
        retryAfterSeconds: 43,
    });
    assert.equal(commands[0][0], 'EVAL');
    assert.equal(commands[0][3], 'binance-dashboard:rate-limit:market:v1:client-hash');
});
