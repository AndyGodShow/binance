import { createHash } from 'node:crypto';

import { getCategoryTerms, scoreNewsCandidate, toImportanceLevel } from './scoring.ts';
import {
    NEWS_CATEGORIES,
    type CategoryCollectionResult,
    type DailyNewsBrief,
    type DailyNewsDigest,
    type DailyNewsEventSource,
    type DailyNewsItem,
    type DailyNewsScoreBreakdown,
    type DailyNewsSummarySections,
    type DailyNewsTimelineEntry,
    type DailyNewsTopStory,
    type DailyNewsWindow,
    type ImportanceLevel,
    type ImpactDirection,
    type ImpactHorizon,
    type NewsCandidate,
    type NewsCategory,
    type NewsConfirmationLevel,
    type NewsEventStatus,
    type NewsRiskBias,
    type NewsSourceTier,
} from './types.ts';

const DEFAULT_TIMEZONE = 'Asia/Shanghai';
const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_CATEGORY_LIMIT = 10;
const MIN_EDITORIAL_IMPORTANCE_SCORE = 58;
const TOP_STORY_MIN_SCORE = 62;
const EVENT_GROUP_WINDOW_MS = 8 * 60 * 60 * 1000;

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

const SUBCATEGORY_RULES: Record<NewsCategory, Array<[string, string[]]>> = {
    macro: [
        ['央行', ['fed', 'federal reserve', 'ecb', 'boj', 'pboc', 'central bank', 'rate', 'rates']],
        ['通胀', ['inflation', 'cpi', 'ppi']],
        ['就业', ['jobs', 'payrolls', 'nonfarm']],
        ['地缘', ['war', 'sanction', 'sanctions', 'tariff', 'trade war', 'geopolitical']],
        ['商品', ['oil', 'gold']],
    ],
    ai: [
        ['模型', ['openai', 'anthropic', 'gemini', 'deepmind', 'llama', 'model', 'reasoning', 'agent']],
        ['芯片', ['nvidia', 'gpu', 'chip', 'semiconductor', 'accelerator']],
        ['云与算力', ['datacenter', 'data center', 'compute', 'microsoft', 'google']],
        ['监管', ['regulation', 'regulator', 'lawsuit']],
        ['融资', ['funding', 'raise', 'investment']],
    ],
    crypto: [
        ['ETF', ['etf']],
        ['监管', ['sec', 'lawsuit', 'charges', 'settlement', 'approve', 'approval', 'ban']],
        ['稳定币', ['stablecoin', 'usdt', 'usdc', 'tether', 'circle']],
        ['安全事件', ['hack', 'exploit', 'breach']],
        ['交易所', ['binance', 'coinbase', 'exchange']],
        ['链上与清算', ['defi', 'wallet', 'liquidation', 'miner', 'mining']],
    ],
};

const ASSET_RULES: Array<[string, string[]]> = [
    ['BTC', ['bitcoin', 'btc']],
    ['ETH', ['ethereum', 'ether', 'eth']],
    ['SOL', ['solana', 'sol']],
    ['BNB', ['bnb', 'binance']],
    ['USDT', ['usdt', 'tether']],
    ['USDC', ['usdc', 'circle']],
    ['NVIDIA', ['nvidia', 'gpu']],
    ['OpenAI', ['openai']],
    ['Anthropic', ['anthropic']],
    ['Microsoft', ['microsoft']],
    ['Google', ['google', 'gemini', 'deepmind']],
    ['DXY', ['dollar', 'dxy']],
    ['UST', ['treasury', 'yield', 'yields', 'bond']],
    ['Gold', ['gold']],
    ['Oil', ['oil']],
];

const RISK_ON_TERMS = ['approve', 'approval', 'launch', 'release', 'inflow', 'inflows', 'funding', 'raise', 'breakout', 'improves'];
const RISK_OFF_TERMS = ['reject', 'ban', 'lawsuit', 'charges', 'hack', 'exploit', 'breach', 'war', 'sanction', 'sanctions', 'tariff', 'liquidation', 'default', 'bankruptcy', 'inflation'];
const LONG_HORIZON_TERMS = ['regulation', 'regulator', 'lawsuit', 'settlement', 'tariff', 'sanction', 'sanctions', 'funding', 'acquisition'];
const INTRADAY_TERMS = ['cpi', 'ppi', 'payrolls', 'jobs', 'hack', 'exploit', 'liquidation', 'rate', 'rates'];
const GENERIC_DRIVER_TAGS = new Set(['市场', '聚合', '宏观', 'AI', '加密', '人工智能']);
const ROUTINE_NOISE_TERMS = [
    'ama', 'airdrop', 'giveaway', 'community event', 'community campaign', 'roadmap update',
    'partnership', 'collaboration', 'listing rumor', 'price prediction', 'analyst predicts',
    'trader predicts', 'jumps', 'surges', 'rallies', 'drops', 'falls',
    'seed round', 'small funding', 'small financing', 'chatbot app', 'ordinary listing',
    'lists on', 'new listing', 'integration', 'integrates with', 'testnet', 'nft event',
    'staking campaign', 'marketing campaign', 'opinion', 'columnist', 'rumor',
];
const SYSTEMIC_IMPORTANCE_TERMS = [
    'sec', 'cftc', 'federal reserve', 'fed', 'ecb', 'boj', 'pboc', 'cpi', 'ppi',
    'nonfarm', 'payrolls', 'etf', 'stablecoin', 'hack', 'exploit', 'breach',
    'lawsuit', 'charges', 'settlement', 'ban', 'approve', 'approval', 'reserve',
    'reserves', 'bankruptcy', 'default', 'acquisition', 'merger', 'tariff', 'sanction',
    'binance', 'coinbase', 'tether', 'circle', 'openai', 'anthropic', 'nvidia',
    'kraken', 'okx', 'solana', 'outage', 'depeg', 'custody', 'withdrawal', 'wallet security',
];
const SOCIAL_RUMOR_DOMAINS = ['x.com', 'twitter.com', 't.me', 'telegram.org', 'reddit.com'];
const LOW_VALUE_AI_TERMS = ['small funding', 'seed round', 'chatbot app', 'startup announces'];
const LOW_VALUE_CRYPTO_TERMS = ['small defi', 'low market cap', 'tiny token', 'altcoin project'];
const OFFICIAL_SOURCE_DOMAINS = [
    'federalreserve.gov', 'ecb.europa.eu', 'boj.or.jp', 'pbc.gov.cn', 'sec.gov',
    'treasury.gov', 'whitehouse.gov', 'openai.com', 'anthropic.com', 'nvidia.com',
    'microsoft.com', 'blog.google', 'binance.com', 'coinbase.com', 'circle.com',
    'tether.to',
];
const MAJOR_SOURCE_DOMAINS = [
    'reuters.com', 'bloomberg.com', 'apnews.com', 'ft.com', 'wsj.com', 'cnbc.com',
    'marketwatch.com',
];
const SPECIALIST_SOURCE_DOMAINS = [
    'coindesk.com', 'theblock.co', 'decrypt.co', 'cointelegraph.com', 'bitcoinmagazine.com',
];
const CORE_ENTITY_RULES: Array<[string, string[]]> = [
    ['BTC', ['bitcoin', 'btc']],
    ['ETH', ['ethereum', 'ether', 'eth']],
    ['SOL', ['solana', 'sol']],
    ['SEC', ['sec', 'securities and exchange commission']],
    ['CFTC', ['cftc']],
    ['FED', ['fed', 'federal reserve']],
    ['ECB', ['ecb']],
    ['PBOC', ['pboc']],
    ['ETF', ['etf', 'exchange-traded fund', 'exchange traded fund']],
    ['USDT', ['usdt', 'tether']],
    ['USDC', ['usdc', 'circle']],
    ['BINANCE', ['binance']],
    ['COINBASE', ['coinbase']],
    ['KRAKEN', ['kraken']],
    ['OKX', ['okx']],
    ['OPENAI', ['openai']],
    ['ANTHROPIC', ['anthropic']],
    ['GOOGLE', ['google', 'gemini', 'deepmind']],
    ['META', ['meta', 'llama']],
    ['NVIDIA', ['nvidia', 'gpu']],
];
const CATEGORY_WEIGHT_TERMS: Record<string, string[]> = {
    regulation: ['sec', 'cftc', 'lawsuit', 'charges', 'settlement', 'ban', 'regulation', 'regulator'],
    etf: ['etf'],
    stablecoin: ['stablecoin', 'usdt', 'usdc', 'tether', 'circle', 'depeg', 'reserve'],
    exchange: ['binance', 'coinbase', 'kraken', 'okx', 'exchange', 'withdrawal', 'custody'],
    security: ['hack', 'exploit', 'breach', 'security incident', 'wallet incident'],
    macro: ['fed', 'federal reserve', 'cpi', 'inflation', 'rates', 'dollar', 'treasury', 'central bank'],
    aiInfrastructure: ['nvidia', 'gpu', 'chip', 'semiconductor', 'data center', 'compute', 'frontier model'],
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
    unimportant: number;
    duplicates: number;
    invalidDate: number;
    invalidUrl: number;
}

interface CandidateGroup {
    canonicalUrl: string;
    titleTokens: Set<string>;
    candidates: NewsCandidate[];
    sources: Set<string>;
    coreEntities: Set<string>;
    firstPublishedAtMs: number;
    latestPublishedAtMs: number;
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

function domainMatches(domain: string, knownDomains: string[]): boolean {
    return knownDomains.some((knownDomain) => domain === knownDomain || domain.endsWith(`.${knownDomain}`));
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

function candidateFullText(candidate: NewsCandidate, extra: string[] = []): string {
    return `${candidate.title} ${candidate.summary || ''} ${candidate.rawSnippet || ''} ${(candidate.tags || []).join(' ')} ${extra.join(' ')}`.toLowerCase();
}

function extractCoreEntities(candidate: NewsCandidate, tags: string[] = []): string[] {
    const text = candidateFullText(candidate, tags);
    return CORE_ENTITY_RULES
        .filter(([, terms]) => terms.some((term) => includesTerm(text, term)))
        .map(([entity]) => entity);
}

function sharedEntityCount(a: Set<string>, b: Set<string>): number {
    let count = 0;
    a.forEach((value) => {
        if (b.has(value)) count += 1;
    });
    return count;
}

function groupTimeDistanceMs(group: CandidateGroup, publishedAtMs: number): number {
    if (!Number.isFinite(group.firstPublishedAtMs) || !Number.isFinite(group.latestPublishedAtMs)) {
        return 0;
    }

    if (publishedAtMs < group.firstPublishedAtMs) return group.firstPublishedAtMs - publishedAtMs;
    if (publishedAtMs > group.latestPublishedAtMs) return publishedAtMs - group.latestPublishedAtMs;
    return 0;
}

function isSameEventGroup(group: CandidateGroup, canonicalUrl: string, titleTokens: Set<string>, coreEntities: Set<string>, publishedAtMs: number): boolean {
    if (group.canonicalUrl === canonicalUrl) {
        return true;
    }

    if (titleSimilarity(group.titleTokens, titleTokens) >= 0.62) {
        return true;
    }

    const sharedEntities = sharedEntityCount(group.coreEntities, coreEntities);
    return sharedEntities >= 2 && groupTimeDistanceMs(group, publishedAtMs) <= EVENT_GROUP_WINDOW_MS;
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
        ['交易所', ['binance', 'coinbase', 'kraken', 'okx', 'exchange']],
        ['托管安全', ['custody', 'withdrawal', 'wallet', 'security incident']],
        ['脱锚', ['depeg', 'depegs']],
    ];

    tagRules.forEach(([tag, terms]) => {
        if (terms.some((term) => includesTerm(text, term))) {
            tags.add(tag);
        }
    });

    tags.add(CATEGORY_LABELS[category]);

    return [...tags].slice(0, 8);
}

function candidateText(candidate: NewsCandidate, tags: string[] = []): string {
    return candidateFullText(candidate, tags);
}

function inferSubcategory(candidate: NewsCandidate, category: NewsCategory, tags: string[]): string {
    const text = candidateText(candidate, tags);
    const match = SUBCATEGORY_RULES[category].find(([, terms]) => terms.some((term) => includesTerm(text, term)));
    return match?.[0] || CATEGORY_LABELS[category];
}

function extractAffectedAssets(candidate: NewsCandidate, tags: string[]): string[] {
    const text = candidateText(candidate, tags);
    return ASSET_RULES
        .filter(([, terms]) => terms.some((term) => includesTerm(text, term)))
        .map(([asset]) => asset)
        .slice(0, 6);
}

function inferImpactDirection(candidate: NewsCandidate, tags: string[]): ImpactDirection {
    const text = candidateText(candidate, tags);
    const riskOnHits = RISK_ON_TERMS.filter((term) => includesTerm(text, term)).length;
    const riskOffHits = RISK_OFF_TERMS.filter((term) => includesTerm(text, term)).length;

    if (riskOnHits > 0 && riskOffHits > 0) return 'mixed';
    if (riskOnHits > 0) return 'risk_on';
    if (riskOffHits > 0) return 'risk_off';
    return 'neutral';
}

function inferImpactHorizon(candidate: NewsCandidate, category: NewsCategory, tags: string[]): ImpactHorizon {
    const text = candidateText(candidate, tags);
    if (INTRADAY_TERMS.some((term) => includesTerm(text, term))) {
        return 'intraday';
    }
    if (category === 'ai' || LONG_HORIZON_TERMS.some((term) => includesTerm(text, term))) {
        return '1-4w';
    }
    return '1-3d';
}

function sourceWeight(sourceTier: NewsSourceTier): number {
    if (sourceTier === 'official') return 22;
    if (sourceTier === 'major') return 18;
    if (sourceTier === 'specialist') return 14;
    if (sourceTier === 'aggregated') return 8;
    return 5;
}

function confirmationWeight(confirmationLevel: NewsConfirmationLevel): number {
    if (confirmationLevel === 'official') return 18;
    if (confirmationLevel === 'multi_source') return 15;
    if (confirmationLevel === 'single_authoritative') return 10;
    return 3;
}

function categoryWeight(category: NewsCategory, text: string): number {
    let weight = 0;
    if (CATEGORY_WEIGHT_TERMS.regulation.some((term) => includesTerm(text, term))) weight += 12;
    if (CATEGORY_WEIGHT_TERMS.etf.some((term) => includesTerm(text, term))) weight += 12;
    if (CATEGORY_WEIGHT_TERMS.stablecoin.some((term) => includesTerm(text, term))) weight += 13;
    if (CATEGORY_WEIGHT_TERMS.exchange.some((term) => includesTerm(text, term))) weight += 12;
    if (CATEGORY_WEIGHT_TERMS.security.some((term) => includesTerm(text, term))) weight += 16;
    if (category === 'macro' && CATEGORY_WEIGHT_TERMS.macro.some((term) => includesTerm(text, term))) weight += 12;
    if (category === 'ai' && CATEGORY_WEIGHT_TERMS.aiInfrastructure.some((term) => includesTerm(text, term))) weight += 12;
    if (category === 'crypto') weight += 6;
    return Math.min(22, weight);
}

function impactWeight(text: string, coreEntities: string[]): number {
    let weight = 0;
    if (coreEntities.length >= 2) weight += 6;
    if (['BTC', 'ETH', 'SOL', 'SEC', 'CFTC', 'FED', 'BINANCE', 'COINBASE', 'USDT', 'USDC', 'OPENAI', 'NVIDIA'].some((entity) => coreEntities.includes(entity))) {
        weight += 8;
    }
    if (['hack', 'exploit', 'breach', 'security incident', 'depeg', 'withdrawal', 'reserve', 'lawsuit', 'charges', 'approval', 'approve', 'ban'].some((term) => includesTerm(text, term))) {
        weight += 10;
    }
    if (['infrastructure', 'custody', 'stablecoin', 'exchange', 'central bank', 'rates', 'chip', 'gpu', 'data center'].some((term) => includesTerm(text, term))) {
        weight += 6;
    }
    return Math.min(22, weight);
}

function noveltyWeight(sourceCount: number, hasRoutineNoise: boolean): number {
    if (hasRoutineNoise) return 2;
    if (sourceCount > 1) return 9;
    return 7;
}

function scoreFromBreakdown(breakdown: DailyNewsScoreBreakdown): number {
    return Math.max(0, Math.min(100, Math.round(
        breakdown.entityWeight
        + breakdown.sourceWeight
        + breakdown.confirmationWeight
        + breakdown.categoryWeight
        + breakdown.noveltyWeight
        + breakdown.impactWeight
    )));
}

function toImportanceLevelFromScore(score: number): ImportanceLevel {
    return toImportanceLevel(score);
}

function buildWhyItMatters(category: NewsCategory, subcategory: string, assets: string[], direction: ImpactDirection): string {
    const assetText = assets.length > 0 ? assets.slice(0, 3).join('、') : CATEGORY_LABELS[category];
    const contextText: Record<ImpactDirection, string> = {
        risk_on: '说明规则、资金或产业叙事出现增量变化',
        risk_off: '暴露出监管、安全或流动性约束',
        mixed: '同时带来机会与约束，后续需要看细节如何落地',
        neutral: '当前更适合作为背景信息跟踪',
    };

    if (category === 'macro') {
        return `${subcategory}事件会影响市场对利率、通胀和全球流动性的理解，${contextText[direction]}。`;
    }

    if (category === 'ai') {
        return `${subcategory}事件可能改变 AI 产业竞争、算力需求或监管边界，重点放在 ${assetText} 的产业位置变化。`;
    }

    return `${subcategory}事件可能改变 ${assetText} 所在生态的监管预期、基础设施安全或行业叙事，${contextText[direction]}。`;
}

function buildWatchpoints(category: NewsCategory, assets: string[], direction: ImpactDirection, horizon: ImpactHorizon): string[] {
    const points: string[] = [];

    if (category === 'macro') {
        points.push('后续看官方口径、关键数据修正和主要央行是否给出一致信号。');
        points.push('确认这件事是单次扰动，还是会改变未来数周的政策预期。');
    } else if (category === 'ai') {
        points.push('后续看产品、算力、监管或商业化细节是否有官方文件确认。');
        points.push('确认它影响的是单家公司，还是会改变模型、芯片或云服务竞争格局。');
    } else {
        points.push('后续看官方公告、监管文件、链上证据或审计报告是否确认细节。');
        points.push('确认它影响的是单个项目，还是会外溢到交易所、稳定币、ETF 或主流公链。');
    }

    if (direction === 'risk_off') {
        points.push('重点留意损失金额、处罚范围、补偿方案或监管态度是否扩大。');
    } else if (direction === 'risk_on') {
        points.push('重点留意最终规则、产品上线节奏和参与机构名单是否继续明确。');
    } else {
        points.push('等待更多来源交叉确认，再判断这是否属于结构性变化。');
    }

    if (horizon === 'intraday') {
        points.push('短期消息需要复核发布时间、原始来源和是否已有后续更正。');
    }

    return points.slice(0, 4);
}

function inferSourceTier(candidate: NewsCandidate): NewsSourceTier {
    const domain = normalizeDomain(candidate.domain, candidate.url);
    if (domainMatches(domain, OFFICIAL_SOURCE_DOMAINS)) return 'official';
    if (domainMatches(domain, MAJOR_SOURCE_DOMAINS)) return 'major';
    if (domainMatches(domain, SPECIALIST_SOURCE_DOMAINS)) return 'specialist';
    if (domain.includes('news.google') || candidate.source.toLowerCase().includes('google news')) return 'aggregated';
    return 'unknown';
}

function toEventSource(candidate: NewsCandidate): DailyNewsEventSource {
    return {
        source: candidate.source || normalizeDomain(candidate.domain, candidate.url) || 'Unknown',
        domain: normalizeDomain(candidate.domain, candidate.url),
        url: candidate.url,
        publishedAt: resolvePublishedAt(candidate) || candidate.collectedAt,
        sourceTier: inferSourceTier(candidate),
    };
}

function inferConfirmationLevel(sourceTier: NewsSourceTier, sourceCount: number): NewsConfirmationLevel {
    if (sourceTier === 'official') return 'official';
    if (sourceCount > 1) return 'multi_source';
    if (sourceTier === 'major' || sourceTier === 'specialist') return 'single_authoritative';
    return 'single_source';
}

function inferEventStatus(candidates: NewsCandidate[], confirmationLevel: NewsConfirmationLevel): NewsEventStatus {
    const text = candidates.map((candidate) => candidateFullText(candidate)).join(' ');
    if (['retract', 'retracted', 'false', 'not true', 'reversal', 'walks back'].some((term) => includesTerm(text, term))) {
        return 'reversed';
    }
    if (['dispute', 'disputed', 'denies', 'denied', 'conflicting'].some((term) => includesTerm(text, term))) {
        return 'disputed';
    }
    if (confirmationLevel === 'official' || confirmationLevel === 'multi_source') {
        return 'confirmed';
    }
    return 'pending';
}

function buildTimeline(candidates: NewsCandidate[]): DailyNewsTimelineEntry[] {
    const sorted = [...candidates].sort((a, b) => {
        const aTime = new Date(resolvePublishedAt(a) || a.collectedAt).getTime();
        const bTime = new Date(resolvePublishedAt(b) || b.collectedAt).getTime();
        return aTime - bTime;
    });
    let hasFollowUp = false;

    return sorted.map((candidate, index) => {
        const sourceTier = inferSourceTier(candidate);
        let label: DailyNewsTimelineEntry['label'] = '后续更新';
        if (index === 0) {
            label = '首次报道';
        } else if (sourceTier === 'official') {
            label = '官方确认';
        } else if (!hasFollowUp) {
            label = '多源跟进';
            hasFollowUp = true;
        }

        return {
            ...toEventSource(candidate),
            label,
            title: candidate.title,
        };
    }).slice(0, 5);
}

function buildEditorialReason(
    item: Pick<DailyNewsItem, 'subcategory' | 'tags' | 'sourceTier' | 'confirmationLevel' | 'scoreBreakdown'>,
    category: NewsCategory,
    sourceCount: number
): string {
    const sourceText: Record<NewsConfirmationLevel, string> = {
        official: '官方来源确认',
        multi_source: `${sourceCount} 家来源交叉报道`,
        single_authoritative: '权威/专业来源报道',
        single_source: '单一来源报道',
    };
    const categoryText: Record<NewsCategory, string> = {
        macro: '宏观政策或大类资产背景',
        ai: 'AI 产业结构或监管边界',
        crypto: '加密行业监管、交易所、安全或基础设施',
    };
    const topic = item.subcategory || CATEGORY_LABELS[category];
    const strongTags = item.tags
        .filter((tag) => !GENERIC_DRIVER_TAGS.has(tag))
        .slice(0, 2);
    const tagText = strongTags.length > 0 ? `，关联 ${strongTags.join('、')}` : '';
    const scoreText = item.scoreBreakdown
        ? `评分由实体 ${item.scoreBreakdown.entityWeight}、来源 ${item.scoreBreakdown.sourceWeight}、确认 ${item.scoreBreakdown.confirmationWeight}、类别 ${item.scoreBreakdown.categoryWeight}、新信息 ${item.scoreBreakdown.noveltyWeight}、影响 ${item.scoreBreakdown.impactWeight} 组成`
        : '';

    return `${sourceText[item.confirmationLevel || 'single_source']}，属于${categoryText[category]}中的${topic}事件${tagText}。${scoreText ? ` ${scoreText}。` : ''}`;
}

function buildSummarySections(
    item: Pick<DailyNewsItem, 'title' | 'summary' | 'category' | 'source' | 'sourceTier' | 'confirmationLevel' | 'whyItMatters' | 'watchpoints' | 'eventStatus'>
): DailyNewsSummarySections {
    const confirmationText: Record<NewsConfirmationLevel, string> = {
        official: '官方确认',
        multi_source: '多源交叉',
        single_authoritative: '权威单源',
        single_source: '单源待复核',
    };
    const sourceTierText: Record<NewsSourceTier, string> = {
        official: '官方来源',
        major: '主流媒体',
        specialist: '专业媒体',
        aggregated: '聚合来源',
        unknown: '普通来源',
    };
    const statusText: Record<NewsEventStatus, string> = {
        pending: '待确认',
        confirmed: '已确认',
        disputed: '有争议',
        reversed: '已反转',
    };

    return {
        whatHappened: `发生了什么：${item.summary || item.title}`,
        whyImportant: `为什么重要：${item.whyItMatters || '这会影响相关行业结构或政策预期。'}`,
        whatToWatch: `后续看什么：${item.watchpoints?.[0] || '后续看官方文件、数据修正和更多来源是否确认。'}`,
        sourceAndConfirmation: `来源与确认度：${item.source}，${sourceTierText[item.sourceTier || 'unknown']}，${confirmationText[item.confirmationLevel || 'single_source']}，当前状态${statusText[item.eventStatus || 'pending']}。`,
    };
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

    return `事件涉及 ${subject}，可能影响加密行业的流动性结构、监管预期或基础设施信任。`;
}

function buildStableId(category: NewsCategory, canonicalUrl: string, title: string): string {
    const hash = createHash('sha1')
        .update(`${category}:${canonicalUrl}:${title.toLowerCase()}`)
        .digest('hex')
        .slice(0, 16);

    return `${category}-${hash}`;
}

function toItem(candidate: NewsCandidate, category: NewsCategory, window: DailyNewsWindow, sourceCount: number, groupCandidates: NewsCandidate[] = [candidate]): DailyNewsItem {
    const canonicalUrl = canonicalizeUrl(candidate.url) || candidate.url;
    const tags = extractTags(candidate, category);
    if (sourceCount > 1) {
        tags.push(`${sourceCount} 家来源`);
    }
    const subcategory = inferSubcategory(candidate, category, tags);
    const affectedAssets = extractAffectedAssets(candidate, tags);
    const impactDirection = inferImpactDirection(candidate, tags);
    const impactHorizon = inferImpactHorizon(candidate, category, tags);
    const sourceTier = inferSourceTier(candidate);
    const confirmationLevel = inferConfirmationLevel(sourceTier, sourceCount);
    const eventStatus = inferEventStatus(groupCandidates, confirmationLevel);
    const timeline = buildTimeline(groupCandidates);
    const earliestSource = timeline[0];
    const latestSource = timeline[timeline.length - 1];
    const officialSource = timeline.find((entry) => entry.sourceTier === 'official');
    const coreEntities = [...new Set(groupCandidates.flatMap((groupCandidate) => extractCoreEntities(groupCandidate, tags)))].slice(0, 8);
    const text = candidateText(candidate, tags);
    const hasRoutineNoise = ROUTINE_NOISE_TERMS.some((term) => includesTerm(text, term));
    const scoreBreakdown: DailyNewsScoreBreakdown = {
        entityWeight: Math.min(16, coreEntities.length * 4),
        sourceWeight: sourceWeight(sourceTier),
        confirmationWeight: confirmationWeight(confirmationLevel),
        categoryWeight: categoryWeight(category, text),
        noveltyWeight: noveltyWeight(sourceCount, hasRoutineNoise),
        impactWeight: impactWeight(text, coreEntities),
    };
    const score = scoreFromBreakdown(scoreBreakdown);
    const editorialSeed = {
        subcategory,
        tags,
        sourceTier,
        confirmationLevel,
        scoreBreakdown,
    };

    const item: DailyNewsItem = {
        id: buildStableId(category, canonicalUrl, candidate.title),
        category,
        title: candidate.title.trim(),
        summary: buildSummary(candidate, category, tags),
        source: candidate.source || normalizeDomain(candidate.domain, candidate.url) || 'Unknown',
        url: candidate.url,
        publishedAt: resolvePublishedAt(candidate) || candidate.collectedAt,
        collectedAt: candidate.collectedAt,
        importanceScore: score,
        importanceLevel: toImportanceLevelFromScore(score),
        tags,
        subcategory,
        affectedAssets,
        impactDirection,
        impactHorizon,
        whyItMatters: buildWhyItMatters(category, subcategory, affectedAssets, impactDirection),
        watchpoints: buildWatchpoints(category, affectedAssets, impactDirection, impactHorizon),
        sourceTier,
        confirmationLevel,
        editorialReason: buildEditorialReason(editorialSeed, category, sourceCount),
        eventStatus,
        earliestSource,
        latestSource,
        officialSource,
        timeline,
        coreEntities,
        scoreBreakdown,
    };
    item.summarySections = buildSummarySections(item);

    return item;
}

function compareItemsByTimeThenScore(a: DailyNewsItem, b: DailyNewsItem): number {
    const aTime = new Date(a.publishedAt).getTime();
    const bTime = new Date(b.publishedAt).getTime();

    if (Number.isFinite(aTime) && Number.isFinite(bTime) && bTime !== aTime) {
        return bTime - aTime;
    }

    if (Number.isFinite(bTime) !== Number.isFinite(aTime)) {
        return Number.isFinite(bTime) ? 1 : -1;
    }

    if (b.importanceScore !== a.importanceScore) {
        return b.importanceScore - a.importanceScore;
    }

    return a.title.localeCompare(b.title);
}

function allDigestItems(digest: DailyNewsDigest): DailyNewsItem[] {
    return NEWS_CATEGORIES.flatMap((category) => digest[category]);
}

function topValues(values: string[], limit: number): string[] {
    const counts = new Map<string, number>();
    values.filter(Boolean).forEach((value) => {
        counts.set(value, (counts.get(value) || 0) + 1);
    });

    return [...counts.entries()]
        .sort((a, b) => {
            if (b[1] !== a[1]) return b[1] - a[1];
            return a[0].localeCompare(b[0]);
        })
        .map(([value]) => value)
        .slice(0, limit);
}

function inferDigestRiskBias(items: DailyNewsItem[]): NewsRiskBias {
    const riskOnCount = items.filter((item) => item.impactDirection === 'risk_on').length;
    const riskOffCount = items.filter((item) => item.impactDirection === 'risk_off').length;
    const mixedCount = items.filter((item) => item.impactDirection === 'mixed').length;

    if (riskOffCount >= riskOnCount && riskOffCount > 0) return 'risk_off';
    if (riskOnCount >= riskOffCount + 1 && riskOnCount > 0) return 'risk_on';
    if (mixedCount > 0 || (riskOnCount > 0 && riskOffCount > 0)) return 'mixed';
    return 'neutral';
}

function buildDigestHeadline(riskBias: NewsRiskBias, driverTags: string[], affectedAssets: string[]): string {
    const driverText = driverTags.length > 0 ? driverTags.slice(0, 3).join('、') : '重要事件';
    const assetText = affectedAssets.length > 0 ? `，涉及 ${affectedAssets.slice(0, 3).join('、')}` : '';
    const toneText: Record<NewsRiskBias, string> = {
        risk_on: '规则或产业进展较多',
        risk_off: '监管、安全或宏观约束更突出',
        mixed: '进展与风险交织',
        neutral: '方向性信息有限',
    };
    return `过去 24 小时大事集中在 ${driverText}${assetText}，整体脉络是${toneText[riskBias]}。`;
}

function buildLatestSignals(items: DailyNewsItem[]): string[] {
    return [...items]
        .sort(compareItemsByTimeThenScore)
        .slice(0, 3)
        .map((item) => {
            const assetText = item.affectedAssets && item.affectedAssets.length > 0
                ? `，涉及 ${item.affectedAssets.slice(0, 2).join('、')}`
                : '';
            return `${item.subcategory || CATEGORY_LABELS[item.category]}：${item.title}${assetText}`;
        });
}

function isEditoriallyImportant(item: DailyNewsItem): boolean {
    const text = `${item.title} ${item.summary} ${item.tags.join(' ')} ${item.subcategory || ''}`.toLowerCase();
    const hasSystemicSignal = SYSTEMIC_IMPORTANCE_TERMS.some((term) => includesTerm(text, term));
    const hasRoutineNoise = ROUTINE_NOISE_TERMS.some((term) => includesTerm(text, term));
    const hasSocialRumorSource = item.earliestSource?.domain
        ? domainMatches(item.earliestSource.domain, SOCIAL_RUMOR_DOMAINS)
        : false;
    const hasLowValueAiSignal = item.category === 'ai' && LOW_VALUE_AI_TERMS.some((term) => includesTerm(text, term));
    const hasLowValueCryptoSignal = item.category === 'crypto' && LOW_VALUE_CRYPTO_TERMS.some((term) => includesTerm(text, term));

    if (hasSocialRumorSource && item.confirmationLevel === 'single_source') {
        return false;
    }

    if ((hasRoutineNoise || hasLowValueAiSignal || hasLowValueCryptoSignal) && !hasSystemicSignal) {
        return false;
    }

    return item.importanceScore >= MIN_EDITORIAL_IMPORTANCE_SCORE || hasSystemicSignal;
}

function buildDailyNewsBrief(digest: DailyNewsDigest): DailyNewsBrief {
    const items = allDigestItems(digest);
    const riskBias = inferDigestRiskBias(items);
    const driverTags = topValues(
        items.flatMap((item) => [item.subcategory || '', ...item.tags])
            .filter((tag) => !GENERIC_DRIVER_TAGS.has(tag)),
        6
    );
    const affectedAssets = topValues(items.flatMap((item) => item.affectedAssets || []), 6);

    return {
        riskBias,
        headline: buildDigestHeadline(riskBias, driverTags, affectedAssets),
        driverTags,
        affectedAssets,
        highImpactCount: items.filter((item) => item.importanceLevel === 'high').length,
        latestSignals: buildLatestSignals(items),
    };
}

function buildTopStories(digest: DailyNewsDigest): DailyNewsTopStory[] {
    return allDigestItems(digest)
        .filter((item) => item.importanceScore >= TOP_STORY_MIN_SCORE)
        .sort((a, b) => {
            if (b.importanceScore !== a.importanceScore) {
                return b.importanceScore - a.importanceScore;
            }
            if (a.category !== b.category) {
                return a.category === 'crypto' ? -1 : b.category === 'crypto' ? 1 : a.category.localeCompare(b.category);
            }
            return new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime();
        })
        .slice(0, 3)
        .map((item) => ({
            id: item.id,
            headline: item.title,
            whyImportant: item.summarySections?.whyImportant || item.whyItMatters || item.summary,
            category: item.category,
            confirmationLevel: item.confirmationLevel,
            sourceTier: item.sourceTier,
            importanceScore: item.importanceScore,
        }));
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
        unimportant: 0,
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
        const coreEntities = new Set(extractCoreEntities(normalizedCandidate));
        const existingGroup = groups.find((group) => isSameEventGroup(
            group,
            canonicalUrl,
            titleTokens,
            coreEntities,
            publishedAtMs
        ));

        if (existingGroup) {
            existingGroup.candidates.push(normalizedCandidate);
            existingGroup.sources.add(normalizedCandidate.source || normalizedCandidate.domain || canonicalUrl);
            coreEntities.forEach((entity) => existingGroup.coreEntities.add(entity));
            existingGroup.firstPublishedAtMs = Math.min(existingGroup.firstPublishedAtMs, publishedAtMs);
            existingGroup.latestPublishedAtMs = Math.max(existingGroup.latestPublishedAtMs, publishedAtMs);
            dropped.duplicates += 1;
        } else {
            groups.push({
                canonicalUrl,
                titleTokens,
                candidates: [normalizedCandidate],
                sources: new Set([normalizedCandidate.source || normalizedCandidate.domain || canonicalUrl]),
                coreEntities,
                firstPublishedAtMs: publishedAtMs,
                latestPublishedAtMs: publishedAtMs,
            });
        }
    }

    const rankedItems = groups.map((group) => {
        const sourceCount = group.sources.size;
        const bestCandidate = [...group.candidates].sort((a, b) => (
            scoreNewsCandidate(b, { category, windowEndMs: window.windowEndMs, sourceCount })
            - scoreNewsCandidate(a, { category, windowEndMs: window.windowEndMs, sourceCount })
        ))[0];

        return toItem(bestCandidate, category, window, sourceCount, group.candidates);
    });

    const items = rankedItems
        .filter((item) => {
            const keep = isEditoriallyImportant(item);
            if (!keep) {
                dropped.unimportant += 1;
            }
            return keep;
        })
        .sort(compareItemsByTimeThenScore)
        .slice(0, limit);

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
            unimportant: 0,
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

    digest.brief = buildDailyNewsBrief(digest);
    digest.topStories = buildTopStories(digest);

    return digest;
}

export function hasAnyDailyNewsItems(digest: DailyNewsDigest): boolean {
    return NEWS_CATEGORIES.some((category) => digest[category].length > 0);
}
