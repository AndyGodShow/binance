const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_DOWNLOAD_RANGE_DAYS = 366;
const SYMBOL_PATTERN = /^[A-Z0-9]{2,20}$/;

export type DataDownloadType = 'metrics' | 'fundingRate';

export interface DataDownloadRequestPayload {
    symbol: string | null | undefined;
    type: string | null | undefined;
    startDate: string | null | undefined;
    endDate: string | null | undefined;
}

type AuthorizationSuccess = { ok: true };
type AuthorizationFailure = { ok: false; status: number; error: string };

export type DataDownloadAuthorizationResult = AuthorizationSuccess | AuthorizationFailure;

type ValidationSuccess = {
    ok: true;
    value: {
        symbol: string;
        type: DataDownloadType;
        startDate: string;
        endDate: string;
    };
};

type ValidationFailure = {
    ok: false;
    error: string;
};

export type DataDownloadValidationResult = ValidationSuccess | ValidationFailure;

function parseUtcDate(date: string): number {
    const match = date.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) {
        return Number.NaN;
    }

    return Date.UTC(
        Number.parseInt(match[1], 10),
        Number.parseInt(match[2], 10) - 1,
        Number.parseInt(match[3], 10)
    );
}

export function authorizeDataDownloadRequest(
    authorizationHeader: string | null,
    options: { nodeEnv?: string; token?: string | null }
): DataDownloadAuthorizationResult {
    const token = options.token?.trim();

    if (!token) {
        if (options.nodeEnv === 'production') {
            return {
                ok: false,
                status: 503,
                error: 'DATA_DOWNLOAD_TOKEN is required in production',
            };
        }

        return { ok: true };
    }

    if (authorizationHeader === `Bearer ${token}`) {
        return { ok: true };
    }

    return {
        ok: false,
        status: 401,
        error: 'Unauthorized',
    };
}

export function validateDataDownloadRequest(payload: DataDownloadRequestPayload): DataDownloadValidationResult {
    const symbol = payload.symbol?.trim().toUpperCase();
    const type = payload.type?.trim();
    const startDate = payload.startDate?.trim();
    const endDate = payload.endDate?.trim();

    if (!symbol || !type || !startDate || !endDate) {
        return { ok: false, error: 'Missing parameters' };
    }

    if (!SYMBOL_PATTERN.test(symbol)) {
        return { ok: false, error: 'Invalid symbol' };
    }

    if (type !== 'metrics' && type !== 'fundingRate') {
        return { ok: false, error: 'Invalid type' };
    }

    const start = parseUtcDate(startDate);
    const end = parseUtcDate(endDate);

    if (!Number.isFinite(start) || !Number.isFinite(end)) {
        return { ok: false, error: 'Invalid date format' };
    }

    if (start > end) {
        return { ok: false, error: 'Invalid date range' };
    }

    const days = Math.floor((end - start) / DAY_MS) + 1;
    if (days > MAX_DOWNLOAD_RANGE_DAYS) {
        return { ok: false, error: `Date range exceeds ${MAX_DOWNLOAD_RANGE_DAYS} days` };
    }

    return {
        ok: true,
        value: {
            symbol,
            type,
            startDate,
            endDate,
        },
    };
}
