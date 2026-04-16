export interface BinanceOpenInterestHistEntry {
    symbol: string;
    sumOpenInterest: string;
    sumOpenInterestValue: string;
    timestamp: number;
}

export interface OpenInterestWindowChangeSnapshot {
    percent: number;
    value: number;
}

export interface OpenInterestFrameSnapshotShape {
    symbol: string;
    asOf: number;
    currentValue: number;
    change15m?: OpenInterestWindowChangeSnapshot;
    change1h?: OpenInterestWindowChangeSnapshot;
    change4h?: OpenInterestWindowChangeSnapshot;
    change24h?: OpenInterestWindowChangeSnapshot;
}

function isBinanceOpenInterestHistEntry(value: unknown): value is BinanceOpenInterestHistEntry {
    return typeof value === 'object' &&
        value !== null &&
        typeof (value as BinanceOpenInterestHistEntry).symbol === 'string' &&
        typeof (value as BinanceOpenInterestHistEntry).sumOpenInterest === 'string' &&
        typeof (value as BinanceOpenInterestHistEntry).sumOpenInterestValue === 'string' &&
        typeof (value as BinanceOpenInterestHistEntry).timestamp === 'number';
}

function toNumericValue(value: string): number | null {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : null;
}

function findClosestAtOrBefore(
    entries: BinanceOpenInterestHistEntry[],
    targetTimestamp: number
): BinanceOpenInterestHistEntry | null {
    for (let index = entries.length - 1; index >= 0; index -= 1) {
        if (entries[index].timestamp <= targetTimestamp) {
            return entries[index];
        }
    }

    return entries[0] || null;
}

function buildWindowChange(
    latestEntry: BinanceOpenInterestHistEntry,
    previousEntry: BinanceOpenInterestHistEntry | null
): OpenInterestWindowChangeSnapshot | undefined {
    if (!previousEntry) {
        return undefined;
    }

    const latestValue = toNumericValue(latestEntry.sumOpenInterestValue);
    const previousValue = toNumericValue(previousEntry.sumOpenInterestValue);

    if (
        latestValue === null ||
        previousValue === null ||
        previousValue <= 0
    ) {
        return undefined;
    }

    return {
        percent: ((latestValue - previousValue) / previousValue) * 100,
        value: latestValue - previousValue,
    };
}

export function buildOpenInterestFrameSnapshot(
    symbol: string,
    entries: BinanceOpenInterestHistEntry[]
): OpenInterestFrameSnapshotShape {
    const normalizedEntries = [...entries]
        .filter(isBinanceOpenInterestHistEntry)
        .sort((a, b) => a.timestamp - b.timestamp);

    if (normalizedEntries.length === 0) {
        return {
            symbol,
            asOf: 0,
            currentValue: 0,
        };
    }

    const latestEntry = normalizedEntries[normalizedEntries.length - 1];
    const latestValue = toNumericValue(latestEntry.sumOpenInterestValue) ?? 0;
    const latestTimestamp = latestEntry.timestamp;

    return {
        symbol,
        asOf: latestTimestamp,
        currentValue: latestValue,
        change15m: buildWindowChange(latestEntry, findClosestAtOrBefore(normalizedEntries, latestTimestamp - 15 * 60 * 1000)),
        change1h: buildWindowChange(latestEntry, findClosestAtOrBefore(normalizedEntries, latestTimestamp - 60 * 60 * 1000)),
        change4h: buildWindowChange(latestEntry, findClosestAtOrBefore(normalizedEntries, latestTimestamp - 4 * 60 * 60 * 1000)),
        change24h: buildWindowChange(latestEntry, findClosestAtOrBefore(normalizedEntries, latestTimestamp - 24 * 60 * 60 * 1000)),
    };
}
