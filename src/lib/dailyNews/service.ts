import { logger } from '../logger.ts';

import { fetchGdeltNewsCandidates } from './gdelt.ts';
import {
    buildDailyNewsDigestFromResults,
    calculateDailyNewsWindow,
    hasAnyDailyNewsItems,
    sanitizeDailyNewsDigest,
} from './pipeline.ts';
import { fetchRssNewsCandidates } from './rss.ts';
import { fetch6551NewsCandidates } from './sixFiveFiveOne.ts';
import { createDailyNewsStorage } from './storage.ts';
import { translateDailyNewsDigest } from './translate.ts';
import {
    NEWS_CATEGORIES,
    type CategoryCollectionResult,
    type DailyNewsGenerationResult,
    type DailyNewsSourceAttempt,
    type DailyNewsSourceName,
    type DailyNewsWindow,
    type NewsCandidate,
    type NewsCategory,
} from './types.ts';

interface GenerateOptions {
    force?: boolean;
    now?: Date;
}

let inflightGeneration: Promise<DailyNewsGenerationResult> | null = null;

const SOURCE_TIMEOUT_MS: Record<DailyNewsSourceName, number> = {
    rss: 8000,
    '6551': 6000,
    gdelt: 10000,
};

const SOURCE_LABELS: Record<DailyNewsSourceName, string> = {
    rss: 'RSS',
    '6551': '6551',
    gdelt: 'GDELT',
};

interface NewsSourceCollector {
    source: DailyNewsSourceName;
    collect(category: NewsCategory, window: DailyNewsWindow): Promise<NewsCandidate[]>;
}

const DEFAULT_SOURCE_COLLECTORS: NewsSourceCollector[] = [
    { source: 'rss', collect: fetchRssNewsCandidates },
    { source: '6551', collect: fetch6551NewsCandidates },
    { source: 'gdelt', collect: fetchGdeltNewsCandidates },
];

export async function readLatestDailyNewsDigest() {
    const storage = createDailyNewsStorage();
    const digest = await storage.readLatestDigest();

    return {
        digest,
        storageMode: storage.mode,
    };
}

function isAbortError(error: unknown): boolean {
    return error instanceof DOMException && error.name === 'AbortError'
        || error instanceof Error && /aborted|aborterror/i.test(`${error.name} ${error.message}`);
}

function normalizeSourceError(source: DailyNewsSourceName, error: unknown): string {
    if (isAbortError(error)) {
        return `${SOURCE_LABELS[source]} timeout after ${SOURCE_TIMEOUT_MS[source]}ms`;
    }

    const message = error instanceof Error ? error.message : String(error);
    if (message.toLowerCase().includes(SOURCE_LABELS[source].toLowerCase())) {
        return message;
    }
    return `${SOURCE_LABELS[source]} ${message}`;
}

async function runSourceAttempt(
    category: NewsCategory,
    window: DailyNewsWindow,
    collector: NewsSourceCollector
): Promise<{ candidates: NewsCandidate[]; attempt: DailyNewsSourceAttempt }> {
    const startedAt = Date.now();

    try {
        const candidates = await collector.collect(category, window);
        const durationMs = Date.now() - startedAt;
        return {
            candidates,
            attempt: {
                source: collector.source,
                status: candidates.length > 0 ? 'success' : 'empty',
                candidateCount: candidates.length,
                durationMs,
            },
        };
    } catch (error) {
        const message = normalizeSourceError(collector.source, error);
        logger.warn('Daily news source collection failed', {
            category,
            source: collector.source,
            error: message,
        });
        return {
            candidates: [],
            attempt: {
                source: collector.source,
                status: 'failed',
                candidateCount: 0,
                durationMs: Date.now() - startedAt,
                error: message,
            },
        };
    }
}

async function collectCategory(
    category: typeof NEWS_CATEGORIES[number],
    window: DailyNewsWindow,
    collectors = DEFAULT_SOURCE_COLLECTORS
): Promise<CategoryCollectionResult> {
    const candidates: CategoryCollectionResult['candidates'] = [];
    const sourceAttempts: DailyNewsSourceAttempt[] = [];

    for (const collector of collectors) {
        const result = await runSourceAttempt(category, window, collector);
        candidates.push(...result.candidates);
        sourceAttempts.push(result.attempt);
    }

    const degradedReasons = sourceAttempts
        .filter((attempt) => attempt.status !== 'success')
        .map((attempt) => attempt.error || `${SOURCE_LABELS[attempt.source]} returned no candidates`);
    const errorMessage = degradedReasons.length > 0 ? degradedReasons.join('; ') : undefined;

    return {
        category,
        ok: candidates.length > 0,
        candidates,
        sourceAttempts,
        degradedReason: candidates.length > 0 ? errorMessage : undefined,
        error: candidates.length > 0 ? undefined : errorMessage,
    };
}

async function generateDailyNewsDigestInner(options: GenerateOptions = {}): Promise<DailyNewsGenerationResult> {
    const storage = createDailyNewsStorage();
    const window = calculateDailyNewsWindow(options.now || new Date());

    if (!options.force) {
        const existingWindowDigest = await storage.readDigestForWindow(window);
        if (existingWindowDigest) {
            return {
                digest: existingWindowDigest,
                generated: false,
                reusedExisting: true,
                storageMode: storage.mode,
                message: 'Reused existing important news digest for the same rolling window',
            };
        }
    }

    const previousDigest = await storage.readLatestDigest();
    const results = await Promise.all(NEWS_CATEGORIES.map((category) => collectCategory(category, window)));
    const digest = sanitizeDailyNewsDigest(await translateDailyNewsDigest(buildDailyNewsDigestFromResults(results, window)));

    if (!hasAnyDailyNewsItems(digest)) {
        if (previousDigest) {
            logger.warn('Daily news generation produced no items; keeping previous digest', {
                generatedAt: previousDigest.generatedAt,
            });
            // TODO: consider category-level stale merges when a refresh only fails macro or AI.
            return {
                digest: previousDigest,
                generated: false,
                reusedExisting: true,
                storageMode: storage.mode,
                message: 'Generation produced no usable important news items; returned previous digest',
            };
        }

        return {
            digest,
            generated: false,
            reusedExisting: false,
            storageMode: storage.mode,
            message: 'Generation produced no usable important news items',
        };
    }

    await storage.saveDigest(digest);

    return {
        digest,
        generated: true,
        reusedExisting: false,
        storageMode: storage.mode,
    };
}

export const dailyNewsServiceInternals = {
    collectCategory,
    normalizeSourceError,
};

export async function generateDailyNewsDigest(options: GenerateOptions = {}): Promise<DailyNewsGenerationResult> {
    if (inflightGeneration) {
        return inflightGeneration;
    }

    inflightGeneration = generateDailyNewsDigestInner(options);

    try {
        return await inflightGeneration;
    } finally {
        inflightGeneration = null;
    }
}
