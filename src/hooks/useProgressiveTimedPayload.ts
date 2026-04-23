"use client";

import { useEffect, useRef, useState } from 'react';
import {
    mergeTimedPayloadData,
    pruneTimedPayloadData,
    type TimedPayload,
} from '@/lib/liveMarketData';

interface ProgressiveTimedPayloadOptions<T> {
    enabled: boolean;
    symbols: string[];
    batchSize: number;
    batchDelayMs: number;
    refreshIntervalMs: number;
    fetchBatch: (symbols: string[]) => Promise<TimedPayload<Record<string, T>>>;
    buildError: (error: unknown) => Error;
}

export function useProgressiveTimedPayload<T>(
    options: ProgressiveTimedPayloadOptions<T>
): {
    payload: TimedPayload<Record<string, T>> | undefined;
    error: Error | null;
    setPayload: React.Dispatch<React.SetStateAction<TimedPayload<Record<string, T>> | undefined>>;
    setError: React.Dispatch<React.SetStateAction<Error | null>>;
} {
    const {
        enabled,
        symbols,
        batchSize,
        batchDelayMs,
        refreshIntervalMs,
        fetchBatch,
        buildError,
    } = options;
    const [payload, setPayload] = useState<TimedPayload<Record<string, T>>>();
    const [error, setError] = useState<Error | null>(null);
    const symbolsRef = useRef<string[]>([]);
    const fetchBatchRef = useRef(fetchBatch);
    const buildErrorRef = useRef(buildError);
    const signature = [...symbols].sort().join(',');

    useEffect(() => {
        symbolsRef.current = symbols;
    }, [symbols]);

    useEffect(() => {
        fetchBatchRef.current = fetchBatch;
    }, [fetchBatch]);

    useEffect(() => {
        buildErrorRef.current = buildError;
    }, [buildError]);

    useEffect(() => {
        if (!enabled || !signature) {
            return;
        }

        let cancelled = false;
        let nextRefreshTimer: number | undefined;

        const activeSymbolSet = new Set(symbolsRef.current);
        setPayload((prev) => pruneTimedPayloadData(prev, activeSymbolSet));

        const runProgressiveFetch = async () => {
            setError(null);
            const symbols = symbolsRef.current;

            for (let index = 0; index < symbols.length; index += batchSize) {
                if (cancelled) {
                    return;
                }

                const batch = symbols.slice(index, index + batchSize);

                try {
                    const nextPayload = await fetchBatchRef.current(batch);
                    if (cancelled) {
                        return;
                    }

                    setPayload((prev) => mergeTimedPayloadData(prev, nextPayload));
                } catch (nextError) {
                    if (!cancelled) {
                        setError(buildErrorRef.current(nextError));
                    }
                }

                if (index + batchSize < symbols.length) {
                    await new Promise((resolve) => window.setTimeout(resolve, batchDelayMs));
                }
            }

            if (!cancelled) {
                nextRefreshTimer = window.setTimeout(runProgressiveFetch, refreshIntervalMs);
            }
        };

        void runProgressiveFetch();

        return () => {
            cancelled = true;
            if (nextRefreshTimer !== undefined) {
                window.clearTimeout(nextRefreshTimer);
            }
        };
    }, [
        batchDelayMs,
        batchSize,
        enabled,
        refreshIntervalMs,
        signature,
    ]);

    return {
        payload,
        error,
        setPayload,
        setError,
    };
}
