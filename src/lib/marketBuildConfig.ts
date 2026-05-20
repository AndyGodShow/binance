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
