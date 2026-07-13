type SolanaNetwork = 'mainnet' | 'devnet';

export interface ServerEnv {
    nodeEnv: string | undefined;
    isServerless: boolean;
    moralisApiKey: string | undefined;
    solanaNetwork: SolanaNetwork;
    coinalyzeApiKey: string | undefined;
    binanceFapiBases: string[];
    dataDownloadToken: string | undefined;
    bitboApiKey: string | undefined;
    marketArchiveRoot: string | undefined;
    debugKlineCache: boolean;
    redisRestUrl: string | undefined;
    redisRestToken: string | undefined;
}

type EnvSource = Readonly<Record<string, string | undefined>>;

function optionalValue(value: string | undefined): string | undefined {
    const normalized = value?.trim();
    return normalized ? normalized : undefined;
}

function parseSolanaNetwork(value: string | undefined): SolanaNetwork {
    const normalized = optionalValue(value) ?? 'mainnet';
    if (normalized !== 'mainnet' && normalized !== 'devnet') {
        throw new Error('SOLANA_NETWORK must be either mainnet or devnet');
    }
    return normalized;
}

function parseBinanceBases(value: string | undefined): string[] {
    return (value ?? '')
        .split(',')
        .map((entry) => entry.trim())
        .filter(Boolean)
        .map((entry) => {
            let url: URL;
            try {
                url = new URL(entry);
            } catch {
                throw new Error(`BINANCE_FAPI_BASES entry is not a valid HTTPS URL: ${entry}`);
            }
            if (url.protocol !== 'https:') {
                throw new Error(`BINANCE_FAPI_BASES entries must use HTTPS: ${entry}`);
            }
            return entry;
        });
}

export function readRuntimeEnv(env: EnvSource = process.env) {
    return {
        nodeEnv: optionalValue(env.NODE_ENV),
        isServerless: Boolean(env.VERCEL || env.AWS_LAMBDA_FUNCTION_NAME || env.SERVERLESS),
    };
}

export function readBinanceEnv(env: EnvSource = process.env) {
    return {
        binanceFapiBases: parseBinanceBases(env.BINANCE_FAPI_BASES),
        debugKlineCache: env.DEBUG_KLINE_CACHE === '1',
    };
}

export function readOnchainEnv(env: EnvSource = process.env) {
    return {
        moralisApiKey: optionalValue(env.MORALIS_API_KEY),
        solanaNetwork: parseSolanaNetwork(env.SOLANA_NETWORK),
    };
}

export function readRedisEnv(env: EnvSource = process.env) {
    return {
        redisRestUrl: optionalValue(env.UPSTASH_REDIS_REST_URL) ?? optionalValue(env.KV_REST_API_URL),
        redisRestToken: optionalValue(env.UPSTASH_REDIS_REST_TOKEN) ?? optionalValue(env.KV_REST_API_TOKEN),
    };
}

export function readCoinalyzeEnv(env: EnvSource = process.env) {
    return { coinalyzeApiKey: optionalValue(env.COINALYZE_API_KEY) };
}

export function readDataDownloadEnv(env: EnvSource = process.env) {
    return { dataDownloadToken: optionalValue(env.DATA_DOWNLOAD_TOKEN) };
}

export function readMacroEnv(env: EnvSource = process.env) {
    return { bitboApiKey: optionalValue(env.BITBO_API_KEY) };
}

export function readArchiveEnv(env: EnvSource = process.env) {
    return { marketArchiveRoot: optionalValue(env.MARKET_ARCHIVE_ROOT) };
}

export function readServerEnv(
    env: EnvSource = process.env,
): ServerEnv {
    const runtime = readRuntimeEnv(env);
    const onchain = readOnchainEnv(env);
    const binance = readBinanceEnv(env);
    const redis = readRedisEnv(env);
    return {
        ...runtime,
        ...onchain,
        coinalyzeApiKey: optionalValue(env.COINALYZE_API_KEY),
        ...binance,
        dataDownloadToken: optionalValue(env.DATA_DOWNLOAD_TOKEN),
        bitboApiKey: optionalValue(env.BITBO_API_KEY),
        marketArchiveRoot: optionalValue(env.MARKET_ARCHIVE_ROOT),
        ...redis,
    };
}
