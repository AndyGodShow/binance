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
    shouldPersistData?: (data: T) => boolean;
    shouldRestoreData?: (data: T) => boolean;
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

function removePersistedValue(storageKey: string) {
    if (typeof window === 'undefined') {
        return;
    }

    try {
        window.localStorage.removeItem(storageKey);
    } catch {
        // Ignore storage access issues.
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
        shouldPersistData,
        shouldRestoreData,
        keepPreviousData = true,
        ...swrConfig
    } = config;

    const response = useSWR<T>(key, fetcher, {
        keepPreviousData,
        ...swrConfig,
    });
    const { data: responseData, mutate } = response;

    const restoredRef = useRef<string | null>(null);
    const lastPersistAtRef = useRef(0);

    useEffect(() => {
        restoredRef.current = null;
    }, [storageKey]);

    useEffect(() => {
        if (!key || !storageKey || responseData !== undefined || restoredRef.current === storageKey) {
            return;
        }

        const cached = readPersistedValue<T>(storageKey, storageTtlMs);
        restoredRef.current = storageKey;

        if (cached !== undefined && (!shouldRestoreData || shouldRestoreData(cached))) {
            void mutate(cached, {
                revalidate: false,
                populateCache: true,
            });
            return;
        }

        if (cached !== undefined && shouldRestoreData && !shouldRestoreData(cached)) {
            removePersistedValue(storageKey);
        }
    }, [key, mutate, responseData, shouldRestoreData, storageKey, storageTtlMs]);

    useEffect(() => {
        if (!storageKey || responseData === undefined) {
            return;
        }

        if (shouldPersistData && !shouldPersistData(responseData)) {
            return;
        }

        const now = Date.now();
        if (persistIntervalMs > 0 && now - lastPersistAtRef.current < persistIntervalMs) {
            return;
        }

        writePersistedValue(storageKey, responseData);
        lastPersistAtRef.current = now;
    }, [persistIntervalMs, responseData, shouldPersistData, storageKey]);

    return response;
}
