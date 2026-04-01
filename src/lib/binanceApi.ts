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

const MIRROR_STAGGER_MS = 250;

function buildAttemptInit(options: BinanceFetchOptions, signal?: AbortSignal): NextFetchInit {
    const { revalidate, timeoutMs = 8000, init } = options;
    const merged: NextFetchInit = {
        ...(init || {}),
        redirect: 'follow',
    };

    const signals = [
        init?.signal,
        signal,
        AbortSignal.timeout(timeoutMs),
    ].filter(Boolean) as AbortSignal[];

    // Create a fresh timeout signal for every attempt.
    merged.signal = signals.length === 1 ? signals[0] : AbortSignal.any(signals);

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
    const candidateBases = getCandidateBases(path);
    const sharedAbort = new AbortController();
    const scheduledBases = candidateBases.map((_, offset) =>
        candidateBases[(preferredBaseIndex + offset) % candidateBases.length]
    );

    const attempts = scheduledBases.map((base, offset) => (async () => {
        if (offset > 0) {
            await new Promise((resolve) => setTimeout(resolve, offset * MIRROR_STAGGER_MS));
        }

        if (sharedAbort.signal.aborted) {
            throw new Error('Cancelled after another mirror succeeded');
        }

        const url = `${base}${path}`;
        const init = buildAttemptInit(options, sharedAbort.signal);
        const res = await fetch(url, init);
        if (!res.ok) {
            throw new Error(`${url} -> HTTP ${res.status}`);
        }

        const winningIndex = candidateBases.indexOf(base);
        if (winningIndex >= 0) {
            preferredBaseIndex = winningIndex;
        }
        sharedAbort.abort();
        return res;
    })().catch((error) => {
        const message = error instanceof Error ? error.message : String(error);
        errors.push(message);
        throw error;
    }));

    try {
        return await Promise.any(attempts);
    } catch {
        logger.error('All Binance endpoints failed', new Error(errors.join(' | ')), { path });
        throw new Error(`All Binance endpoints failed for ${path}`);
    }
}

export async function fetchBinanceJson<T>(path: string, options: BinanceFetchOptions = {}): Promise<T> {
    const errors: string[] = [];
    const candidateBases = getCandidateBases(path);
    const sharedAbort = new AbortController();
    const scheduledBases = candidateBases.map((_, offset) =>
        candidateBases[(preferredBaseIndex + offset) % candidateBases.length]
    );

    const attempts = scheduledBases.map((base, offset) => (async () => {
        if (offset > 0) {
            await new Promise((resolve) => setTimeout(resolve, offset * MIRROR_STAGGER_MS));
        }

        if (sharedAbort.signal.aborted) {
            throw new Error('Cancelled after another mirror succeeded');
        }

        const url = `${base}${path}`;
        const init = buildAttemptInit(options, sharedAbort.signal);
        const res = await fetch(url, init);
        if (!res.ok) {
            throw new Error(`${url} -> HTTP ${res.status}`);
        }

        let json: T;
        try {
            json = await res.json() as T;
        } catch (parseError) {
            const message = parseError instanceof Error ? parseError.message : String(parseError);
            throw new Error(`${url} -> invalid JSON (${message})`);
        }

        const winningIndex = candidateBases.indexOf(base);
        if (winningIndex >= 0) {
            preferredBaseIndex = winningIndex;
        }
        sharedAbort.abort();
        return json;
    })().catch((error) => {
        const message = error instanceof Error ? error.message : String(error);
        errors.push(message);
        throw error;
    }));

    try {
        return await Promise.any(attempts);
    } catch {
        logger.error('All Binance JSON endpoints failed', new Error(errors.join(' | ')), { path });
        throw new Error(`All Binance JSON endpoints failed for ${path}`);
    }
}
