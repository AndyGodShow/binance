import { randomUUID } from 'node:crypto';

const RELEASE_SCRIPT = [
    "if redis.call('get', KEYS[1]) == ARGV[1] then",
    "  return redis.call('del', KEYS[1])",
    'else',
    '  return 0',
    'end',
].join('\n');

const RENEW_SCRIPT = [
    "if redis.call('get', KEYS[1]) == ARGV[1] then",
    "  return redis.call('pexpire', KEYS[1], ARGV[2])",
    'else',
    '  return 0',
    'end',
].join('\n');

const IS_OWNER_SCRIPT = [
    "if redis.call('get', KEYS[1]) == ARGV[1] then",
    '  return 1',
    'else',
    '  return 0',
    'end',
].join('\n');

interface RedisResult<T> {
    result?: T;
    error?: string;
}

export function createRedisRestLease(options: {
    url: string;
    token: string;
    fetchImpl?: typeof fetch;
    createOwnerToken?: () => string;
}) {
    const fetchImpl = options.fetchImpl ?? fetch;
    const createOwnerToken = options.createOwnerToken ?? randomUUID;

    const command = async <T>(args: unknown[]): Promise<T | null> => {
        const response = await fetchImpl(options.url, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${options.token}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(args),
            signal: AbortSignal.timeout(5_000),
        });
        const payload = await response.json() as RedisResult<T>;
        if (!response.ok || payload.error) {
            throw new Error(payload.error || `Redis REST command failed: HTTP ${response.status}`);
        }
        return payload.result ?? null;
    };

    return {
        async acquire(key: string, ttlMs: number): Promise<string | null> {
            const owner = createOwnerToken();
            const result = await command<string>(['SET', key, owner, 'NX', 'PX', ttlMs]);
            return result === 'OK' ? owner : null;
        },
        async release(key: string, owner: string): Promise<void> {
            await command<number>(['EVAL', RELEASE_SCRIPT, 1, key, owner]);
        },
        async renew(key: string, owner: string, ttlMs: number): Promise<boolean> {
            const result = await command<number>(['EVAL', RENEW_SCRIPT, 1, key, owner, ttlMs]);
            return result === 1;
        },
        async isOwner(key: string, owner: string): Promise<boolean> {
            const result = await command<number>(['EVAL', IS_OWNER_SCRIPT, 1, key, owner]);
            return result === 1;
        },
    };
}
