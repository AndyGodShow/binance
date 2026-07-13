export function resolveMarketKlineBatchSize(
    configuredBatchSize: number,
    env: Pick<NodeJS.ProcessEnv, 'NODE_ENV'> = process.env,
): number {
    if (env.NODE_ENV === 'development') {
        return Math.max(1, Math.min(configuredBatchSize, 2));
    }

    return configuredBatchSize;
}

export interface MarketEnrichmentLimits {
    oiSnapshotSymbolLimit: number;
    historicalOiChangeSymbolLimit?: number;
    klineEnhancementSymbolLimit: number;
}

export const STRATEGY_MARKET_ENRICHMENT_LIMITS: MarketEnrichmentLimits = {
    oiSnapshotSymbolLimit: 220,
    historicalOiChangeSymbolLimit: 80,
    klineEnhancementSymbolLimit: 180,
};

export function resolveMarketEnrichmentLimits(
    _env: Pick<NodeJS.ProcessEnv, 'NODE_ENV'> = process.env,
): MarketEnrichmentLimits {
    void _env;

    return {
        oiSnapshotSymbolLimit: Number.POSITIVE_INFINITY,
        klineEnhancementSymbolLimit: Number.POSITIVE_INFINITY,
    };
}

export interface MarketKlineEnhancementRequest {
    label: string;
    symbols: string[];
    interval: string;
    limit: number;
}

export interface MarketKlineEnhancementStagePlan {
    eligible: MarketKlineEnhancementRequest[];
    weiShen: MarketKlineEnhancementRequest[];
}

export interface MarketKlineWarnLogger {
    warn(message: string, context?: Record<string, unknown>): void;
}

export interface MarketEnhancementBatchContext {
    signal?: AbortSignal;
    deadlineAt?: number;
}

function throwIfMarketBuildStopped(options: {
    signal?: AbortSignal;
    deadlineAt?: number;
    now: () => number;
}) {
    if (options.signal?.aborted) {
        throw options.signal.reason instanceof Error
            ? options.signal.reason
            : new Error('Market enhancement aborted');
    }
    if (options.deadlineAt !== undefined && options.now() > options.deadlineAt) {
        throw new Error('Market enhancement deadline exceeded');
    }
}

export async function runMarketEnhancementBatches(
    symbols: string[],
    batchSize: number,
    worker: (symbols: string[], context: MarketEnhancementBatchContext) => Promise<void>,
    options: {
        signal?: AbortSignal;
        deadlineAt?: number;
        now?: () => number;
        concurrency?: number;
    } = {},
): Promise<void> {
    const now = options.now ?? Date.now;
    const safeBatchSize = Math.max(1, Math.floor(batchSize));
    const batches = Array.from(
        { length: Math.ceil(symbols.length / safeBatchSize) },
        (_, index) => symbols.slice(index * safeBatchSize, (index + 1) * safeBatchSize),
    );
    let nextBatchIndex = 0;
    const runWorker = async () => {
        while (nextBatchIndex < batches.length) {
            throwIfMarketBuildStopped({ ...options, now });
            const batch = batches[nextBatchIndex];
            nextBatchIndex += 1;
            await worker(batch, {
                signal: options.signal,
                deadlineAt: options.deadlineAt,
            });
        }
    };
    const workerCount = Math.min(
        batches.length,
        Math.max(1, Math.floor(options.concurrency ?? 1)),
    );
    await Promise.all(Array.from({ length: workerCount }, runWorker));
    throwIfMarketBuildStopped({ ...options, now });
}

export type MarketKlineBatchFetcher<T> = (
    symbols: string[],
    batchSize: number,
    interval: string,
    limit: number,
) => Promise<Map<string, T[]>>;

export function buildMarketKlineEnhancementStagePlan(params: {
    eligibleSymbols: string[];
    weiUniverseSymbols: string[];
    weiShenTimeframes: {
        signalInterval: string;
        confirmInterval: string;
        dailyFilterInterval: string;
    };
}): MarketKlineEnhancementStagePlan {
    return {
        eligible: [
            { label: 'eligible-15m', symbols: params.eligibleSymbols, interval: '15m', limit: 50 },
            { label: 'eligible-5m', symbols: params.eligibleSymbols, interval: '5m', limit: 120 },
            { label: 'eligible-1d', symbols: params.eligibleSymbols, interval: '1d', limit: 30 },
        ],
        weiShen: [
            { label: 'wei-signal', symbols: params.weiUniverseSymbols, interval: params.weiShenTimeframes.signalInterval, limit: 180 },
            { label: 'wei-confirm', symbols: params.weiUniverseSymbols, interval: params.weiShenTimeframes.confirmInterval, limit: 180 },
            { label: 'wei-daily', symbols: params.weiUniverseSymbols, interval: params.weiShenTimeframes.dailyFilterInterval, limit: 60 },
        ],
    };
}

export function selectMarketKlineEligibleSymbols(params: {
    eligibleSymbols: string[];
    weiUniverseSymbols: string[];
    maxEligibleSymbols: number;
}): string[] {
    const selected = new Set<string>();

    params.eligibleSymbols.slice(0, params.maxEligibleSymbols).forEach((symbol) => {
        selected.add(symbol);
    });
    params.weiUniverseSymbols.forEach((symbol) => {
        selected.add(symbol);
    });

    return Array.from(selected);
}

export async function fetchMarketKlineEnhancementGroup<T>(
    request: MarketKlineEnhancementRequest,
    batchSize: number,
    fetchKlinesBatch: MarketKlineBatchFetcher<T>,
    logger: MarketKlineWarnLogger,
    now: () => number = Date.now,
): Promise<Map<string, T[]>> {
    const startedAt = now();
    try {
        const map = await fetchKlinesBatch(request.symbols, batchSize, request.interval, request.limit);
        if (map.size < request.symbols.length) {
            logger.warn('Market kline enrichment partially unavailable', {
                label: request.label,
                interval: request.interval,
                requestedSymbols: request.symbols.length,
                fulfilledSymbols: map.size,
                missingSymbols: request.symbols.length - map.size,
                durationMs: now() - startedAt,
            });
        }
        return map;
    } catch (error) {
        logger.warn('Market kline enrichment group failed', {
            label: request.label,
            interval: request.interval,
            requestedSymbols: request.symbols.length,
            durationMs: now() - startedAt,
            error: error instanceof Error ? error.message : String(error),
        });
        return new Map();
    }
}
