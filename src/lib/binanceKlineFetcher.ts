import { fetchBinanceJson } from './binanceApi.ts';

interface KlineFetchPlanInput {
    interval: string;
    startTime?: number;
    endTime?: number;
    limit: number;
}

export interface KlineFetchPlanEntry {
    startTime?: number;
    endTime?: number;
    limit: number;
}

const MAX_KLINE_CHUNK_LIMIT = 250;

export function getKlineIntervalMs(interval: string): number | null {
    const match = interval.match(/^(\d+)([mhdwM])$/);
    if (!match) {
        return null;
    }

    const value = Number.parseInt(match[1], 10);
    const unit = match[2];
    const unitMs: Record<string, number> = {
        m: 60 * 1000,
        h: 60 * 60 * 1000,
        d: 24 * 60 * 60 * 1000,
        w: 7 * 24 * 60 * 60 * 1000,
        M: 30 * 24 * 60 * 60 * 1000,
    };

    return value * unitMs[unit];
}

export function buildKlineFetchPlan(input: KlineFetchPlanInput): KlineFetchPlanEntry[] {
    const { startTime, endTime, limit } = input;
    const normalizedLimit = Math.max(1, Math.min(limit, 1500));
    const intervalMs = getKlineIntervalMs(input.interval);

    if (
        !Number.isFinite(startTime) ||
        !Number.isFinite(endTime) ||
        !intervalMs ||
        normalizedLimit <= MAX_KLINE_CHUNK_LIMIT
    ) {
        return [{
            startTime,
            endTime,
            limit: normalizedLimit,
        }];
    }

    const requestedCandles = Math.max(
        1,
        Math.min(
            normalizedLimit,
            Math.floor(((endTime as number) - (startTime as number)) / intervalMs) + 1
        )
    );

    if (requestedCandles <= MAX_KLINE_CHUNK_LIMIT) {
        return [{
            startTime,
            endTime,
            limit: requestedCandles,
        }];
    }

    const plan: KlineFetchPlanEntry[] = [];
    let remainingCandles = requestedCandles;
    let cursor = startTime as number;

    while (remainingCandles > 0) {
        const chunkLimit = Math.min(MAX_KLINE_CHUNK_LIMIT, remainingCandles);
        const chunkEnd = Math.min((endTime as number), cursor + (intervalMs * chunkLimit) - 1);

        plan.push({
            startTime: cursor,
            endTime: chunkEnd,
            limit: chunkLimit,
        });

        cursor = chunkEnd + 1;
        remainingCandles -= chunkLimit;
    }

    return plan;
}

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function fetchBinanceKlines(path: string, options: KlineFetchPlanInput): Promise<unknown[]> {
    const plan = buildKlineFetchPlan(options);

    if (plan.length === 1) {
        const data = await fetchBinanceJson<unknown>(path, { revalidate: 60 });
        return Array.isArray(data) ? data : [];
    }

    const merged: unknown[] = [];

    for (let index = 0; index < plan.length; index += 1) {
        const entry = plan[index];
        const params = new URLSearchParams({
            ...Object.fromEntries(new URL(path, 'https://example.invalid').searchParams.entries()),
            limit: String(entry.limit),
        });

        if (entry.startTime !== undefined) {
            params.set('startTime', String(entry.startTime));
        }
        if (entry.endTime !== undefined) {
            params.set('endTime', String(entry.endTime));
        }

        const basePath = path.split('?')[0] || path;
        const data = await fetchBinanceJson<unknown>(`${basePath}?${params.toString()}`, {
            revalidate: 60,
        });

        if (Array.isArray(data)) {
            merged.push(...data);
        }

        if (index < plan.length - 1) {
            await sleep(120);
        }
    }

    return merged;
}
