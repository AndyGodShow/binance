import { logger } from '../logger.ts';

import type { DailyNewsWindow, NewsCandidate, NewsCategory } from './types.ts';

interface GdeltArticle {
    url?: string;
    url_mobile?: string;
    title?: string;
    seendate?: string;
    domain?: string;
    language?: string;
    sourcecountry?: string;
}

interface GdeltResponse {
    articles?: GdeltArticle[];
}

const GDELT_ENDPOINT = 'https://api.gdeltproject.org/api/v2/doc/doc';
const REQUEST_TIMEOUT_MS = 4000;
const MAX_RECORDS = 75;
const RETRY_DELAY_MS = 600;

const CATEGORY_QUERIES: Record<NewsCategory, string> = {
    macro: '("Federal Reserve" OR Fed OR "central bank" OR ECB OR BOJ OR PBOC OR inflation OR CPI OR PPI OR GDP OR PMI OR payrolls OR "nonfarm payrolls" OR "Treasury yields" OR dollar OR sanctions OR tariffs OR "geopolitical risk" OR oil OR gold)',
    ai: '(OpenAI OR Anthropic OR Google OR DeepMind OR Gemini OR Microsoft OR Meta OR Llama OR NVIDIA OR xAI OR "artificial intelligence" OR "AI model" OR "AI chip" OR GPU OR "data center" OR "AI regulation")',
    crypto: '(Bitcoin OR BTC OR Ethereum OR ETH OR crypto OR cryptocurrency OR blockchain OR stablecoin OR Tether OR USDT OR Circle OR USDC OR ETF OR SEC OR Binance OR Coinbase OR Solana OR DeFi OR hack OR exploit OR liquidation OR miner)',
};

function toGdeltDateTime(iso: string): string {
    return iso.replace(/[-:]/g, '').replace(/\.\d{3}Z$/, '');
}

export function normalizeGdeltDate(value?: string): string | undefined {
    if (!value) {
        return undefined;
    }

    const compact = value.trim();
    const match = compact.match(/^(\d{4})(\d{2})(\d{2})T?(\d{2})(\d{2})(\d{2})Z?$/);
    if (match) {
        const [, year, month, day, hour, minute, second] = match;
        return new Date(`${year}-${month}-${day}T${hour}:${minute}:${second}.000Z`).toISOString();
    }

    const timestamp = new Date(value).getTime();
    return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : undefined;
}

async function fetchJsonWithTimeout(url: string, timeoutMs: number): Promise<GdeltResponse> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

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
            throw new Error(`GDELT request failed: ${response.status}`);
        }

        return await response.json() as GdeltResponse;
    } finally {
        clearTimeout(timer);
    }
}

function buildGdeltUrl(category: NewsCategory, window: DailyNewsWindow): string {
    const params = new URLSearchParams({
        query: `${CATEGORY_QUERIES[category]} sourcelang:English`,
        mode: 'artlist',
        format: 'json',
        maxrecords: MAX_RECORDS.toString(),
        sort: 'datedesc',
        startdatetime: toGdeltDateTime(window.windowStart),
        enddatetime: toGdeltDateTime(window.windowEnd),
    });

    return `${GDELT_ENDPOINT}?${params.toString()}`;
}

function formatFetchError(error: unknown): string {
    if (!(error instanceof Error)) {
        return String(error);
    }

    const cause = error.cause instanceof Error ? ` (${error.cause.message})` : '';
    return `${error.message}${cause}`;
}

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function sourceFromArticle(article: GdeltArticle): string {
    if (article.domain) {
        return article.domain
            .replace(/^www\./, '')
            .split('.')
            .slice(0, -1)
            .join(' ')
            .replace(/\b\w/g, (char) => char.toUpperCase()) || article.domain;
    }

    return 'Unknown';
}

export async function fetchGdeltNewsCandidates(category: NewsCategory, window: DailyNewsWindow): Promise<NewsCandidate[]> {
    const url = buildGdeltUrl(category, window);
    let lastError: unknown;

    for (let attempt = 1; attempt <= 2; attempt += 1) {
        try {
            const payload = await fetchJsonWithTimeout(url, REQUEST_TIMEOUT_MS);
            const collectedAt = new Date().toISOString();

            return (payload.articles || [])
                .filter((article) => article.title && (article.url || article.url_mobile))
                .map((article) => ({
                    category,
                    title: article.title || '',
                    source: sourceFromArticle(article),
                    domain: article.domain,
                    url: article.url || article.url_mobile || '',
                    publishedAt: normalizeGdeltDate(article.seendate),
                    collectedAt,
                    tags: [],
                }));
        } catch (error) {
            lastError = error;
            logger.warn('Daily news GDELT fetch failed', {
                category,
                attempt,
                error: formatFetchError(error),
            });

            if (attempt < 2) {
                await sleep(RETRY_DELAY_MS);
            }
        }
    }

    throw lastError instanceof Error ? lastError : new Error('GDELT request failed');
}
