import { logger } from '../logger.ts';

import type { DailyNewsWindow, NewsCandidate, NewsCategory } from './types.ts';

const API_BASE_URL = process.env.DAILY_NEWS_API_BASE || 'https://ai.6551.io';
const REQUEST_TIMEOUT_MS = 6000;

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
    return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function stringField(record: JsonRecord, keys: string[]): string {
    for (const key of keys) {
        const value = record[key];
        if (typeof value === 'string' && value.trim()) {
            return value.trim();
        }
        if (typeof value === 'number' && Number.isFinite(value)) {
            return String(value);
        }
    }
    return '';
}

function cleanText(value: string): string {
    return value
        .replace(/<br\s*\/?>/gi, ' ')
        .replace(/<\/(p|div|li|span|section)>/gi, '。')
        .replace(/<[^>]+>/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/\s+/g, ' ')
        .replace(/。{2,}/g, '。')
        .trim();
}

function textField(record: JsonRecord, keys: string[]): string {
    return cleanText(stringField(record, keys));
}

function normalizeDate(value: string): string | undefined {
    if (!value) return undefined;
    const timestamp = new Date(value).getTime();
    return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : undefined;
}

function normalizeDomain(url: string): string | undefined {
    try {
        return new URL(url).hostname.replace(/^www\./, '').toLowerCase();
    } catch {
        return undefined;
    }
}

function sourceFromRecord(record: JsonRecord, url: string, fallback: string): string {
    const domain = normalizeDomain(url);
    if (domain === 'x.com' || domain === 'twitter.com') {
        return '6551 Twitter';
    }

    return stringField(record, ['source', 'media', 'platform', 'site', 'author', 'username'])
        || domain
        || fallback;
}

function collectRecords(value: unknown, output: JsonRecord[] = []): JsonRecord[] {
    if (Array.isArray(value)) {
        value.forEach((item) => collectRecords(item, output));
        return output;
    }

    if (!isRecord(value)) {
        return output;
    }

    const title = textField(value, ['title', 'headline', 'text', 'content', 'summary', 'summary_zh', 'summary_en']);
    const url = stringField(value, ['url', 'link', 'source_url', 'tweet_url']);
    if (title && url) {
        output.push(value);
    }

    Object.entries(value).forEach(([key, nested]) => {
        if (['title', 'headline', 'text', 'content', 'summary'].includes(key)) {
            return;
        }
        collectRecords(nested, output);
    });

    return output;
}

function toCandidate(record: JsonRecord, category: NewsCategory, window: DailyNewsWindow, collectedAt: string): NewsCandidate | null {
    const title = textField(record, ['title', 'headline', 'text', 'content']);
    const summary = textField(record, ['summary_zh', 'summary_en', 'summary', 'description', 'abstract', 'brief']);
    const url = stringField(record, ['url', 'link', 'source_url', 'tweet_url']);
    const publishedAt = normalizeDate(stringField(record, [
        'published_at',
        'publishedAt',
        'pubDate',
        'created_at',
        'createdAt',
        'time',
        'date',
    ]));

    if (!title || !url || !publishedAt) {
        return null;
    }

    const publishedAtMs = new Date(publishedAt).getTime();
    if (publishedAtMs < window.windowStartMs || publishedAtMs > window.windowEndMs) {
        return null;
    }

    const domain = normalizeDomain(url);
    const isTwitter = domain === 'x.com' || domain === 'twitter.com';

    return {
        category,
        title,
        summary,
        source: sourceFromRecord(record, url, isTwitter ? '6551 Twitter' : '6551 News'),
        domain,
        url,
        publishedAt,
        collectedAt,
        tags: ['6551', isTwitter ? '推特追踪' : '新闻源'],
        rawSnippet: summary || title,
    };
}

export function parse6551HotNewsPayload(payload: unknown, category: NewsCategory, window: DailyNewsWindow): NewsCandidate[] {
    const collectedAt = new Date().toISOString();
    const seen = new Set<string>();
    return collectRecords(payload)
        .map((record) => toCandidate(record, category, window, collectedAt))
        .filter((candidate): candidate is NewsCandidate => Boolean(candidate))
        .filter((candidate) => {
            const key = candidate.url || `${candidate.title}:${candidate.publishedAt}`;
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        })
        .slice(0, 75);
}

async function fetchJsonWithTimeout(url: string): Promise<unknown> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
        const response = await fetch(url, {
            signal: controller.signal,
            headers: {
                'Accept': 'application/json',
                'User-Agent': 'binance-data-dashboard/1.0',
            },
            cache: 'no-store',
        });

        if (!response.ok) {
            throw new Error(`6551 request failed: ${response.status}`);
        }

        return await response.json() as unknown;
    } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError'
            || error instanceof Error && /aborted|aborterror/i.test(`${error.name} ${error.message}`)) {
            throw new Error(`6551 timeout after ${REQUEST_TIMEOUT_MS}ms`);
        }
        throw error;
    } finally {
        clearTimeout(timer);
    }
}

export async function fetch6551NewsCandidates(category: NewsCategory, window: DailyNewsWindow): Promise<NewsCandidate[]> {
    const params = new URLSearchParams({ category });
    const url = `${API_BASE_URL.replace(/\/$/, '')}/open/free_hot?${params.toString()}`;

    try {
        const payload = await fetchJsonWithTimeout(url);
        return parse6551HotNewsPayload(payload, category, window);
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logger.warn('Daily news 6551 fetch failed', { category, error: message });
        throw new Error(message);
    }
}

export const sixFiveFiveOneInternals = {
    parse6551HotNewsPayload,
};
