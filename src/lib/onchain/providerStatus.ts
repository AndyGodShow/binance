import type {
    OnchainFallbackReason,
    OnchainSourceState,
    OnchainSourceStatuses,
} from './types';

export interface SettledOnchainSource<T> extends OnchainSourceState {
    data: T;
}

export function sourceStateOf<T>({ status, error }: SettledOnchainSource<T>): OnchainSourceState {
    return { status, ...(error ? { error } : {}) };
}

export function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

export function settleOnchainSource<T extends { length: number }>(
    data: T,
    error?: unknown,
): SettledOnchainSource<T> {
    if (error !== undefined) {
        return {
            status: 'failed',
            data,
            error: errorMessage(error),
        };
    }

    return { status: data.length === 0 ? 'empty' : 'ok', data };
}

export function buildFallbackSourceStatuses(reason: OnchainFallbackReason): OnchainSourceStatuses {
    const failed: OnchainSourceState = { status: 'failed' };
    if (reason === 'upstream_request_failed') {
        return { dex: failed, metrics: failed, history: failed, topHolders: failed };
    }

    const unavailable: OnchainSourceState = { status: 'unavailable' };
    if (reason === 'metrics_unavailable') {
        return { dex: { status: 'ok' }, metrics: failed, history: unavailable, topHolders: unavailable };
    }

    return { dex: unavailable, metrics: unavailable, history: unavailable, topHolders: unavailable };
}
