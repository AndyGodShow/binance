import { logger } from '@/lib/logger';

const DEFAULT_BINANCE_FAPI_BASES = [
    'https://fapi.binance.com',
    'https://fapi1.binance.com',
    'https://fapi2.binance.com',
    'https://fapi3.binance.com',
];

const DEFAULT_BINANCE_DATA_API_BASES = [
    'https://data-api.binance.vision',
];

const ENV_BINANCE_FAPI_BASES = (process.env.BINANCE_FAPI_BASES || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);

const BINANCE_FAPI_BASES = ENV_BINANCE_FAPI_BASES.length > 0
    ? ENV_BINANCE_FAPI_BASES
    : DEFAULT_BINANCE_FAPI_BASES;

let preferredBaseIndex = 0;

type NextFetchInit = RequestInit & {
    next?: {
        revalidate?: number;
    };
};

interface BinanceFetchOptions {
    revalidate?: number;
    timeoutMs?: number;
    init?: NextFetchInit;
}

function buildInit(options: BinanceFetchOptions): NextFetchInit {
    const { revalidate, timeoutMs = 8000, init } = options;
    const merged: NextFetchInit = {
        ...(init || {}),
        redirect: 'follow',
        signal: init?.signal || AbortSignal.timeout(timeoutMs),
    };

    if (typeof revalidate === 'number') {
        merged.next = { ...(init?.next || {}), revalidate };
    }

    return merged;
}

function getCandidateBases(path: string): string[] {
    if (ENV_BINANCE_FAPI_BASES.length > 0) {
        return BINANCE_FAPI_BASES;
    }

    const supportsDataApi = !path.startsWith('/fapi/') && !path.startsWith('/futures/');
    return supportsDataApi
        ? [...DEFAULT_BINANCE_DATA_API_BASES, ...DEFAULT_BINANCE_FAPI_BASES]
        : DEFAULT_BINANCE_FAPI_BASES;
}

export async function fetchBinance(path: string, options: BinanceFetchOptions = {}): Promise<Response> {
    const errors: string[] = [];
    const init = buildInit(options);
    const candidateBases = getCandidateBases(path);

    for (let i = 0; i < candidateBases.length; i++) {
        const idx = (preferredBaseIndex + i) % candidateBases.length;
        const base = candidateBases[idx];
        const url = `${base}${path}`;

        try {
            const res = await fetch(url, init);
            if (res.ok) {
                preferredBaseIndex = idx;
                return res;
            }
            errors.push(`${url} -> HTTP ${res.status}`);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            errors.push(`${url} -> ${message}`);
        }
    }

    logger.error('All Binance endpoints failed', new Error(errors.join(' | ')), { path });
    throw new Error(`All Binance endpoints failed for ${path}`);
}

export async function fetchBinanceJson<T>(path: string, options: BinanceFetchOptions = {}): Promise<T> {
    const errors: string[] = [];
    const init = buildInit(options);
    const candidateBases = getCandidateBases(path);

    for (let i = 0; i < candidateBases.length; i++) {
        const idx = (preferredBaseIndex + i) % candidateBases.length;
        const base = candidateBases[idx];
        const url = `${base}${path}`;

        try {
            const res = await fetch(url, init);
            if (!res.ok) {
                errors.push(`${url} -> HTTP ${res.status}`);
                continue;
            }
            try {
                const json = await res.json() as T;
                preferredBaseIndex = idx;
                return json;
            } catch (parseError) {
                const message = parseError instanceof Error ? parseError.message : String(parseError);
                errors.push(`${url} -> invalid JSON (${message})`);
            }
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            errors.push(`${url} -> ${message}`);
        }
    }

    logger.error('All Binance JSON endpoints failed', new Error(errors.join(' | ')), { path });
    throw new Error(`All Binance JSON endpoints failed for ${path}`);
}
