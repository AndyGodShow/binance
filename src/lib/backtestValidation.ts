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
