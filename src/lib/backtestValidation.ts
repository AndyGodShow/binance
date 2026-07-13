function isObjectRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
}

export function shouldDeferBacktestValidationFailure(status: number, payload: unknown): boolean {
    if (status === 429 || status === 503) {
        return true;
    }

    if (status < 500) {
        return false;
    }

    return isObjectRecord(payload) && payload.retryable === true;
}

export type BacktestValidationProbeStatus = 'passed' | 'failed' | 'deferred';

export type BacktestValidationProbeInput =
    | { kind: 'response'; httpStatus: number; ok: boolean; payload: unknown }
    | { kind: 'network-error'; reason?: string };

export function classifyBacktestValidationProbe(input: BacktestValidationProbeInput): {
    status: BacktestValidationProbeStatus;
    reason?: string;
} {
    if (input.kind === 'network-error') {
        return { status: 'deferred', ...(input.reason ? { reason: input.reason } : {}) };
    }

    if (input.ok) {
        const data = isObjectRecord(input.payload) ? input.payload.data : null;
        return Array.isArray(data) && data.length > 0
            ? { status: 'passed' }
            : { status: 'failed', reason: '没有可用 K 线数据' };
    }

    if (shouldDeferBacktestValidationFailure(input.httpStatus, input.payload)) {
        return { status: 'deferred' };
    }

    const payloadMessage = isObjectRecord(input.payload)
        ? (typeof input.payload.error === 'string' ? input.payload.error : input.payload.details)
        : null;
    return {
        status: 'failed',
        reason: typeof payloadMessage === 'string' ? payloadMessage : `HTTP ${input.httpStatus}`,
    };
}

export function createLatestRunGuard(): {
    begin: () => number;
    isCurrent: (token: number) => boolean;
} {
    let current = 0;
    return {
        begin: () => {
            current += 1;
            return current;
        },
        isCurrent: (token) => token === current,
    };
}
