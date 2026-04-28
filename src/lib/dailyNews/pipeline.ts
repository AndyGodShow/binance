import { createHash } from 'node:crypto';

import { getCategoryTerms, scoreNewsCandidate, toImportanceLevel } from './scoring.ts';
import {
    NEWS_CATEGORIES,
    type CategoryCollectionResult,
    type DailyNewsBrief,
    type DailyNewsDigest,
    type DailyNewsItem,
    type DailyNewsWindow,
    type ImpactDirection,
    type ImpactHorizon,
    type NewsCandidate,
    type NewsCategory,
    type NewsRiskBias,
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

function candidateText(candidate: NewsCandidate, tags: string[] = []): string {
    return `${candidate.title} ${candidate.summary || ''} ${candidate.rawSnippet || ''} ${(candidate.tags || []).join(' ')} ${tags.join(' ')}`.toLowerCase();
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

function buildWhyItMatters(category: NewsCategory, subcategory: string, assets: string[], direction: ImpactDirection): string {
    const assetText = assets.length > 0 ? assets.slice(0, 3).join('、') : CATEGORY_LABELS[category];
    const directionText: Record<ImpactDirection, string> = {
        risk_on: '偏风险偏好修复',
        risk_off: '偏风险偏好降温',
        mixed: '多空影响交织',
        neutral: '方向仍需市场确认',
    };

    if (category === 'macro') {
        return `${subcategory}事件可能改变利率预期、美元流动性和风险资产定价，当前解读${directionText[direction]}。`;
    }

    if (category === 'ai') {
        return `${subcategory}事件可能影响 AI 产业竞争、算力需求和科技风险偏好，重点关注 ${assetText} 的后续反馈。`;
    }

    return `${subcategory}事件可能影响 ${assetText} 的流动性、监管预期或交易者风险偏好，当前解读${directionText[direction]}。`;
}

function buildWatchpoints(category: NewsCategory, assets: string[], direction: ImpactDirection, horizon: ImpactHorizon): string[] {
    const primaryAsset = assets.find((asset) => ['BTC', 'ETH', 'SOL', 'BNB'].includes(asset)) || (category === 'crypto' ? 'BTC' : undefined);
    const points: string[] = [];

    if (category === 'macro') {
        points.push('观察美元指数、美债收益率与黄金是否同向确认。');
        points.push('观察 BTC 与美股期指是否出现风险偏好共振。');
    } else if (category === 'ai') {
        points.push('观察 NVIDIA、半导体和云厂商相关资产是否延续反馈。');
        points.push('观察科技股风险偏好是否传导到加密高 beta 资产。');
    } else {
        points.push(`观察 ${primaryAsset} 成交量、持仓量和资金费率是否同步放大。`);
        points.push('观察 BTC/ETH 是否带动山寨币扩散，或仅停留在单点事件。');
    }

    if (direction === 'risk_off') {
        points.push('若价格下跌同时持仓量上升，警惕消息被空头继续利用。');
    } else if (direction === 'risk_on') {
        points.push('若放量突破后回踩不破，说明事件可能正在转化为趋势动能。');
    } else {
        points.push('等待价格、成交量和跨市场资产给出一致方向后再提高权重。');
    }

    if (horizon === 'intraday') {
        points.push('盘中优先看 15m/1h 结构是否快速确认或失效。');
    }

    return points.slice(0, 4);
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
    const subcategory = inferSubcategory(candidate, category, tags);
    const affectedAssets = extractAffectedAssets(candidate, tags);
    const impactDirection = inferImpactDirection(candidate, tags);
    const impactHorizon = inferImpactHorizon(candidate, category, tags);

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
        subcategory,
        affectedAssets,
        impactDirection,
        impactHorizon,
        whyItMatters: buildWhyItMatters(category, subcategory, affectedAssets, impactDirection),
        watchpoints: buildWatchpoints(category, affectedAssets, impactDirection, impactHorizon),
    };
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

    if (riskOffCount >= riskOnCount + 1 && riskOffCount > 0) return 'risk_off';
    if (riskOnCount >= riskOffCount + 1 && riskOnCount > 0) return 'risk_on';
    if (mixedCount > 0 || (riskOnCount > 0 && riskOffCount > 0)) return 'mixed';
    return 'neutral';
}

function riskBiasLabel(riskBias: NewsRiskBias): string {
    if (riskBias === 'risk_on') return '风险偏好修复';
    if (riskBias === 'risk_off') return '风险偏好降温';
    if (riskBias === 'mixed') return '多空影响交织';
    return '方向等待确认';
}

function buildDigestHeadline(riskBias: NewsRiskBias, driverTags: string[], affectedAssets: string[]): string {
    const driverText = driverTags.length > 0 ? driverTags.slice(0, 3).join('、') : '重要事件';
    const assetText = affectedAssets.length > 0 ? `，重点观察 ${affectedAssets.slice(0, 3).join('、')}` : '';
    return `当前重要新闻整体呈现${riskBiasLabel(riskBias)}，主要驱动来自 ${driverText}${assetText}。`;
}

function buildLatestSignals(items: DailyNewsItem[]): string[] {
    return [...items]
        .sort(compareItemsByTimeThenScore)
        .slice(0, 3)
        .map((item) => {
            const direction = item.impactDirection ? riskBiasLabel(item.impactDirection) : '等待确认';
            const assetText = item.affectedAssets && item.affectedAssets.length > 0
                ? `，关联 ${item.affectedAssets.slice(0, 2).join('、')}`
                : '';
            return `${item.subcategory || CATEGORY_LABELS[item.category]}：${direction}${assetText}`;
        });
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
    }).sort(compareItemsByTimeThenScore).slice(0, limit);

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

    digest.brief = buildDailyNewsBrief(digest);

    return digest;
}

export function hasAnyDailyNewsItems(digest: DailyNewsDigest): boolean {
    return NEWS_CATEGORIES.some((category) => digest[category].length > 0);
}
