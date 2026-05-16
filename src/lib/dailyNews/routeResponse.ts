import { isDailyNewsDigestStale } from '../dailyNewsReadPolicy.ts';
import type { DailyNewsApiResponse, DailyNewsDigest } from './types.ts';

interface DailyNewsReadResponseInput {
    digest: DailyNewsDigest | null;
    storageMode: DailyNewsApiResponse['storageMode'];
    now?: Date;
    maxAgeMs?: number;
    refreshRequested: boolean;
}

export interface DailyNewsReadResponse extends DailyNewsApiResponse {
    shouldGenerate: false;
}

export function buildDailyNewsReadResponse(input: DailyNewsReadResponseInput): DailyNewsReadResponse {
    const isStale = isDailyNewsDigestStale(input.digest?.generatedAt, input.now, input.maxAgeMs);

    if (!input.digest) {
        return {
            digest: null,
            status: 'empty',
            storageMode: input.storageMode,
            isStale: true,
            sourceStatus: {
                cache: 'missing',
                generation: 'scheduled-only',
            },
            shouldGenerate: false,
            message: 'Important news has not been generated yet',
        };
    }

    const refreshMessage = input.refreshRequested
        ? 'Public refresh is read-only; generation waits for the scheduled refresh'
        : undefined;

    if (isStale) {
        return {
            digest: input.digest,
            status: 'degraded',
            storageMode: input.storageMode,
            isStale: true,
            sourceStatus: {
                cache: 'stale',
                generation: 'scheduled-only',
            },
            shouldGenerate: false,
            message: refreshMessage || 'Important news digest is stale; waiting for the scheduled refresh',
        };
    }

    return {
        digest: input.digest,
        status: 'ok',
        storageMode: input.storageMode,
        isStale: false,
        sourceStatus: {
            cache: 'fresh',
            generation: 'scheduled-only',
        },
        shouldGenerate: false,
        message: refreshMessage,
    };
}
