import {
    calculateChangePercent,
    findClosestAtOrBefore,
    normalizeOpenInterestHistEntries,
    type BinanceOpenInterestHistEntry,
} from './openInterestShared.ts';

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

function toNumericValue(value: string): number | null {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : null;
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
        percent: calculateChangePercent(latestEntry.sumOpenInterestValue, previousEntry.sumOpenInterestValue) ?? 0,
        value: latestValue - previousValue,
    };
}

export function buildOpenInterestFrameSnapshot(
    symbol: string,
    entries: BinanceOpenInterestHistEntry[]
): OpenInterestFrameSnapshotShape {
    const normalizedEntries = normalizeOpenInterestHistEntries(entries);

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
