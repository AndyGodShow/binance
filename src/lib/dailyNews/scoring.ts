import type { ImportanceLevel, NewsCandidate, NewsCategory } from './types.ts';

interface ScoreContext {
    category: NewsCategory;
    windowEndMs: number;
    sourceCount?: number;
}

const AUTHORITY_DOMAINS: Record<string, number> = {
    'reuters.com': 24,
    'bloomberg.com': 24,
    'apnews.com': 22,
    'ft.com': 22,
    'wsj.com': 22,
    'cnbc.com': 18,
    'marketwatch.com': 16,
    'federalreserve.gov': 25,
    'ecb.europa.eu': 25,
    'boj.or.jp': 24,
    'pbc.gov.cn': 24,
    'sec.gov': 24,
    'treasury.gov': 22,
    'whitehouse.gov': 20,
    'openai.com': 24,
    'anthropic.com': 22,
    'deepmind.google': 22,
    'blog.google': 20,
    'microsoft.com': 20,
    'nvidia.com': 22,
    'meta.com': 18,
    'coindesk.com': 19,
    'theblock.co': 18,
    'decrypt.co': 15,
    'cointelegraph.com': 13,
    'bitcoinmagazine.com': 12,
};

const CATEGORY_TERMS: Record<NewsCategory, string[]> = {
    macro: [
        'fed', 'federal reserve', 'central bank', 'ecb', 'boj', 'pboc', 'pboC', 'rate', 'rates',
        'inflation', 'cpi', 'ppi', 'gdp', 'jobs', 'nonfarm', 'payrolls', 'pmi', 'treasury',
        'bond', 'yield', 'dollar', 'dxy', 'tariff', 'sanction', 'trade war', 'oil', 'gold',
    ],
    ai: [
        'ai', 'artificial intelligence', 'openai', 'anthropic', 'google', 'gemini', 'deepmind',
        'microsoft', 'meta', 'llama', 'nvidia', 'gpu', 'chip', 'semiconductor', 'model',
        'reasoning', 'agent', 'datacenter', 'data center', 'compute', 'xai',
    ],
    crypto: [
        'bitcoin', 'btc', 'ethereum', 'eth', 'crypto', 'stablecoin', 'defi', 'blockchain',
        'token', 'solana', 'sol', 'etf', 'sec', 'binance', 'coinbase', 'tether', 'usdt',
        'circle', 'usdc', 'hack', 'exploit', 'wallet', 'miner', 'mining', 'liquidation',
    ],
};

const IMPACT_TERMS = [
    'approve', 'approval', 'reject', 'ban', 'lawsuit', 'charges', 'settlement', 'hack',
    'exploit', 'breach', 'launch', 'release', 'raise', 'funding', 'merger', 'acquisition',
    'cut', 'hike', 'inflation', 'payrolls', 'cpi', 'sanctions', 'tariff', 'war', 'etf',
    'liquidation', 'default', 'bankruptcy', 'guidance', 'forecast',
];

const ORIGINAL_SOURCE_TERMS = [
    'federalreserve.gov', 'ecb.europa.eu', 'boj.or.jp', 'pbc.gov.cn', 'sec.gov',
    'treasury.gov', 'openai.com', 'anthropic.com', 'nvidia.com', 'microsoft.com',
    'googleblog.com', 'blog.google', 'binance.com', 'coinbase.com', 'circle.com', 'tether.to',
];

function normalizeDomain(domain?: string): string {
    return (domain || '')
        .toLowerCase()
        .replace(/^www\./, '')
        .trim();
}

function includesTerm(text: string, term: string): boolean {
    const escaped = term.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = /[a-z0-9]/i.test(term)
        ? new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`, 'i')
        : new RegExp(escaped, 'i');

    return pattern.test(text);
}

function countTermHits(text: string, terms: string[]): number {
    const lower = text.toLowerCase();
    return terms.reduce((count, term) => count + (includesTerm(lower, term) ? 1 : 0), 0);
}

function getAuthorityScore(candidate: NewsCandidate): number {
    const domain = normalizeDomain(candidate.domain || safeHostname(candidate.url));
    if (AUTHORITY_DOMAINS[domain] !== undefined) {
        return AUTHORITY_DOMAINS[domain];
    }

    const authority = Object.entries(AUTHORITY_DOMAINS).find(([knownDomain]) => domain.endsWith(`.${knownDomain}`));
    if (authority) {
        return authority[1];
    }

    return 8;
}

function safeHostname(url: string): string {
    try {
        return new URL(url).hostname;
    } catch {
        return '';
    }
}

function getRecencyScore(candidate: NewsCandidate, windowEndMs: number): number {
    const publishedAtMs = candidate.publishedAt ? new Date(candidate.publishedAt).getTime() : NaN;
    if (!Number.isFinite(publishedAtMs)) {
        return 2;
    }

    const ageHours = Math.max(0, (windowEndMs - publishedAtMs) / (60 * 60 * 1000));
    if (ageHours <= 3) return 8;
    if (ageHours <= 8) return 6;
    if (ageHours <= 16) return 4;
    if (ageHours <= 24) return 2;
    return 0;
}

export function toImportanceLevel(score: number): ImportanceLevel {
    if (score >= 75) return 'high';
    if (score >= 55) return 'medium';
    return 'low';
}

export function scoreNewsCandidate(candidate: NewsCandidate, context: ScoreContext): number {
    const text = `${candidate.title} ${candidate.summary || ''} ${candidate.rawSnippet || ''} ${(candidate.tags || []).join(' ')}`;
    const domain = normalizeDomain(candidate.domain || safeHostname(candidate.url));

    let score = 30;

    // Source quality is the largest single component: original filings and top-tier wires
    // should outrank reposted blog summaries even when the topic words look similar.
    score += getAuthorityScore(candidate);

    // Market-moving terms capture event magnitude: approvals, policy shifts, hacks,
    // major releases and financing events deserve to surface before routine mentions.
    score += Math.min(20, countTermHits(text, IMPACT_TERMS) * 4);

    // Category relevance keeps "latest" from beating "important"; each category has
    // its own vocabulary so macro, AI and crypto are not competing on the same words.
    score += Math.min(16, countTermHits(text, CATEGORY_TERMS[context.category]) * 2);

    if (ORIGINAL_SOURCE_TERMS.some((knownDomain) => domain === knownDomain || domain.endsWith(`.${knownDomain}`))) {
        score += 8;
    }

    const sourceCount = context.sourceCount ?? 1;
    if (sourceCount > 1) {
        score += Math.min(10, (sourceCount - 1) * 4);
    }

    score += getRecencyScore(candidate, context.windowEndMs);

    return Math.max(0, Math.min(100, Math.round(score)));
}

export function getCategoryTerms(category: NewsCategory): string[] {
    return CATEGORY_TERMS[category];
}
