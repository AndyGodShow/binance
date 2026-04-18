import { createHash } from 'node:crypto';

import { getCategoryTerms, scoreNewsCandidate, toImportanceLevel } from './scoring.ts';
import {
    NEWS_CATEGORIES,
    type CategoryCollectionResult,
    type DailyNewsDigest,
    type DailyNewsItem,
    type DailyNewsWindow,
    type NewsCandidate,
    type NewsCategory,
} from './types.ts';

const DEFAULT_TIMEZONE = 'Asia/Shanghai';
const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_CATEGORY_LIMIT = 10;

const STOP_WORDS = new Set([
    'the', 'and', 'for', 'with', 'from', 'that', 'this', 'after', 'into', 'over', 'under',
    'about', 'amid', 'says', 'said', 'will', 'new', 'its', 'are', 'was', 'has', 'have',
    'a', 'an', 'to', 'of', 'in', 'on', 'as', 'by', 'at', 'is',
]);

const CATEGORY_LABELS: Record<NewsCategory, string> = {
    macro: '宏观',
    ai: 'AI',
    crypto: '加密',
};

function includesTerm(text: string, term: string): boolean {
    const escaped = term.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = /[a-z0-9]/i.test(term)
        ? new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`, 'i')
        : new RegExp(escaped, 'i');

    return pattern.test(text);
}

interface DropCounters {
    outsideWindow: number;
    irrelevant: number;
    duplicates: number;
    invalidDate: number;
    invalidUrl: number;
}

interface CandidateGroup {
    canonicalUrl: string;
    titleTokens: Set<string>;
    candidates: NewsCandidate[];
    sources: Set<string>;
}

export function calculateDailyNewsWindow(now: Date = new Date(), timezone = DEFAULT_TIMEZONE): DailyNewsWindow {
    const windowEndMs = now.getTime();
    const windowStartMs = windowEndMs - DAY_MS;

    return {
        windowStart: new Date(windowStartMs).toISOString(),
        windowEnd: new Date(windowEndMs).toISOString(),
        windowStartMs,
        windowEndMs,
        timezone,
    };
}

function formatInTimeZone(iso: string, timezone: string): string {
    const formatter = new Intl.DateTimeFormat('en-CA', {
        timeZone: timezone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23',
    });
    const parts = Object.fromEntries(
        formatter.formatToParts(new Date(iso)).map((part) => [part.type, part.value])
    );

    return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}`;
}

export function formatDailyNewsWindow(window: DailyNewsWindow): string {
    return `${formatInTimeZone(window.windowStart, window.timezone)} ~ ${formatInTimeZone(window.windowEnd, window.timezone)}`;
}

function safeUrl(value: string): URL | null {
    try {
        const parsed = new URL(value);
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
            return null;
        }
        return parsed;
    } catch {
        return null;
    }
}

function normalizeDomain(domain?: string, url?: string): string {
    const fromDomain = domain?.trim();
    if (fromDomain) {
        return fromDomain.toLowerCase().replace(/^www\./, '');
    }

    if (!url) {
        return '';
    }

    return safeUrl(url)?.hostname.toLowerCase().replace(/^www\./, '') || '';
}

function canonicalizeUrl(value: string): string | null {
    const parsed = safeUrl(value);
    if (!parsed) {
        return null;
    }

    parsed.hash = '';
    parsed.search = '';
    parsed.hostname = parsed.hostname.toLowerCase().replace(/^www\./, '');

    return parsed.toString().replace(/\/$/, '');
}

function resolvePublishedAt(candidate: NewsCandidate): string | null {
    const candidates = [candidate.publishedAt, candidate.collectedAt].filter(Boolean) as string[];
    for (const value of candidates) {
        const timestamp = new Date(value).getTime();
        if (Number.isFinite(timestamp)) {
            return new Date(timestamp).toISOString();
        }
    }
    return null;
}

function tokenizeTitle(title: string): Set<string> {
    const tokens = title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, ' ')
        .split(/\s+/)
        .map((token) => token.trim())
        .filter((token) => token.length > 2 && !STOP_WORDS.has(token));

    return new Set(tokens);
}

function titleSimilarity(a: Set<string>, b: Set<string>): number {
    if (a.size === 0 || b.size === 0) {
        return 0;
    }

    let intersection = 0;
    a.forEach((token) => {
        if (b.has(token)) {
            intersection += 1;
        }
    });

    return intersection / Math.min(a.size, b.size);
}

export function isNewsCandidateRelevant(candidate: NewsCandidate, category: NewsCategory): boolean {
    const text = `${candidate.title} ${candidate.summary || ''} ${candidate.rawSnippet || ''} ${(candidate.tags || []).join(' ')}`.toLowerCase();
    const terms = getCategoryTerms(category);
    const hits = terms.filter((term) => includesTerm(text, term)).length;

    return hits >= 1;
}

function extractTags(candidate: NewsCandidate, category: NewsCategory): string[] {
    const text = `${candidate.title} ${candidate.summary || ''} ${candidate.rawSnippet || ''}`.toLowerCase();
    const tags = new Set<string>(candidate.tags || []);

    const tagRules: Array<[string, string[]]> = [
        ['Fed', ['fed', 'federal reserve']],
        ['利率', ['rate', 'rates', 'yield', 'treasury']],
        ['通胀', ['inflation', 'cpi', 'ppi']],
        ['地缘政治', ['war', 'sanction', 'tariff']],
        ['OpenAI', ['openai']],
        ['NVIDIA', ['nvidia', 'gpu']],
        ['模型', ['model', 'reasoning', 'agent']],
        ['芯片', ['chip', 'semiconductor', 'accelerator']],
        ['BTC', ['bitcoin', 'btc']],
        ['ETH', ['ethereum', 'ether', 'eth']],
        ['ETF', ['etf']],
        ['SEC', ['sec']],
        ['安全事件', ['hack', 'exploit', 'breach']],
        ['稳定币', ['stablecoin', 'usdt', 'usdc', 'tether', 'circle']],
    ];

    tagRules.forEach(([tag, terms]) => {
        if (terms.some((term) => includesTerm(text, term))) {
            tags.add(tag);
        }
    });

    tags.add(CATEGORY_LABELS[category]);

    return [...tags].slice(0, 8);
}

function buildSummary(candidate: NewsCandidate, category: NewsCategory, tags: string[]): string {
    if (candidate.summary && candidate.summary.trim().length > 24) {
        return candidate.summary.trim();
    }

    const subject = tags.filter((tag) => tag !== CATEGORY_LABELS[category]).slice(0, 3).join('、') || CATEGORY_LABELS[category];

    if (category === 'macro') {
        return `报道聚焦 ${subject} 相关变化，可能影响利率预期、美元流动性和全球风险资产定价。`;
    }

    if (category === 'ai') {
        return `事件涉及 ${subject}，对 AI 产业竞争、算力需求或产品商业化节奏有潜在影响。`;
    }

    return `事件涉及 ${subject}，可能影响加密市场流动性、监管预期或交易者风险偏好。`;
}

function buildStableId(category: NewsCategory, canonicalUrl: string, title: string): string {
    const hash = createHash('sha1')
        .update(`${category}:${canonicalUrl}:${title.toLowerCase()}`)
        .digest('hex')
        .slice(0, 16);

    return `${category}-${hash}`;
}

function toItem(candidate: NewsCandidate, category: NewsCategory, window: DailyNewsWindow, sourceCount: number): DailyNewsItem {
    const canonicalUrl = canonicalizeUrl(candidate.url) || candidate.url;
    const tags = extractTags(candidate, category);
    if (sourceCount > 1) {
        tags.push(`${sourceCount} 家来源`);
    }
    const score = scoreNewsCandidate(candidate, { category, windowEndMs: window.windowEndMs, sourceCount });

    return {
        id: buildStableId(category, canonicalUrl, candidate.title),
        category,
        title: candidate.title.trim(),
        summary: buildSummary(candidate, category, tags),
        source: candidate.source || normalizeDomain(candidate.domain, candidate.url) || 'Unknown',
        url: candidate.url,
        publishedAt: resolvePublishedAt(candidate) || candidate.collectedAt,
        collectedAt: candidate.collectedAt,
        importanceScore: score,
        importanceLevel: toImportanceLevel(score),
        tags,
    };
}

export function dedupeAndRankCandidates(
    category: NewsCategory,
    candidates: NewsCandidate[],
    window: DailyNewsWindow,
    limit = DEFAULT_CATEGORY_LIMIT
) {
    const dropped: DropCounters = {
        outsideWindow: 0,
        irrelevant: 0,
        duplicates: 0,
        invalidDate: 0,
        invalidUrl: 0,
    };
    const groups: CandidateGroup[] = [];

    for (const candidate of candidates) {
        const canonicalUrl = canonicalizeUrl(candidate.url);
        if (!canonicalUrl) {
            dropped.invalidUrl += 1;
            continue;
        }

        const publishedAt = resolvePublishedAt(candidate);
        if (!publishedAt) {
            dropped.invalidDate += 1;
            continue;
        }

        const publishedAtMs = new Date(publishedAt).getTime();
        if (publishedAtMs < window.windowStartMs || publishedAtMs > window.windowEndMs) {
            dropped.outsideWindow += 1;
            continue;
        }

        if (!isNewsCandidateRelevant(candidate, category)) {
            dropped.irrelevant += 1;
            continue;
        }

        const normalizedCandidate = {
            ...candidate,
            category,
            domain: normalizeDomain(candidate.domain, candidate.url),
            publishedAt,
        };
        const titleTokens = tokenizeTitle(candidate.title);
        const existingGroup = groups.find((group) => (
            group.canonicalUrl === canonicalUrl || titleSimilarity(group.titleTokens, titleTokens) >= 0.62
        ));

        if (existingGroup) {
            existingGroup.candidates.push(normalizedCandidate);
            existingGroup.sources.add(normalizedCandidate.source || normalizedCandidate.domain || canonicalUrl);
            dropped.duplicates += 1;
        } else {
            groups.push({
                canonicalUrl,
                titleTokens,
                candidates: [normalizedCandidate],
                sources: new Set([normalizedCandidate.source || normalizedCandidate.domain || canonicalUrl]),
            });
        }
    }

    const items = groups.map((group) => {
        const sourceCount = group.sources.size;
        const bestCandidate = [...group.candidates].sort((a, b) => (
            scoreNewsCandidate(b, { category, windowEndMs: window.windowEndMs, sourceCount })
            - scoreNewsCandidate(a, { category, windowEndMs: window.windowEndMs, sourceCount })
        ))[0];

        return toItem(bestCandidate, category, window, sourceCount);
    }).sort((a, b) => {
        if (b.importanceScore !== a.importanceScore) {
            return b.importanceScore - a.importanceScore;
        }
        return new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime();
    }).slice(0, limit);

    return {
        items,
        dropped,
    };
}

function emptyStatus(error?: string) {
    return {
        status: error ? 'failed' as const : 'partial' as const,
        requested: 0,
        returned: 0,
        dropped: {
            outsideWindow: 0,
            irrelevant: 0,
            duplicates: 0,
            invalidDate: 0,
            invalidUrl: 0,
        },
        ...(error ? { error } : {}),
    };
}

export function buildDailyNewsDigestFromResults(
    results: CategoryCollectionResult[],
    window: DailyNewsWindow,
    limit = DEFAULT_CATEGORY_LIMIT
): DailyNewsDigest {
    const byCategory = new Map(results.map((result) => [result.category, result]));
    const digest: DailyNewsDigest = {
        generatedAt: window.windowEnd,
        windowStart: window.windowStart,
        windowEnd: window.windowEnd,
        timezone: window.timezone,
        macro: [],
        ai: [],
        crypto: [],
        categoryStatus: {
            macro: emptyStatus(),
            ai: emptyStatus(),
            crypto: emptyStatus(),
        },
    };

    NEWS_CATEGORIES.forEach((category) => {
        const result = byCategory.get(category);
        if (!result || !result.ok) {
            digest[category] = [];
            digest.categoryStatus[category] = emptyStatus(result?.error || 'Category collection failed');
            return;
        }

        const ranked = dedupeAndRankCandidates(category, result.candidates, window, limit);
        digest[category] = ranked.items;
        digest.categoryStatus[category] = {
            status: ranked.items.length >= limit ? 'ok' : 'partial',
            requested: result.candidates.length,
            returned: ranked.items.length,
            dropped: ranked.dropped,
        };
    });

    return digest;
}

export function hasAnyDailyNewsItems(digest: DailyNewsDigest): boolean {
    return NEWS_CATEGORIES.some((category) => digest[category].length > 0);
}
