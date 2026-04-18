import { logger } from '../logger.ts';

import { fetchGdeltNewsCandidates } from './gdelt.ts';
import {
    buildDailyNewsDigestFromResults,
    calculateDailyNewsWindow,
    hasAnyDailyNewsItems,
} from './pipeline.ts';
import { fetchRssNewsCandidates } from './rss.ts';
import { createDailyNewsStorage } from './storage.ts';
import { translateDailyNewsDigest } from './translate.ts';
import { NEWS_CATEGORIES, type CategoryCollectionResult, type DailyNewsGenerationResult } from './types.ts';

interface GenerateOptions {
    force?: boolean;
    now?: Date;
}

let inflightGeneration: Promise<DailyNewsGenerationResult> | null = null;

export async function readLatestDailyNewsDigest() {
    const storage = createDailyNewsStorage();
    const digest = await storage.readLatestDigest();

    return {
        digest,
        storageMode: storage.mode,
    };
}

async function collectCategory(category: typeof NEWS_CATEGORIES[number], window: ReturnType<typeof calculateDailyNewsWindow>): Promise<CategoryCollectionResult> {
    const candidates: CategoryCollectionResult['candidates'] = [];
    let errorMessage: string | undefined;

    try {
        candidates.push(...await fetchRssNewsCandidates(category, window));
    } catch (error) {
        errorMessage = error instanceof Error ? error.message : String(error);
        logger.warn('Daily news RSS category collection failed', { category, error: errorMessage });
    }

    if (candidates.length >= 5) {
        return {
            category,
            ok: true,
            candidates,
        };
    }

    try {
        candidates.push(...await fetchGdeltNewsCandidates(category, window));
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        errorMessage = errorMessage ? `${errorMessage}; ${message}` : message;
        logger.warn('Daily news GDELT category collection failed', { category, error: message });
    }

    return {
        category,
        ok: candidates.length > 0,
        candidates,
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
                message: 'Reused existing digest for the same rolling window',
            };
        }
    }

    const previousDigest = await storage.readLatestDigest();
    const results = await Promise.all(NEWS_CATEGORIES.map((category) => collectCategory(category, window)));
    const digest = await translateDailyNewsDigest(buildDailyNewsDigestFromResults(results, window));

    if (!hasAnyDailyNewsItems(digest)) {
        if (previousDigest) {
            logger.warn('Daily news generation produced no items; keeping previous digest', {
                generatedAt: previousDigest.generatedAt,
            });
            return {
                digest: previousDigest,
                generated: false,
                reusedExisting: true,
                storageMode: storage.mode,
                message: 'Generation produced no usable items; returned previous digest',
            };
        }

        return {
            digest,
            generated: false,
            reusedExisting: false,
            storageMode: storage.mode,
            message: 'Generation produced no usable items',
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
