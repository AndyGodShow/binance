import { logger } from '../logger.ts';

import type { DailyNewsWindow, NewsCandidate, NewsCategory } from './types.ts';

interface RssSource {
    category: NewsCategory;
    url: string;
    source: string;
    domain?: string;
    tags: string[];
}

const RSS_TIMEOUT_MS = 5000;
const GOOGLE_NEWS_BASE = 'https://news.google.com/rss/search';

function buildGoogleNewsRssUrl(query: string): string {
    const params = new URLSearchParams({
        q: query,
        hl: 'en-US',
        gl: 'US',
        ceid: 'US:en',
    });

    return `${GOOGLE_NEWS_BASE}?${params.toString()}`;
}

const RSS_SOURCES: RssSource[] = [
    {
        category: 'macro',
        url: buildGoogleNewsRssUrl('("Federal Reserve" OR ECB OR BOJ OR PBOC OR CPI OR inflation OR payrolls OR treasury yields OR tariff OR sanctions) when:1d'),
        source: 'Google News',
        tags: ['市场'],
    },
    {
        category: 'macro',
        url: 'https://www.cnbc.com/id/100003114/device/rss/rss.html',
        source: 'CNBC',
        domain: 'cnbc.com',
        tags: ['市场'],
    },
    {
        category: 'macro',
        url: 'https://www.marketwatch.com/rss/topstories',
        source: 'MarketWatch',
        domain: 'marketwatch.com',
        tags: ['市场'],
    },
    {
        category: 'ai',
        url: buildGoogleNewsRssUrl('(OpenAI OR Anthropic OR Google AI OR Gemini OR NVIDIA OR xAI OR "AI model" OR "AI chips") when:1d'),
        source: 'Google News',
        tags: ['人工智能'],
    },
    {
        category: 'ai',
        url: 'https://techcrunch.com/category/artificial-intelligence/feed/',
        source: 'TechCrunch',
        domain: 'techcrunch.com',
        tags: ['人工智能'],
    },
    {
        category: 'ai',
        url: 'https://venturebeat.com/category/ai/feed/',
        source: 'VentureBeat',
        domain: 'venturebeat.com',
        tags: ['人工智能'],
    },
    {
        category: 'crypto',
        url: buildGoogleNewsRssUrl('(Bitcoin OR Ethereum OR crypto ETF OR SEC crypto OR Binance OR Coinbase OR stablecoin OR hack) when:1d'),
        source: 'Google News',
        tags: ['加密'],
    },
    {
        category: 'crypto',
        url: 'https://www.coindesk.com/arc/outboundfeeds/rss/',
        source: 'CoinDesk',
        domain: 'coindesk.com',
        tags: ['加密'],
    },
    {
        category: 'crypto',
        url: 'https://cointelegraph.com/rss',
        source: 'Cointelegraph',
        domain: 'cointelegraph.com',
        tags: ['加密'],
    },
];

function decodeXml(value: string): string {
    return value
        .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
        .replace(/&amp;/g, '&')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function getTagValue(itemXml: string, tag: string): string | undefined {
    const match = itemXml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i'));
    return match ? decodeXml(match[1]) : undefined;
}

function getSourceTag(itemXml: string): { source?: string; domain?: string } {
    const match = itemXml.match(/<source\b([^>]*)>([\s\S]*?)<\/source>/i);
    if (!match) {
        return {};
    }

    const [, attributes, content] = match;
    const source = decodeXml(content);
    const urlMatch = attributes.match(/\burl=(["'])(.*?)\1/i);

    if (!urlMatch?.[2]) {
        return { source };
    }

    try {
        const domain = new URL(urlMatch[2]).hostname.replace(/^www\./, '').toLowerCase();
        return { source, domain };
    } catch {
        return { source };
    }
}

function normalizeDate(value?: string): string | undefined {
    if (!value) return undefined;
    const timestamp = new Date(value).getTime();
    return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : undefined;
}

async function fetchTextWithTimeout(url: string): Promise<string> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), RSS_TIMEOUT_MS);

    try {
        const response = await fetch(url, {
            signal: controller.signal,
            headers: {
                'Accept': 'application/rss+xml, application/xml, text/xml',
                'User-Agent': 'binance-data-dashboard/1.0',
            },
            cache: 'no-store',
        });

        if (!response.ok) {
            throw new Error(`RSS request failed: ${response.status}`);
        }

        return await response.text();
    } finally {
        clearTimeout(timer);
    }
}

function parseRssItems(xml: string, source: RssSource, window: DailyNewsWindow): NewsCandidate[] {
    const collectedAt = new Date().toISOString();
    const itemMatches = [...xml.matchAll(/<item\b[\s\S]*?<\/item>/gi)];

    return itemMatches.map((match) => {
        const itemXml = match[0];
        const title = getTagValue(itemXml, 'title') || '';
        const link = getTagValue(itemXml, 'link') || getTagValue(itemXml, 'guid') || '';
        const description = getTagValue(itemXml, 'description') || getTagValue(itemXml, 'content:encoded');
        const publishedAt = normalizeDate(getTagValue(itemXml, 'pubDate') || getTagValue(itemXml, 'updated'));
        const feedSource = getSourceTag(itemXml);

        return {
            category: source.category,
            title,
            summary: description,
            source: feedSource.source || source.source,
            domain: feedSource.domain || source.domain,
            url: link,
            publishedAt,
            collectedAt,
            tags: [...source.tags, ...(feedSource.source ? ['聚合'] : [])],
        };
    }).filter((candidate) => {
        if (!candidate.title || !candidate.url || !candidate.publishedAt) {
            return false;
        }

        const publishedAtMs = new Date(candidate.publishedAt).getTime();
        return publishedAtMs >= window.windowStartMs && publishedAtMs <= window.windowEndMs;
    });
}

export async function fetchRssNewsCandidates(category: NewsCategory, window: DailyNewsWindow): Promise<NewsCandidate[]> {
    const sources = RSS_SOURCES.filter((source) => source.category === category);
    const results = await Promise.allSettled(sources.map(async (source) => {
        const xml = await fetchTextWithTimeout(source.url);
        return parseRssItems(xml, source, window);
    }));

    const candidates: NewsCandidate[] = [];
    results.forEach((result, index) => {
        if (result.status === 'fulfilled') {
            candidates.push(...result.value);
            return;
        }

        logger.warn('Daily news RSS fetch failed', {
            category,
            source: sources[index]?.source,
            error: result.reason instanceof Error ? result.reason.message : String(result.reason),
        });
    });

    return candidates;
}
