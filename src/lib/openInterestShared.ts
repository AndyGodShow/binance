export interface BinanceOpenInterestHistEntry {
    symbol: string;
    sumOpenInterest: string;
    sumOpenInterestValue: string;
    timestamp: number;
}

export function buildOpenInterestHistoryPath(symbol: string, period: string, limit: number): string {
    const params = new URLSearchParams({
        symbol: symbol.toUpperCase(),
        period,
        limit: String(limit),
    });

    return `/futures/data/openInterestHist?${params.toString()}`;
}

export function isBinanceOpenInterestHistEntry(value: unknown): value is BinanceOpenInterestHistEntry {
    return typeof value === 'object' &&
        value !== null &&
        typeof (value as BinanceOpenInterestHistEntry).symbol === 'string' &&
        typeof (value as BinanceOpenInterestHistEntry).sumOpenInterest === 'string' &&
        typeof (value as BinanceOpenInterestHistEntry).sumOpenInterestValue === 'string' &&
        typeof (value as BinanceOpenInterestHistEntry).timestamp === 'number';
}

export function normalizeOpenInterestHistEntries(data: unknown): BinanceOpenInterestHistEntry[] {
    if (!Array.isArray(data)) {
        return [];
    }

    return data
        .filter(isBinanceOpenInterestHistEntry)
        .sort((left, right) => left.timestamp - right.timestamp);
}

export function findClosestAtOrBefore<T extends { timestamp: number }>(
    entries: T[],
    targetTimestamp: number
): T | null {
    for (let index = entries.length - 1; index >= 0; index -= 1) {
        if (entries[index].timestamp <= targetTimestamp) {
            return entries[index];
        }
    }

    return entries[0] || null;
}

export function calculateChangePercent(currentValue: string, previousValue: string): number | undefined {
    const current = Number(currentValue);
    const previous = Number(previousValue);

    if (!Number.isFinite(current) || !Number.isFinite(previous) || previous <= 0) {
        return undefined;
    }

    return ((current - previous) / previous) * 100;
}
