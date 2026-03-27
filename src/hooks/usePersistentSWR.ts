"use client";

import { useEffect, useRef } from 'react';
import useSWR, { SWRConfiguration, SWRResponse } from 'swr';

const STORAGE_PREFIX = 'persistent-swr:v1:';

interface PersistedPayload<T> {
    data: T;
    savedAt: number;
}

interface PersistentSWRConfig<T> extends SWRConfiguration<T> {
    storageTtlMs?: number;
    persistIntervalMs?: number;
    storageKey?: string;
}

function readPersistedValue<T>(storageKey: string, ttlMs: number): T | undefined {
    if (typeof window === 'undefined') {
        return undefined;
    }

    try {
        const raw = window.localStorage.getItem(storageKey);
        if (!raw) {
            return undefined;
        }

        const parsed = JSON.parse(raw) as PersistedPayload<T>;
        if (!parsed || typeof parsed !== 'object' || !('savedAt' in parsed)) {
            return undefined;
        }

        if (ttlMs > 0 && Date.now() - parsed.savedAt > ttlMs) {
            window.localStorage.removeItem(storageKey);
            return undefined;
        }

        return parsed.data;
    } catch {
        return undefined;
    }
}

function writePersistedValue<T>(storageKey: string, data: T) {
    if (typeof window === 'undefined') {
        return;
    }

    try {
        const payload: PersistedPayload<T> = {
            data,
            savedAt: Date.now(),
        };
        window.localStorage.setItem(storageKey, JSON.stringify(payload));
    } catch {
        // Ignore quota and serialization errors. Runtime data still works without persistence.
    }
}

export function usePersistentSWR<T>(
    key: string | null,
    fetcher: ((key: string) => Promise<T>) | null,
    config: PersistentSWRConfig<T> = {}
): SWRResponse<T> {
    const {
        storageTtlMs = 0,
        persistIntervalMs = 0,
        storageKey = key ? `${STORAGE_PREFIX}${key}` : undefined,
        keepPreviousData = true,
        ...swrConfig
    } = config;

    const response = useSWR<T>(key, fetcher, {
        keepPreviousData,
        ...swrConfig,
    });

    const restoredRef = useRef<string | null>(null);
    const lastPersistAtRef = useRef(0);

    useEffect(() => {
        restoredRef.current = null;
    }, [storageKey]);

    useEffect(() => {
        if (!key || !storageKey || response.data !== undefined || restoredRef.current === storageKey) {
            return;
        }

        const cached = readPersistedValue<T>(storageKey, storageTtlMs);
        restoredRef.current = storageKey;

        if (cached !== undefined) {
            void response.mutate(cached, {
                revalidate: false,
                populateCache: true,
            });
        }
    }, [key, response.data, response.mutate, storageKey, storageTtlMs]);

    useEffect(() => {
        if (!storageKey || response.data === undefined) {
            return;
        }

        const now = Date.now();
        if (persistIntervalMs > 0 && now - lastPersistAtRef.current < persistIntervalMs) {
            return;
        }

        writePersistedValue(storageKey, response.data);
        lastPersistAtRef.current = now;
    }, [persistIntervalMs, response.data, storageKey]);

    return response;
}
