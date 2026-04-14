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

const BINANCE_RETRY_ROUNDS = 2;
const BINANCE_RETRY_BACKOFF_MS = 500;
const BINANCE_FAILOVER_DELAY_MS = 150;
const RETRYABLE_HTTP_STATUSES = new Set([408, 409, 418, 425, 429, 500, 502, 503, 504]);

interface NormalizedBinanceError {
    message: string;
    retryable: boolean;
}

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableBinanceErrorMessage(message: string): boolean {
    const normalized = message.toLowerCase();
    const httpStatusMatch = normalized.match(/http (\d{3})/);
    if (httpStatusMatch) {
        const status = Number.parseInt(httpStatusMatch[1], 10);
        if (RETRYABLE_HTTP_STATUSES.has(status)) {
            return true;
        }
        if (status >= 400 && status < 500) {
            return false;
        }
    }

    return [
        'fetch failed',
        'econnreset',
        'timed out',
        'timeout',
        'socket',
        'tls connection',
        'eai_again',
        'enotfound',
        'terminated',
        'invalid json',
    ].some((pattern) => normalized.includes(pattern));
}

function normalizeBinanceError(error: unknown): NormalizedBinanceError {
    const message = error instanceof Error ? error.message : String(error);
    return {
        message,
        retryable: isRetryableBinanceErrorMessage(message),
    };
}

function getScheduledBases(candidateBases: string[]): string[] {
    return candidateBases.map((_, offset) =>
        candidateBases[(preferredBaseIndex + offset) % candidateBases.length]
    );
}

function getRetryBackoffMs(round: number, errors: NormalizedBinanceError[]): number {
    const hitRateLimit = errors.some((error) => /http (418|429)\b/i.test(error.message));
    const baseDelay = hitRateLimit ? 2000 : BINANCE_RETRY_BACKOFF_MS;
    return baseDelay * (round + 1);
}

async function runMirroredRequest<T>(
    path: string,
    options: BinanceFetchOptions,
    requestKind: 'response' | 'json',
    executor: (url: string, init: NextFetchInit) => Promise<T>
): Promise<T> {
    const candidateBases = getCandidateBases(path);
    const collectedErrors: string[] = [];

    for (let round = 0; round < BINANCE_RETRY_ROUNDS; round += 1) {
        const roundErrors: NormalizedBinanceError[] = [];
        const scheduledBases = getScheduledBases(candidateBases);

        for (let baseIndex = 0; baseIndex < scheduledBases.length; baseIndex += 1) {
            const base = scheduledBases[baseIndex];
            const url = `${base}${path}`;

            try {
                const init = buildAttemptInit(options);
                const result = await executor(url, init);

                const winningIndex = candidateBases.indexOf(base);
                if (winningIndex >= 0) {
                    preferredBaseIndex = winningIndex;
                }

                return result;
            } catch (error) {
                const normalized = normalizeBinanceError(error);
                roundErrors.push(normalized);

                if (baseIndex < scheduledBases.length - 1) {
                    await sleep(BINANCE_FAILOVER_DELAY_MS);
                }
            }
        }

        collectedErrors.push(...roundErrors.map((error) => `round${round + 1}:${error.message}`));
        const shouldRetry = round < BINANCE_RETRY_ROUNDS - 1 && roundErrors.some((error) => error.retryable);

        if (shouldRetry) {
            logger.warn('Binance base round failed, retrying', {
                path,
                requestKind,
                round: round + 1,
                errors: roundErrors.map((error) => error.message),
            });
            await sleep(getRetryBackoffMs(round, roundErrors));
            continue;
        }

        break;
    }

    const errorMessage = collectedErrors.join(' | ') || `Unknown Binance ${requestKind} error`;
    if (requestKind === 'json') {
        logger.error('All Binance JSON endpoints failed', new Error(errorMessage), { path });
        throw new Error(`All Binance JSON endpoints failed for ${path}`);
    }

    logger.error('All Binance endpoints failed', new Error(errorMessage), { path });
    throw new Error(`All Binance endpoints failed for ${path}`);
}

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
    return runMirroredRequest(path, options, 'response', async (url, init) => {
        const response = await fetch(url, init);
        if (!response.ok) {
            throw new Error(`${url} -> HTTP ${response.status}`);
        }
        return response;
    });
}

export async function fetchBinanceJson<T>(path: string, options: BinanceFetchOptions = {}): Promise<T> {
    return runMirroredRequest(path, options, 'json', async (url, init) => {
        const response = await fetch(url, init);
        if (!response.ok) {
            throw new Error(`${url} -> HTTP ${response.status}`);
        }

        try {
            return await response.json() as T;
        } catch (parseError) {
            const message = parseError instanceof Error ? parseError.message : String(parseError);
            throw new Error(`${url} -> invalid JSON (${message})`);
        }
    });
}
