export function getBacktestIntervalMs(interval: string): number {
    const match = interval.match(/^(\d+)(m|h|d|w|M)$/);
    if (!match) {
        return 0;
    }

    const value = Number.parseInt(match[1], 10);
    switch (match[2]) {
        case 'm':
            return value * 60 * 1000;
        case 'h':
            return value * 60 * 60 * 1000;
        case 'd':
            return value * 24 * 60 * 60 * 1000;
        case 'w':
            return value * 7 * 24 * 60 * 60 * 1000;
        case 'M':
            return value * 30 * 24 * 60 * 60 * 1000;
        default:
            return 0;
    }
}

export function buildExecutionIntervalFallbackCandidates(params: {
    preferredExecutionInterval: string;
    signalInterval: string;
}): string[] {
    const signalMs = getBacktestIntervalMs(params.signalInterval);
    const preferredMs = getBacktestIntervalMs(params.preferredExecutionInterval);
    if (!signalMs || !preferredMs) {
        return [params.preferredExecutionInterval];
    }

    const candidates = ['1m', '5m', '15m', params.signalInterval]
        .filter((candidate, index, list) => list.indexOf(candidate) === index)
        .filter((candidate) => {
            const candidateMs = getBacktestIntervalMs(candidate);
            return candidateMs >= preferredMs && candidateMs <= signalMs;
        })
        .sort((a, b) => getBacktestIntervalMs(a) - getBacktestIntervalMs(b));

    return candidates.length > 0 ? candidates : [params.preferredExecutionInterval];
}
