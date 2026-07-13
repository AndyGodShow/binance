export type SharedMarketQuality = 'enriched' | 'lightweight';
export type SharedMarketBuildState = 'ready' | 'building' | 'stuck' | 'blocked';

export interface SharedMarketMetadata {
    quality: SharedMarketQuality;
    symbolCount: number;
    snapshotAt: number;
    buildState: SharedMarketBuildState;
    updatedAt: number;
}

interface RedisResult<T> {
    result?: T;
    error?: string;
}

const DEFAULT_KEY = 'binance-dashboard:market-health:v1';
const WRITE_IF_NEWER_SCRIPT = [
    "local current = redis.call('get', KEYS[1])",
    'if current then',
    '  local ok, decoded = pcall(cjson.decode, current)',
    '  if ok and decoded.snapshotAt then',
    '    local currentAt = tonumber(decoded.snapshotAt)',
    '    local nextAt = tonumber(ARGV[2])',
    "    if decoded.quality == 'enriched' and ARGV[3] ~= 'enriched' and tonumber(ARGV[5]) - currentAt <= tonumber(ARGV[6]) then return 0 end",
    '    if currentAt > nextAt then return 0 end',
    "    if currentAt == nextAt and decoded.quality == 'enriched' and ARGV[3] ~= 'enriched' then return 0 end",
    '  end',
    'end',
    "redis.call('set', KEYS[1], ARGV[1], 'PX', ARGV[4])",
    'return 1',
].join('\n');

function isSharedMarketMetadata(value: unknown): value is SharedMarketMetadata {
    if (!value || typeof value !== 'object') return false;
    const candidate = value as Partial<SharedMarketMetadata>;
    return (candidate.quality === 'enriched' || candidate.quality === 'lightweight')
        && Number.isInteger(candidate.symbolCount)
        && Number(candidate.symbolCount) > 0
        && typeof candidate.snapshotAt === 'number'
        && Number.isFinite(candidate.snapshotAt)
        && (candidate.buildState === 'ready'
            || candidate.buildState === 'building'
            || candidate.buildState === 'stuck'
            || candidate.buildState === 'blocked')
        && typeof candidate.updatedAt === 'number'
        && Number.isFinite(candidate.updatedAt);
}

export function createRedisMarketCoordination(options: {
    url: string;
    token: string;
    key?: string;
    fetchImpl?: typeof fetch;
}) {
    const fetchImpl = options.fetchImpl ?? fetch;
    const key = options.key ?? DEFAULT_KEY;

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
        async write(metadata: SharedMarketMetadata, ttlMs: number, enrichedProtectForMs = 600_000): Promise<void> {
            await command<number>([
                'EVAL',
                WRITE_IF_NEWER_SCRIPT,
                1,
                key,
                JSON.stringify(metadata),
                metadata.snapshotAt,
                metadata.quality,
                ttlMs,
                metadata.updatedAt,
                enrichedProtectForMs,
            ]);
        },
        async read(): Promise<SharedMarketMetadata | null> {
            const raw = await command<string>(['GET', key]);
            if (!raw) return null;
            try {
                const parsed = JSON.parse(raw) as unknown;
                return isSharedMarketMetadata(parsed) ? parsed : null;
            } catch {
                return null;
            }
        },
    };
}
