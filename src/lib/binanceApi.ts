import { logger } from './logger.ts';

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

export type BinanceFailureKind =
    | 'ECONNRESET'
    | 'ETIMEDOUT'
    | 'CONNECT_TIMEOUT'
    | 'TLS_TIMEOUT'
    | 'DNS'
    | 'ABORT'
    | `HTTP_${number}`
    | 'FETCH_FAILED'
    | 'INVALID_JSON'
    | 'UNKNOWN';

const BINANCE_RETRY_ROUNDS = 2;
const BINANCE_RETRY_BACKOFF_MS = 500;
const BINANCE_FAILOVER_DELAY_MS = 150;
const RETRYABLE_HTTP_STATUSES = new Set([408, 409, 418, 425, 429, 500, 502, 503, 504]);

interface BinanceRequestContext {
    endpoint: string;
    symbol?: string;
}

interface NormalizedBinanceError {
    message: string;
    kind: BinanceFailureKind;
    retryable: boolean;
}

interface BinanceFailureLogDecision {
    shouldLog: boolean;
    suppressedCount: number;
}

interface FailureLogBucket {
    windowStart: number;
    count: number;
    suppressedCount: number;
}

export function createBinanceFailureLogLimiter(maxLogsPerWindow: number, windowMs: number) {
    const buckets = new Map<string, FailureLogBucket>();

    return {
        take(key: string, now: number = Date.now()): BinanceFailureLogDecision {
            const bucket = buckets.get(key);
            if (!bucket || now - bucket.windowStart > windowMs) {
                const suppressedCount = bucket?.suppressedCount || 0;
                buckets.set(key, { windowStart: now, count: 1, suppressedCount: 0 });
                return { shouldLog: true, suppressedCount };
            }

            if (bucket.count < maxLogsPerWindow) {
                bucket.count += 1;
                return { shouldLog: true, suppressedCount: 0 };
            }

            bucket.suppressedCount += 1;
            return { shouldLog: false, suppressedCount: 0 };
        },
    };
}

const binanceFailureLogLimiter = createBinanceFailureLogLimiter(2, 60_000);
const binanceRetryLogLimiter = createBinanceFailureLogLimiter(1, 60_000);

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

export function classifyBinanceFailureKind(message: string): BinanceFailureKind {
    const normalized = message.toLowerCase();
    const httpStatusMatch = normalized.match(/http (\d{3})/);
    if (httpStatusMatch) {
        return `HTTP_${Number.parseInt(httpStatusMatch[1], 10)}`;
    }
    if (normalized.includes('econnreset')) {
        return 'ECONNRESET';
    }
    if (normalized.includes('und_err_connect_timeout') || normalized.includes('connecttimeout')) {
        return 'CONNECT_TIMEOUT';
    }
    if (normalized.includes('tls') && (normalized.includes('timeout') || normalized.includes('timed out'))) {
        return 'TLS_TIMEOUT';
    }
    if (normalized.includes('etimedout')) {
        return 'ETIMEDOUT';
    }
    if (
        normalized.includes('eai_again') ||
        normalized.includes('enotfound') ||
        normalized.includes('getaddrinfo')
    ) {
        return 'DNS';
    }
    if (normalized.includes('abort') || normalized.includes('aborted')) {
        return 'ABORT';
    }
    if (normalized.includes('fetch failed')) {
        return 'FETCH_FAILED';
    }
    if (normalized.includes('invalid json')) {
        return 'INVALID_JSON';
    }

    return 'UNKNOWN';
}

export function extractBinanceRequestContext(path: string): BinanceRequestContext {
    const [endpoint, rawQuery = ''] = path.split('?');
    const params = new URLSearchParams(rawQuery);
    const symbol = params.get('symbol') || undefined;

    return { endpoint, symbol };
}

export function formatBinanceRequestTarget(context: BinanceRequestContext): string {
    return context.symbol ? `${context.endpoint}?symbol=${context.symbol}` : context.endpoint;
}

export function createBinanceFailureLogKey(
    context: BinanceRequestContext,
    failureKindKey: string,
    scope?: string
): string {
    const key = `${context.endpoint}:${context.symbol || 'all'}:${failureKindKey || 'UNKNOWN'}`;
    return scope ? `${scope}:${key}` : key;
}

export function sanitizeBinanceErrorMessage(message: string): string {
    return message.replace(/https:\/\/[^/\s]+([^?\s]+)(\?[^ ]*)?/g, (_match, endpoint: string, rawQuery?: string) => {
        const params = new URLSearchParams(rawQuery ? rawQuery.slice(1) : '');
        const symbol = params.get('symbol');
        return symbol ? `binance:${endpoint}?symbol=${symbol}` : `binance:${endpoint}`;
    });
}

function collectErrorMessages(error: unknown, depth = 0): string[] {
    if (depth > 2 || !error) {
        return [];
    }

    if (error instanceof Error) {
        const message = sanitizeBinanceErrorMessage(error.message);
        const withCode = 'code' in error && typeof error.code === 'string'
            ? `${message} (${error.code})`
            : message;
        const cause = 'cause' in error ? collectErrorMessages(error.cause, depth + 1) : [];
        return [withCode, ...cause];
    }

    return [String(error)];
}

function normalizeBinanceError(error: unknown): NormalizedBinanceError {
    const message = collectErrorMessages(error).join(' <- ');
    return {
        message,
        kind: classifyBinanceFailureKind(message),
        retryable: isRetryableBinanceErrorMessage(message),
    };
}

function getFailureKindKey(kinds: Iterable<BinanceFailureKind>): string {
    return Array.from(kinds).sort().join(',') || 'UNKNOWN';
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
    const failureKinds = new Set<BinanceFailureKind>();
    const startedAt = Date.now();
    const requestContext = extractBinanceRequestContext(path);

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
                failureKinds.add(normalized.kind);

                if (baseIndex < scheduledBases.length - 1) {
                    await sleep(BINANCE_FAILOVER_DELAY_MS);
                }
            }
        }

        collectedErrors.push(...roundErrors.map((error) => `round${round + 1}:${error.message}`));
        const shouldRetry = round < BINANCE_RETRY_ROUNDS - 1 && roundErrors.some((error) => error.retryable);

        if (shouldRetry) {
            const roundFailureKinds = new Set(roundErrors.map((error) => error.kind));
            const retryLogDecision = binanceRetryLogLimiter.take(createBinanceFailureLogKey(
                requestContext,
                getFailureKindKey(roundFailureKinds),
                `${requestKind}:retry`
            ));
            if (retryLogDecision.shouldLog) {
                logger.warn('Binance base round failed, retrying', {
                    ...requestContext,
                    requestKind,
                    round: round + 1,
                    failureKinds: Array.from(roundFailureKinds),
                    retryableFailures: roundErrors.filter((error) => error.retryable).length,
                    suppressedSimilarFailures: retryLogDecision.suppressedCount,
                });
            }
            await sleep(getRetryBackoffMs(round, roundErrors));
            continue;
        }

        break;
    }

    const errorMessage = collectedErrors.join(' | ') || `Unknown Binance ${requestKind} error`;
    const failureKindKey = getFailureKindKey(failureKinds);
    const logDecision = binanceFailureLogLimiter.take(createBinanceFailureLogKey(requestContext, failureKindKey, requestKind));
    const diagnosticContext = {
        ...requestContext,
        requestKind,
        durationMs: Date.now() - startedAt,
        failureKinds: Array.from(failureKinds),
        suppressedSimilarFailures: logDecision.suppressedCount,
    };
    if (requestKind === 'json') {
        if (logDecision.shouldLog) {
            logger.error('All Binance JSON endpoints failed', new Error(errorMessage), diagnosticContext);
        }
        throw new Error(`All Binance JSON endpoints failed for ${formatBinanceRequestTarget(requestContext)}`);
    }

    if (logDecision.shouldLog) {
        logger.error('All Binance endpoints failed', new Error(errorMessage), diagnosticContext);
    }
    throw new Error(`All Binance endpoints failed for ${formatBinanceRequestTarget(requestContext)}`);
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
