import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { get, put } from '@vercel/blob';

import { logger } from '../logger.ts';

import type { DailyNewsDigest, DailyNewsWindow } from './types.ts';

const LATEST_PATH = 'daily-news/latest.json';
const HISTORY_PREFIX = 'daily-news/history';
const DEFAULT_LOCAL_ROOT = process.env.NODE_ENV === 'production'
    ? join('/tmp', 'daily-news')
    : join(process.cwd(), 'data', 'daily-news');

export interface DailyNewsStorage {
    mode: 'blob' | 'local-file';
    readLatestDigest(): Promise<DailyNewsDigest | null>;
    readDigestForWindow(window: DailyNewsWindow): Promise<DailyNewsDigest | null>;
    saveDigest(digest: DailyNewsDigest): Promise<void>;
}

function historyFileName(windowEnd: string): string {
    return `${windowEnd.replace(/[:.]/g, '-')}.json`;
}

function historyBlobPath(windowEnd: string): string {
    return `${HISTORY_PREFIX}/${historyFileName(windowEnd)}`;
}

async function parseDigest(raw: string): Promise<DailyNewsDigest | null> {
    try {
        const parsed = JSON.parse(raw) as DailyNewsDigest;
        if (!parsed || typeof parsed.generatedAt !== 'string') {
            return null;
        }
        return parsed;
    } catch {
        return null;
    }
}

export function createDailyNewsFileStorage(rootDir = DEFAULT_LOCAL_ROOT): DailyNewsStorage {
    async function ensureRoot() {
        await mkdir(join(rootDir, 'history'), { recursive: true });
    }

    async function readJson(path: string): Promise<DailyNewsDigest | null> {
        try {
            return await parseDigest(await readFile(path, 'utf8'));
        } catch {
            return null;
        }
    }

    return {
        mode: 'local-file',
        async readLatestDigest() {
            return readJson(join(rootDir, 'latest.json'));
        },
        async readDigestForWindow(window) {
            return readJson(join(rootDir, 'history', historyFileName(window.windowEnd)));
        },
        async saveDigest(digest) {
            await ensureRoot();
            const serialized = `${JSON.stringify(digest, null, 2)}\n`;
            await Promise.all([
                writeFile(join(rootDir, 'latest.json'), serialized, 'utf8'),
                writeFile(join(rootDir, 'history', historyFileName(digest.windowEnd)), serialized, 'utf8'),
            ]);
        },
    };
}

export function createDailyNewsBlobStorage(token = process.env.BLOB_READ_WRITE_TOKEN): DailyNewsStorage {
    async function readBlob(path: string): Promise<DailyNewsDigest | null> {
        if (!token) {
            return null;
        }

        try {
            const blob = await get(path, { access: 'private', token, useCache: false });
            if (!blob || blob.statusCode !== 200 || !blob.stream) {
                return null;
            }

            return parseDigest(await new Response(blob.stream).text());
        } catch (error) {
            logger.warn('Failed to read daily news blob', {
                path,
                error: error instanceof Error ? error.message : String(error),
            });
            return null;
        }
    }

    async function writeBlob(path: string, digest: DailyNewsDigest): Promise<void> {
        if (!token) {
            throw new Error('BLOB_READ_WRITE_TOKEN is not configured');
        }

        await put(path, `${JSON.stringify(digest, null, 2)}\n`, {
            access: 'private',
            addRandomSuffix: false,
            allowOverwrite: true,
            contentType: 'application/json; charset=utf-8',
            cacheControlMaxAge: 60,
            token,
        });
    }

    return {
        mode: 'blob',
        async readLatestDigest() {
            return readBlob(LATEST_PATH);
        },
        async readDigestForWindow(window) {
            return readBlob(historyBlobPath(window.windowEnd));
        },
        async saveDigest(digest) {
            await writeBlob(historyBlobPath(digest.windowEnd), digest);
            await writeBlob(LATEST_PATH, digest);
        },
    };
}

export function createDailyNewsStorage(): DailyNewsStorage {
    if (process.env.BLOB_READ_WRITE_TOKEN?.trim()) {
        return createDailyNewsBlobStorage();
    }

    if (process.env.NODE_ENV === 'production') {
        logger.warn('BLOB_READ_WRITE_TOKEN is missing; daily news will use ephemeral local file storage');
    }

    return createDailyNewsFileStorage();
}
