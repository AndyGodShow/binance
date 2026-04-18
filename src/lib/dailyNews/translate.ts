import { logger } from '../logger.ts';

import { NEWS_CATEGORIES, type DailyNewsDigest, type DailyNewsItem } from './types.ts';

const TRANSLATE_ENDPOINT = 'https://translate.googleapis.com/translate_a/single';
const TRANSLATE_TIMEOUT_MS = 2500;
const TRANSLATE_CONCURRENCY = 4;

function containsCjk(value: string): boolean {
    return /[\u3400-\u9FFF]/.test(value);
}

function shouldTranslateText(value: string | undefined): value is string {
    return Boolean(value && value.trim() && !containsCjk(value));
}

async function fetchTranslation(text: string): Promise<string> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TRANSLATE_TIMEOUT_MS);

    try {
        const params = new URLSearchParams({
            client: 'gtx',
            sl: 'auto',
            tl: 'zh-CN',
            dt: 't',
            q: text,
        });
        const response = await fetch(`${TRANSLATE_ENDPOINT}?${params.toString()}`, {
            signal: controller.signal,
            headers: {
                'Accept': 'application/json',
                'User-Agent': 'binance-data-dashboard/1.0',
            },
            cache: 'no-store',
        });

        if (!response.ok) {
            throw new Error(`Translation request failed: ${response.status}`);
        }

        const payload = await response.json() as unknown;
        if (!Array.isArray(payload) || !Array.isArray(payload[0])) {
            throw new Error('Unexpected translation payload');
        }

        const translated = payload[0]
            .map((part) => (Array.isArray(part) ? part[0] : ''))
            .join('')
            .trim();

        if (!translated) {
            throw new Error('Empty translation payload');
        }

        return translated;
    } finally {
        clearTimeout(timer);
    }
}

async function translateItem(item: DailyNewsItem): Promise<DailyNewsItem> {
    const needsTitle = shouldTranslateText(item.title);
    const needsSummary = shouldTranslateText(item.summary);

    if (!needsTitle && !needsSummary) {
        return item;
    }

    try {
        const [translatedTitle, translatedSummary] = await Promise.all([
            needsTitle ? fetchTranslation(item.title) : Promise.resolve(item.title),
            needsSummary ? fetchTranslation(item.summary) : Promise.resolve(item.summary),
        ]);

        return {
            ...item,
            title: needsTitle ? (translatedTitle?.trim() || item.title) : item.title,
            summary: needsSummary ? (translatedSummary?.trim() || item.summary) : item.summary,
        };
    } catch (error) {
        logger.warn('Daily news translation failed; using original text', {
            id: item.id,
            error: error instanceof Error ? error.message : String(error),
        });
        return item;
    }
}

async function translateItems(items: DailyNewsItem[]): Promise<DailyNewsItem[]> {
    const translated: DailyNewsItem[] = [];

    for (let index = 0; index < items.length; index += TRANSLATE_CONCURRENCY) {
        const batch = items.slice(index, index + TRANSLATE_CONCURRENCY);
        translated.push(...await Promise.all(batch.map((item) => translateItem(item))));
    }

    return translated;
}

export async function translateDailyNewsDigest(digest: DailyNewsDigest): Promise<DailyNewsDigest> {
    const translated = { ...digest } as DailyNewsDigest;

    for (const category of NEWS_CATEGORIES) {
        translated[category] = await translateItems(digest[category]);
    }

    return translated;
}

export const translationInternals = {
    containsCjk,
    shouldTranslateText,
};
