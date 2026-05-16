export type ValidationResult<T> =
    | { ok: true; value: T }
    | { ok: false; details: string };

const FUTURES_SYMBOL_PATTERN = /^[A-Z0-9]{2,20}USDT$/;
const BACKTEST_INTERVALS = new Set(['1m', '3m', '5m', '15m', '30m', '1h', '2h', '4h', '6h', '8h', '12h', '1d']);
const LONG_SHORT_PERIODS = new Set(['5m', '15m', '30m', '1h', '2h', '4h', '6h', '12h', '1d']);
const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const MAX_BACKTEST_RANGE_MS = 365 * ONE_DAY_MS;
const MIN_MS_TIMESTAMP = 1_000_000_000_000;
const MAX_MS_TIMESTAMP = 9_999_999_999_999;

export interface BacktestKlinesParams {
    symbol: string;
    interval: string;
    startTime?: number;
    endTime?: number;
    limit: number;
    includeAuxiliary: boolean;
}

export interface LongShortParams {
    symbol: string;
    period: string;
    limit: number;
}

export interface OnchainDashboardParams {
    keyword: string;
    tokenAddress: string | null;
    chainId: string | null;
    scope: 'alpha' | 'contracts';
}

function invalid(details: string): ValidationResult<never> {
    return { ok: false, details };
}

export function invalidRequestBody(details: string) {
    return {
        success: false,
        error: 'Invalid request parameters',
        details,
    };
}

export function normalizeFuturesSymbol(value: string | null, fallback?: string): ValidationResult<string> {
    const raw = value ?? fallback;
    if (typeof raw !== 'string' || raw.trim().length === 0) {
        return invalid('symbol is required');
    }

    const symbol = raw.trim().toUpperCase();
    if (!FUTURES_SYMBOL_PATTERN.test(symbol)) {
        return invalid('symbol must match Binance USDT futures format');
    }

    return { ok: true, value: symbol };
}

function parseIntegerParam(
    searchParams: URLSearchParams,
    key: string,
    options: { defaultValue: number; min: number; max: number }
): ValidationResult<number> {
    const raw = searchParams.get(key);
    if (raw === null || raw.trim() === '') {
        return { ok: true, value: options.defaultValue };
    }

    if (!/^\d+$/.test(raw.trim())) {
        return invalid(`${key} must be an integer`);
    }

    const value = Number.parseInt(raw, 10);
    if (!Number.isSafeInteger(value) || value < options.min || value > options.max) {
        return invalid(`${key} must be between ${options.min} and ${options.max}`);
    }

    return { ok: true, value };
}

function parseTimestamp(searchParams: URLSearchParams, key: string): ValidationResult<number | undefined> {
    const raw = searchParams.get(key);
    if (raw === null || raw.trim() === '') {
        return { ok: true, value: undefined };
    }

    if (!/^\d+$/.test(raw.trim())) {
        return invalid(`${key} must be a millisecond timestamp`);
    }

    const value = Number.parseInt(raw, 10);
    if (!Number.isFinite(value) || value < MIN_MS_TIMESTAMP || value > MAX_MS_TIMESTAMP) {
        return invalid(`${key} must be a millisecond timestamp`);
    }

    return { ok: true, value };
}

export function validateSymbolsParam(
    searchParams: URLSearchParams,
    options: { maxSymbols: number }
): ValidationResult<string[]> {
    const raw = searchParams.get('symbols');
    if (!raw || raw.trim().length === 0) {
        return { ok: true, value: [] };
    }

    const symbols: string[] = [];
    const seen = new Set<string>();
    for (const part of raw.split(',')) {
        const symbolResult = normalizeFuturesSymbol(part);
        if (!symbolResult.ok) {
            return symbolResult;
        }

        if (!seen.has(symbolResult.value)) {
            seen.add(symbolResult.value);
            symbols.push(symbolResult.value);
        }
    }

    if (symbols.length > options.maxSymbols) {
        return invalid(`symbols cannot include more than ${options.maxSymbols} entries`);
    }

    return { ok: true, value: symbols };
}

export function validateBacktestKlinesParams(searchParams: URLSearchParams): ValidationResult<BacktestKlinesParams> {
    const symbol = normalizeFuturesSymbol(searchParams.get('symbol'));
    if (!symbol.ok) return symbol;

    const interval = searchParams.get('interval') || '1h';
    if (!BACKTEST_INTERVALS.has(interval)) {
        return invalid('interval is not supported');
    }

    const limit = parseIntegerParam(searchParams, 'limit', { defaultValue: 500, min: 1, max: 1500 });
    if (!limit.ok) return limit;

    const startTime = parseTimestamp(searchParams, 'startTime');
    if (!startTime.ok) return startTime;

    const endTime = parseTimestamp(searchParams, 'endTime');
    if (!endTime.ok) return endTime;

    if (startTime.value !== undefined && endTime.value !== undefined) {
        if (startTime.value >= endTime.value) {
            return invalid('startTime must be earlier than endTime');
        }
        if (endTime.value - startTime.value > MAX_BACKTEST_RANGE_MS) {
            return invalid('time range cannot exceed 365 days');
        }
    }

    if (startTime.value !== undefined && endTime.value === undefined && Date.now() - startTime.value > MAX_BACKTEST_RANGE_MS) {
        return invalid('time range cannot exceed 365 days');
    }

    return {
        ok: true,
        value: {
            symbol: symbol.value,
            interval,
            startTime: startTime.value,
            endTime: endTime.value,
            limit: limit.value,
            includeAuxiliary: searchParams.get('includeAuxiliary') !== 'false',
        },
    };
}

export function validateLongShortParams(searchParams: URLSearchParams): ValidationResult<LongShortParams> {
    const symbol = normalizeFuturesSymbol(searchParams.get('symbol'), 'BTCUSDT');
    if (!symbol.ok) return symbol;

    const period = searchParams.get('period') || '1h';
    if (!LONG_SHORT_PERIODS.has(period)) {
        return invalid('period is not supported');
    }

    const limit = parseIntegerParam(searchParams, 'limit', { defaultValue: 30, min: 1, max: 500 });
    if (!limit.ok) return limit;

    return {
        ok: true,
        value: {
            symbol: symbol.value,
            period,
            limit: limit.value,
        },
    };
}

export function validateOnchainDashboardParams(searchParams: URLSearchParams): ValidationResult<OnchainDashboardParams> {
    const keyword = (searchParams.get('keyword') || 'PEPE').trim();
    if (keyword.length === 0 || keyword.length > 64) {
        return invalid('keyword must be between 1 and 64 characters');
    }

    if (/[/?#]/.test(keyword)) {
        return invalid('keyword contains unsupported characters');
    }

    const tokenAddress = searchParams.get('tokenAddress');
    if (tokenAddress && (tokenAddress.length > 128 || /[\s/?#]/.test(tokenAddress))) {
        return invalid('tokenAddress contains unsupported characters');
    }

    const chainId = searchParams.get('chainId');
    if (chainId && (chainId.length > 32 || !/^[A-Za-z0-9_-]+$/.test(chainId))) {
        return invalid('chainId contains unsupported characters');
    }

    const rawScope = searchParams.get('scope');
    if (rawScope !== null && rawScope !== 'alpha' && rawScope !== 'contracts') {
        return invalid('scope is not supported');
    }

    return {
        ok: true,
        value: {
            keyword,
            tokenAddress,
            chainId,
            scope: rawScope === 'alpha' ? 'alpha' : 'contracts',
        },
    };
}

export const requestValidationInternals = {
    BACKTEST_INTERVALS,
    LONG_SHORT_PERIODS,
    MAX_BACKTEST_RANGE_MS,
};
