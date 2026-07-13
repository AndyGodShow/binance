export interface RateLimitResult {
    allowed: boolean;
    remaining: number;
    retryAfterSeconds: number;
}

interface WindowEntry {
    startedAt: number;
    count: number;
}

export function createFixedWindowRateLimiter(options: {
    limit: number;
    windowMs: number;
    maxKeys?: number;
    now?: () => number;
}) {
    const entries = new Map<string, WindowEntry>();
    const limit = Math.max(1, Math.floor(options.limit));
    const windowMs = Math.max(1, Math.floor(options.windowMs));
    const maxKeys = Math.max(1, Math.floor(options.maxKeys ?? 10_000));
    const now = options.now ?? Date.now;

    const check = (key: string): RateLimitResult => {
        const currentTime = now();
        const current = entries.get(key);
        const entry = !current || currentTime - current.startedAt >= windowMs
            ? { startedAt: currentTime, count: 0 }
            : current;

        if (!entries.has(key) && entries.size >= maxKeys) {
            const oldestKey = entries.keys().next().value as string | undefined;
            if (oldestKey !== undefined) entries.delete(oldestKey);
        }

        entries.delete(key);
        entries.set(key, entry);
        if (entry.count >= limit) {
            return {
                allowed: false,
                remaining: 0,
                retryAfterSeconds: Math.max(1, Math.ceil((entry.startedAt + windowMs - currentTime) / 1000)),
            };
        }

        entry.count += 1;
        return { allowed: true, remaining: limit - entry.count, retryAfterSeconds: 0 };
    };

    return { check, size: () => entries.size };
}

interface RedisResult<T> {
    result?: T;
    error?: string;
}

const REDIS_FIXED_WINDOW_SCRIPT = [
    "local count = redis.call('incr', KEYS[1])",
    "if count == 1 then redis.call('pexpire', KEYS[1], ARGV[1]) end",
    "local ttl = redis.call('pttl', KEYS[1])",
    'return { count, ttl }',
].join('\n');

export function createRedisFixedWindowRateLimiter(options: {
    url: string;
    token: string;
    limit: number;
    windowMs: number;
    prefix?: string;
    fetchImpl?: typeof fetch;
}) {
    const fetchImpl = options.fetchImpl ?? fetch;
    const limit = Math.max(1, Math.floor(options.limit));
    const windowMs = Math.max(1, Math.floor(options.windowMs));
    const prefix = options.prefix ?? 'binance-dashboard:rate-limit:market:v1';

    return {
        async check(key: string): Promise<RateLimitResult> {
            const response = await fetchImpl(options.url, {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${options.token}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(['EVAL', REDIS_FIXED_WINDOW_SCRIPT, 1, `${prefix}:${key}`, windowMs]),
                signal: AbortSignal.timeout(3_000),
            });
            const payload = await response.json() as RedisResult<[number, number]>;
            if (!response.ok || payload.error || !Array.isArray(payload.result)) {
                throw new Error(payload.error || `Redis rate limit failed: HTTP ${response.status}`);
            }
            const [count, ttlMs] = payload.result;
            return {
                allowed: count <= limit,
                remaining: Math.max(0, limit - count),
                retryAfterSeconds: count <= limit ? 0 : Math.max(1, Math.ceil(ttlMs / 1000)),
            };
        },
    };
}
