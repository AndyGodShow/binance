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
        ['安全事件', ['hack', 'exploit', 'breach', 'threat intelligence', 'north korean']],
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
const HARD_MARKETING_NOISE_TERMS = [
    'presale', 'pre-sale', 'price prediction', 'best crypto to buy', 'best crypto presale',
    'buy now', 'token sale', 'moonshot', '100x', 'next 100x', 'hidden gem', 'crypto gem',
    'giveaway', 'airdrop', 'pepeto', 'alphapepe', '预售', '价格预测', '最佳加密',
    '最佳加密预售', '现在购买', '代币销售', '精选',
];
const KOL_OPINION_NOISE_TERMS = [
    'analyst says', 'analyst predicts', 'trader says', 'trader predicts', 'influencer claims',
    'influencer says', 'kol', 'opinion', 'scott melker', '分析师表示', '交易员预测',
    '交易员表示', '影响者声称', '观点', '分析师：', 'hunter horsley',
];
const ADVICE_EXPLAINER_NOISE_TERMS = [
    'should you buy', 'what experts say', 'what to know', 'how to buy',
    'how to invest', 'explained', 'explainer', '专家怎么说', '是否应该买',
    '如何购买', '如何投资',
];
const PRICE_MOVE_TERMS = [
    'crosses', 'breaks', 'hits', 'reaches', 'jumps', 'surges', 'drops', 'falls',
    'rally', 'rallies', 'pullback', 'new high', '突破', '反弹', '回调', '新高',
    '触及', '收复', '上涨', '下跌', '涨超', '跌超', '拉升', '急涨', '急跌',
    '短时上涨', '短时下跌', '短时突破',
];
const PRICE_FRAMING_TERMS = [
    ...PRICE_MOVE_TERMS,
    'holds', 'hold above', 'above $', 'market snapshot', 'drive the next move',
    'price target', 'breakout pattern', 'inflow', 'inflows', 'outflow', 'outflows',
    'pull in', 'pulls in', 'reclaim', 'reclaims', 'surpass', 'surpasses',
    'top $', 'tops $', 'tops', 'rises', 'demand rises', 'demand for',
    'leads market', 'price',
    '流入', '流量', '吸金', '持有', '重回', '收复', '收回', '市场概况',
    '下一步行动', '突破格局', '价格', '美元',
];
const LOW_INFORMATION_RECAP_TERMS = [
    'market snapshot', 'daily market recap', 'top articles', 'top stories',
    'database articles', 'does not care', "doesn't care", 'price can go',
    'how high', 'dominates top', 'used to hate inflation', 'might be the opposite',
    'twitter case', '市场概况', '价格能', '不在乎', '可能恰恰相反',
    'allocation to 5%', 'adjusts bitcoin allocation', '曾经讨厌通货膨胀',
    '配置调整为 5%', '前 5 名', '前5名', '24h 热门币种与要闻',
    '24H 热门币种与要闻', 'cex 热门币种', 'CEX 热门币种',
    '成交额 Top 10', '24 小时涨跌幅', '24 小时涨幅榜单',
];
const CRYPTO_ADJACENT_BUSINESS_NOISE_TERMS = [
    'sec twitter', 'twitter case', 'ebay takeover', 'bitcoin stash in the crosshairs',
    'gamestop ceo', 'gamestop', 'ebay', 'socks',
    'eBay 收购', 'Twitter 案件', '卖袜子', '行为艺术',
    '美股赚钱', '美股存储股', '股票账户', '炒美股',
];
const AI_PRODUCT_RUMOR_NOISE_TERMS = [
    'ai phone', 'phone in 2027', 'may launch ai phone', 'consumer device rumor',
    'ai-agent phone', 'ai smartphone', 'smartphone specs', 'phone by 2027',
    'ahead of 2027 launch', 'consumer hardware', 'leaked', 'AI 手机',
    '智能手机', '代理电话', '消费类硬件', '2027 年可能',
];
const AI_PERSONNEL_OR_ROUTINE_PARTNERSHIP_TERMS = [
    'joins anthropic', 'former pentagon think tank head', 'hope us government and anthropic',
    'partners to bring agentic ai to banking', '前负责人加入 Anthropic',
    '合作推出银行业代理人工智能', 'team to bring agentic ai to finance',
    'jensen huang on anthropic', 'fis', 'stock falls', 'stock down',
    'shares down', 'chip stocks are tumbling', 'blame openai', '股价下跌',
    '芯片股正在暴跌', '归咎于 OpenAI',
];
const EDITORIAL_ANALYSIS_NOISE_TERMS = [
    'opinion', 'columnist', 'explainer', 'what to know', 'what to expect',
    'should you buy', 'survey shows', 'poll shows', 'top stories', 'top articles',
    'market recap', 'daily recap', 'roundup', 'preview', 'incoming',
    'drama', 'price prediction', 'analyst predicts', 'trader predicts',
    'ceo says', 'ceo：', 'research:', 'research：', 'research article',
    'tiger research', 'report:', 'report：', '研究院：', '调查显示',
    '民调显示', '盘点', '一文读懂', '深度解读',
    '带来了多大变量', '已死', '值得关注', '即将到来',
];
const NEGATED_EVENT_EVIDENCE_TERMS = [
    'no new official', 'without a new', 'without new', 'no released data',
    'no filing', 'no product launch', 'no regulatory event', '缺少新官方',
    '没有新规', '没有发布', '没有备案',
];
const MACRO_LOW_INFORMATION_TERMS = [
    'await', 'awaits', 'ahead of', 'preview', 'incoming', 'drama',
    'investigation', 'changes course', 'unlikely to satisfy', 'new worry',
    'seen holding coupon sizes', 'leaning on bills', 'market opens',
    'traders await', 'investors assess',
];
const MACRO_EVENT_TERMS = [
    'holds rates', 'raises rates', 'hikes rates', 'cuts rates', 'rate decision',
    'rate cut', 'rate cuts', 'minutes', 'statement', 'dot plot', 'press conference',
    'powell says', 'fed says', 'ecb says', 'boj says', 'pboc says',
    'cpi', 'ppi', 'payrolls', 'nonfarm', 'jobs report', 'pmi', 'gdp',
    'treasury yields', 'yield', 'yields', 'dollar', 'dxy', 'tariff', 'tariffs',
    'sanction', 'sanctions', 'war', 'oil', 'gold', 'auction', 'coupon',
    'refunds', 'debt ceiling', 'default',
];
const AI_EVENT_TERMS = [
    'launch', 'launches', 'release', 'releases', 'rollout', 'begins',
    'open-source', 'model', 'reasoning', 'agent', 'chip', 'gpu', 'semiconductor',
    'data center', 'datacenter', 'compute', 'regulation', 'lawsuit', 'settlement',
    'funding', 'raise', 'acquisition', 'merger', 'partnership', 'contract',
    'deploy', 'deploys', 'deployment', 'legal action', 'chip controls', 'restrictions',
    'urges', 'considers',
    '发布', '推出', '模型', '芯片', '算力', '融资', '收购', '监管', '诉讼',
];
const CRYPTO_EVENT_TERMS = [
    'sec', 'cftc', 'lawsuit', 'charges', 'settlement', 'approve', 'approved',
    'approval', 'reject', 'rejected', 'delay', 'delayed', 'filing', 'court',
    'etf', 'stablecoin', 'depeg', 'reserve', 'reserves', 'proof-of-reserves',
    'hack', 'exploit', 'breach', 'outage', 'withdrawal pause', 'custody',
    'liquidation', 'bankruptcy', 'default', 'acquisition', 'merger', 'launch',
    'rollout', 'upgrade', '安全', '黑客', '攻击', '漏洞', '宕机', '提现',
    '钱包', '储备', '监管', '稳定币', '脱锚', '清算', '收购', '升级',
];
const CONCRETE_NEWS_ACTION_TERMS = [
    'announce', 'announces', 'announced', 'approve', 'approved', 'reject',
    'rejected', 'delay', 'delayed', 'filed', 'filing', 'sues', 'lawsuit',
    'charges', 'settlement', 'launch', 'launches', 'released', 'release',
    'rollout', 'begins', 'raises', 'funding', 'acquires', 'acquisition',
    'merger', 'hack', 'exploit', 'breach', 'outage', 'pause', 'paused',
    'holds rates', 'cuts rates', 'hikes rates', 'raises rates', 'reports',
    'reported', 'data showed', '公布', '宣布', '批准', '拒绝', '推迟',
    '提交', '起诉', '指控', '和解', '发布', '推出', '融资', '收购',
    '攻击', '漏洞', '宕机', '暂停', '公布数据',
];
const LISTING_PRICE_REACTION_TERMS = [
    'will list', 'to list', 'lists', 'listing', 'new listing', '上线',
    '将上线', '新增交易对', '永续合约',
];
const PRICE_REACTION_PROTECTED_TERMS = [
    'sec', 'cftc', 'etf', 'stablecoin', 'usdc', 'tether', 'circle', 'depeg',
    'reserve', 'reserves', 'hack', 'exploit', 'breach', 'outage', 'withdrawal',
    'lawsuit', 'charges', 'settlement', 'regulator', 'regulation', '监管',
    '诉讼', '指控', '和解', '脱锚', '储备', '黑客', '攻击', '漏洞',
    '宕机', '故障', '暂停提现',
];
const MAJOR_EVENT_ANCHOR_TERMS = [
    'sec', 'cftc', 'etf', 'stablecoin', 'depeg', 'hack', 'exploit', 'binance',
    'coinbase', 'kraken', 'okx', 'outage', 'upgrade', 'lawsuit', 'charges',
    'settlement', 'fed', 'federal reserve', 'cpi', 'nvidia', 'openai', 'anthropic',
];
const CONCRETE_EVENT_ACTION_TERMS = [
    'sec', 'cftc', 'lawsuit', 'charges', 'settlement', 'reject', 'rejected',
    'approve', 'approved', 'delay', 'delayed', 'filing', 'court', 'stablecoin',
    'depeg', 'reserve', 'reserves', 'hack', 'exploit', 'breach', 'outage',
    'upgrade', 'withdrawal pause', 'threat intelligence', 'fed', 'federal reserve',
    'cpi', 'ppi', 'nvidia', 'openai', 'anthropic', 'launches', 'releases',
    'SEC', 'CFTC', '诉讼', '指控', '和解', '拒绝', '批准', '推迟', '备案',
    '法院', '稳定币', '脱锚', '储备', '黑客', '攻击', '漏洞', '故障', '升级',
    '暂停提现', '威胁情报', '美联储', '通胀', '发布', '推出',
];
const SYSTEMIC_IMPORTANCE_TERMS = [
    'sec', 'cftc', 'federal reserve', 'fed', 'ecb', 'boj', 'pboc', 'cpi', 'ppi',
    'nonfarm', 'payrolls', 'etf', 'stablecoin', 'hack', 'exploit', 'breach',
    'lawsuit', 'charges', 'settlement', 'ban', 'approve', 'approval', 'reserve',
    'reserves', 'bankruptcy', 'default', 'acquisition', 'merger', 'tariff', 'sanction',
    'binance', 'coinbase', 'tether', 'circle', 'openai', 'anthropic', 'nvidia',
    'kraken', 'okx', 'solana', 'outage', 'depeg', 'custody', 'withdrawal', 'wallet security',
    'threat intelligence', 'north korean',
];
const SOCIAL_RUMOR_DOMAINS = ['x.com', 'twitter.com', 't.me', 'telegram.org', 'reddit.com'];
const LOW_VALUE_AI_TERMS = ['small funding', 'seed round', 'chatbot app', 'startup announces'];
const LOW_VALUE_CRYPTO_TERMS = ['small defi', 'low market cap', 'tiny token', 'altcoin project'];
const OFFICIAL_SOURCE_DOMAINS = [
    'federalreserve.gov', 'ecb.europa.eu', 'boj.or.jp', 'pbc.gov.cn', 'sec.gov',
    'treasury.gov', 'whitehouse.gov', 'openai.com', 'anthropic.com', 'nvidia.com',
    'blogs.nvidia.com', 'microsoft.com', 'blogs.microsoft.com', 'blog.google',
    'huggingface.co', 'binance.com', 'coinbase.com', 'circle.com', 'tether.to',
];
const MAJOR_SOURCE_DOMAINS = [
    'reuters.com', 'bloomberg.com', 'apnews.com', 'ft.com', 'wsj.com', 'cnbc.com',
    'marketwatch.com', 'theverge.com', 'techcrunch.com',
];
const SPECIALIST_SOURCE_DOMAINS = [
    'coindesk.com', 'theblock.co', 'decrypt.co', 'cointelegraph.com', 'bitcoinmagazine.com',
    'venturebeat.com', 'theblockbeats.news', 'theblockbeats.info', 'odaily.news', 'ai.6551.io',
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
    security: ['hack', 'exploit', 'breach', 'security incident', 'wallet incident', 'threat intelligence', 'north korean'],
    macro: ['fed', 'federal reserve', 'cpi', 'inflation', 'rates', 'dollar', 'treasury', 'central bank'],
    aiInfrastructure: ['nvidia', 'gpu', 'chip', 'semiconductor', 'data center', 'compute', 'frontier model'],
};
const BANNED_CHINESE_STYLE_TERMS = ['暴涨', '起飞', '必买', '利好', '利空', '看涨', '看跌'];

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
    return sharedEntities >= 2
        && titleSimilarity(group.titleTokens, titleTokens) >= 0.38
        && groupTimeDistanceMs(group, publishedAtMs) <= EVENT_GROUP_WINDOW_MS;
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
        ['安全事件', ['hack', 'exploit', 'breach', 'threat intelligence', 'north korean']],
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

function hasAnyTerm(text: string, terms: string[]): boolean {
    return terms.some((term) => includesTerm(text, term));
}

function hasCjkText(value: string): boolean {
    return /[\u3400-\u9FFF]/.test(value);
}

function newsText(value: NewsCandidate | DailyNewsItem): string {
    const tags = 'tags' in value && Array.isArray(value.tags) ? value.tags : [];
    const extra = 'summarySections' in value && value.summarySections
        ? [
            value.summarySections.whatHappened,
            value.summarySections.whyImportant,
            value.summarySections.whatToWatch,
            value.summarySections.sourceAndConfirmation,
            value.subcategory || '',
        ]
        : ['rawSnippet' in value ? value.rawSnippet || '' : ''];

    return `${value.title} ${value.summary || ''} ${tags.join(' ')} ${extra.join(' ')}`.toLowerCase();
}

function dailyItemEvidenceText(item: DailyNewsItem): string {
    return [
        item.title,
        item.summary,
        item.tags.join(' '),
        item.subcategory || '',
        item.editorialReason || '',
        item.summarySections?.whatHappened || '',
        item.summarySections?.whyImportant || '',
        item.timeline?.map((entry) => entry.title).join(' ') || '',
    ].join(' ').toLowerCase();
}

export function isHardMarketingNoise(value: NewsCandidate | DailyNewsItem): boolean {
    return hasAnyTerm(newsText(value), HARD_MARKETING_NOISE_TERMS);
}

export function isKolOpinionNoise(value: NewsCandidate | DailyNewsItem): boolean {
    return hasAnyTerm(newsText(value), KOL_OPINION_NOISE_TERMS);
}

function isAdviceExplainerNoise(value: NewsCandidate | DailyNewsItem): boolean {
    return hasAnyTerm(newsText(value), ADVICE_EXPLAINER_NOISE_TERMS);
}

function hasMajorEventAnchor(value: NewsCandidate | DailyNewsItem): boolean {
    return hasAnyTerm(newsText(value), MAJOR_EVENT_ANCHOR_TERMS);
}

export function isPurePriceMove(value: NewsCandidate | DailyNewsItem): boolean {
    if ('category' in value && value.category !== 'crypto') {
        return false;
    }

    const text = newsText(value);
    return hasAnyTerm(text, PRICE_MOVE_TERMS) && !hasMajorEventAnchor(value);
}

function isPriceFramedWithoutConcreteEvent(value: NewsCandidate | DailyNewsItem): boolean {
    const text = `${value.title} ${value.summary || ''}`.toLowerCase();
    const sourceTier = 'sourceTier' in value ? value.sourceTier : inferSourceTier(value);
    const hasPriceFrame = hasAnyTerm(text, PRICE_FRAMING_TERMS);
    const hasConcreteAction = hasAnyTerm(text, CONCRETE_EVENT_ACTION_TERMS);

    return hasPriceFrame && !hasConcreteAction && sourceTier !== 'official';
}

function isWeakMarketRecap(value: NewsCandidate | DailyNewsItem): boolean {
    if ('category' in value && value.category !== 'crypto') {
        return false;
    }

    const text = `${value.title} ${value.summary || ''}`.toLowerCase();
    const sourceTier = 'sourceTier' in value ? value.sourceTier : inferSourceTier(value);
    const hasPriceFrame = hasAnyTerm(text, PRICE_FRAMING_TERMS);
    const hasLowInformationFrame = hasAnyTerm(text, LOW_INFORMATION_RECAP_TERMS);
    const hasRegulatoryFiling = hasAnyTerm(text, [
        'sec', 'cftc', 'lawsuit', 'charges', 'settlement', 'reject', 'rejected',
        'approve', 'approved', 'delay', 'delayed', 'filing', 'court', '诉讼',
        '指控', '和解', '拒绝', '批准', '推迟', '备案', '法院',
    ]);
    const hasSecurityOrInfrastructureFact = hasAnyTerm(text, [
        'depeg', 'reserve', 'reserves', 'hack', 'exploit', 'breach', 'outage',
        'upgrade', 'withdrawal pause', 'threat intelligence', '脱锚', '储备',
        '黑客', '攻击', '漏洞', '故障', '升级', '暂停提现', '威胁情报',
    ]);

    return (hasPriceFrame || hasLowInformationFrame)
        && !hasRegulatoryFiling
        && !hasSecurityOrInfrastructureFact
        && sourceTier !== 'official';
}

function isMacroCryptoCarryTradeNoise(value: NewsCandidate | DailyNewsItem): boolean {
    if ('category' in value && value.category !== 'macro') {
        return false;
    }

    const text = newsText(value);
    const sourceTier = 'sourceTier' in value ? value.sourceTier : inferSourceTier(value);
    return sourceTier !== 'major'
        && (text.includes('bitcoin') || text.includes(' btc') || text.includes('etf') || text.includes('比特币') || text.includes('加密'))
        && (text.includes('treasury yield') || text.includes('treasury yields') || text.includes('yields') || text.includes('美债收益率'))
        && !(text.includes('cpi') || text.includes('inflation data') || includesTerm(text, 'fed') || text.includes('federal reserve') || text.includes('rate decision') || includesTerm(text, 'dollar') || text.includes('oil') || text.includes('通胀') || text.includes('美元') || text.includes('油价'));
}

function isSingleStockMacroNoise(value: NewsCandidate | DailyNewsItem): boolean {
    if ('category' in value && value.category !== 'macro') {
        return false;
    }

    const text = newsText(value);
    return (text.includes('nvidia') || text.includes('英伟达') || text.includes('stock') || text.includes('stocks') || text.includes('shares') || text.includes('bulls') || text.includes('market cap') || text.includes('trillion-dollar'))
        && !(text.includes('treasury') || text.includes('yield') || text.includes('dxy') || text.includes('cpi') || text.includes('inflation') || includesTerm(text, 'fed') || text.includes('rate decision') || text.includes('oil') || text.includes('tariff') || text.includes('美债') || text.includes('美元') || text.includes('通胀') || text.includes('油价'));
}

function isCryptoRoundupNoise(value: NewsCandidate | DailyNewsItem): boolean {
    if ('category' in value && value.category !== 'crypto') {
        return false;
    }

    const text = `${value.title} ${value.summary || ''}`.toLowerCase();
    return hasAnyTerm(text, ['星球午讯', '星球晚讯', '午讯', '晚讯', 'top stories', 'daily recap', 'roundup'])
        && hasAnyTerm(text, ['1.', '2.', '3.', '总净流出', '要闻']);
}

function isListingPriceReaction(value: NewsCandidate | DailyNewsItem): boolean {
    if ('category' in value && value.category !== 'crypto') {
        return false;
    }

    const text = newsText(value);
    return hasAnyTerm(text, LISTING_PRICE_REACTION_TERMS)
        && hasAnyTerm(text, PRICE_MOVE_TERMS)
        && !hasAnyTerm(text, PRICE_REACTION_PROTECTED_TERMS);
}

function isCryptoAdjacentBusinessNoise(value: NewsCandidate | DailyNewsItem): boolean {
    if ('category' in value && value.category !== 'crypto') {
        return false;
    }

    return hasAnyTerm(`${value.title} ${value.summary || ''}`.toLowerCase(), CRYPTO_ADJACENT_BUSINESS_NOISE_TERMS);
}

function isAiProductRumorNoise(value: NewsCandidate | DailyNewsItem): boolean {
    if ('category' in value && value.category !== 'ai') {
        return false;
    }

    const sourceTier = 'sourceTier' in value ? value.sourceTier : inferSourceTier(value);
    return sourceTier !== 'official'
        && hasAnyTerm(`${value.title} ${value.summary || ''}`.toLowerCase(), AI_PRODUCT_RUMOR_NOISE_TERMS);
}

function isLowValueAiIndustryNoise(value: NewsCandidate | DailyNewsItem): boolean {
    if ('category' in value && value.category !== 'ai') {
        return false;
    }

    const sourceTier = 'sourceTier' in value ? value.sourceTier : inferSourceTier(value);
    return sourceTier !== 'official'
        && hasAnyTerm(`${value.title} ${value.summary || ''}`.toLowerCase(), AI_PERSONNEL_OR_ROUTINE_PARTNERSHIP_TERMS);
}

function isAnalysisOrOpinionWithoutEvent(item: DailyNewsItem): boolean {
    const text = dailyItemEvidenceText(item);
    if (!hasAnyTerm(text, EDITORIAL_ANALYSIS_NOISE_TERMS)) {
        return false;
    }

    if (hasAnyTerm(text, NEGATED_EVENT_EVIDENCE_TERMS)) {
        return true;
    }

    return !hasAnyTerm(text, CONCRETE_NEWS_ACTION_TERMS)
        || (item.confirmationLevel === 'single_source' && item.sourceTier !== 'official' && item.importanceScore < 72);
}

function hasCategoryEventEvidence(item: DailyNewsItem): boolean {
    const text = dailyItemEvidenceText(item);
    const authoritative = item.sourceTier === 'official'
        || item.confirmationLevel === 'multi_source'
        || item.confirmationLevel === 'single_authoritative';

    if (item.category === 'macro') {
        const hasMacroEvent = hasAnyTerm(text, MACRO_EVENT_TERMS);
        const lowInformation = hasAnyTerm(text, MACRO_LOW_INFORMATION_TERMS)
            && !hasAnyTerm(text, ['released', 'reported', 'official', 'decision', 'holds rates', 'cuts rates', 'hikes rates']);

        if (lowInformation && item.importanceScore < 74) {
            return false;
        }

        return hasMacroEvent && (authoritative || item.importanceScore >= 72);
    }

    if (item.category === 'ai') {
        return hasAnyTerm(text, AI_EVENT_TERMS) && (authoritative || item.importanceScore >= 70);
    }

    return hasAnyTerm(text, CRYPTO_EVENT_TERMS) && (authoritative || item.importanceScore >= 70);
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
    const topic = eventNoun(subcategory);
    const contextText: Record<ImpactDirection, string> = {
        risk_on: '说明规则、资金或产品落地有新增事实',
        risk_off: '暴露出监管、安全或流动性约束',
        mixed: '同时带来机会与约束，后续需要看细节如何落地',
        neutral: '重点在于确认事实本身和后续执行细节',
    };

    if (category === 'macro') {
        const macroImpactText: Record<string, string> = {
            央行: '会直接改写降息/加息路径、美元流动性和风险资产折现率。',
            通胀: '会影响实际利率、名义收益率和市场对政策转向时点的定价。',
            就业: '会改变增长韧性与工资通胀判断，进而影响美联储反应函数。',
            地缘: '会通过能源、航运、避险美元和通胀预期传导到风险资产。',
            商品: '会影响输入型通胀、资源股预期和美元计价资产的风险偏好。',
        };
        return `${topic}${macroImpactText[subcategory] || '会影响利率、通胀和全球流动性预期。'}当前判断是${contextText[direction]}。`;
    }

    if (category === 'ai') {
        return `${topic}关系到 AI 产业竞争、算力需求或监管边界，重点放在 ${assetText} 的产业位置变化。`;
    }

    return `${topic}涉及 ${assetText}，需要关注它对监管规则、基础设施安全或产品落地的具体影响，${contextText[direction]}。`;
}

function buildWatchpoints(category: NewsCategory, assets: string[], direction: ImpactDirection, horizon: ImpactHorizon): string[] {
    const points: string[] = [];

    if (category === 'macro') {
        points.push('后续看原始数据、官员讲话和利率期货是否同步修正。');
        points.push('确认美元、美债收益率、黄金和美股期货是否出现同向验证。');
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
    if (domain.includes('news.google') || (candidate.source || '').toLowerCase().includes('google news')) return 'aggregated';
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

function decodeHtmlEntities(value: string): string {
    return value
        .replace(/&apos;|&#39;/g, "'")
        .replace(/&quot;/g, '"')
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => {
            const codePoint = Number.parseInt(hex, 16);
            return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : '';
        })
        .replace(/&#(\d+);/g, (_, decimal: string) => {
            const codePoint = Number.parseInt(decimal, 10);
            return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : '';
        });
}

function cleanChineseStyle(value: string): string {
    const decoded = decodeHtmlEntities(value)
        .replace(/\s*[-|]\s*[A-Z][A-Za-z0-9 .&/]{2,}$/g, '')
        .replace(/([A-Za-z0-9])([\u3400-\u9FFF])/g, '$1 $2')
        .replace(/([\u3400-\u9FFF])([A-Za-z0-9])/g, '$1 $2')
        .replace(/\b(\d+)\s+年/g, '$1年')
        .replace(/\b(\d{4})年\s+(\d{1,2})\s+月/g, '$1年$2月')
        .replace(/\bETF\s*ETF\b/g, 'ETF')
        .replace(/ETFETF/g, 'ETF')
        .replace(/事件事件/g, '事件')
        .replace(/\s+/g, ' ')
        .trim();

    return BANNED_CHINESE_STYLE_TERMS.reduce(
        (text, banned) => text.replaceAll(banned, '中性影响'),
        decoded
    );
}

function cleanEventSource<T extends DailyNewsEventSource | undefined>(source: T): T {
    if (!source) {
        return source;
    }

    const withOptionalTitle = source as T & { title?: string };
    return {
        ...source,
        source: cleanChineseStyle(source.source),
        ...(withOptionalTitle.title ? { title: cleanChineseStyle(withOptionalTitle.title) } : {}),
    } as T;
}

function getEventSourceTitle(source: DailyNewsEventSource | undefined): string | undefined {
    return (source as (DailyNewsEventSource & { title?: string }) | undefined)?.title;
}

function compactNewsSummary(summary: string, title: string): string {
    const cleaned = cleanChineseStyle(summary)
        .replace(/(原创\s*[|｜]\s*)?Odaily\s*星球日报[^。！？]{0,80}[。！？]?\s*/gi, '')
        .replace(/原文作者：[^。！？]{0,100}[。！？]?\s*/g, '')
        .replace(/作者\s*[|｜：:][^。！？]{0,100}[。！？]?\s*/g, '')
        .replace(/本报告由[^。！？]{0,100}[。！？]?\s*/g, '')
        .replace(/核心摘要\s*/gi, '')
        .trim();

    if (cleaned.length <= 260) {
        return cleaned || `${title}。`;
    }

    const sentences = cleaned.split(/(?<=[。！？])/).map((part) => part.trim()).filter(Boolean);
    let compact = '';
    for (const sentence of sentences) {
        const nextSentence = sentence.length > 220 ? sentence.slice(0, 220) : sentence;
        if (compact && compact.length + sentence.length > 220) {
            break;
        }
        compact += nextSentence;
        if (compact.length >= 120) {
            break;
        }
    }

    if (!compact) {
        compact = cleaned.slice(0, 220);
    }

    return `${compact.replace(/[，,；;：:、\s]+$/, '')}${compact.endsWith('。') || compact.endsWith('！') || compact.endsWith('？') ? '' : '。'}`;
}

function entityDisplayName(entity: string): string {
    const names: Record<string, string> = {
        ETH: '以太坊',
        BTC: '比特币',
        SOL: 'Solana',
        FED: '美联储',
        SEC: 'SEC',
        CFTC: 'CFTC',
        ETF: 'ETF',
        USDT: 'USDT',
        USDC: 'USDC',
        BINANCE: 'Binance',
        COINBASE: 'Coinbase',
        KRAKEN: 'Kraken',
        OKX: 'OKX',
        OPENAI: 'OpenAI',
        ANTHROPIC: 'Anthropic',
        NVIDIA: 'Nvidia',
        GOOGLE: 'Google',
    };
    return names[entity] || entity;
}

function eventNoun(subcategory: string): string {
    const names: Record<string, string> = {
        ETF: 'ETF进展',
        交易所: '交易所动态',
        稳定币: '稳定币进展',
        监管: '监管事项',
        安全事件: '安全事项',
        链上与清算: '链上与清算动态',
        央行: '央行动态',
        通胀: '通胀数据',
        模型: '模型动态',
        芯片: '芯片动态',
    };
    if (names[subcategory]) {
        return names[subcategory];
    }
    if (subcategory.endsWith('事件')) {
        return subcategory;
    }
    return `${subcategory}事件`;
}

function extractHeadlineActor(title: string, item: DailyNewsItem): string {
    const lowerTitle = title.toLowerCase();
    const actorRules: Array<[string, string]> = [
        ['federal reserve', '美联储'],
        ['coinbase', 'Coinbase'],
        ['binance', 'Binance'],
        ['kraken', 'Kraken'],
        ['google', 'Google'],
        ['anthropic', 'Anthropic'],
        ['openai', 'OpenAI'],
        ['nvidia', 'Nvidia'],
        ['sec', 'SEC'],
        ['cftc', 'CFTC'],
    ];
    const actor = actorRules.find(([term]) => includesTerm(lowerTitle, term));
    if (actor) {
        return actor[1];
    }

    const leadingEntity = title.match(/^([A-Z][A-Za-z0-9&.-]*(?:\s+[A-Z][A-Za-z0-9&.-]*){0,3})\b/)?.[1];
    if (leadingEntity) {
        return leadingEntity;
    }

    const entities = (item.coreEntities || item.affectedAssets || [])
        .map(entityDisplayName)
        .filter((entity) => entity && entity !== item.subcategory);
    return entities.length > 0
        ? [...new Set(entities)].slice(0, 2).join('、')
        : item.subcategory || CATEGORY_LABELS[item.category];
}

function extractHeadlineTopic(title: string, item: DailyNewsItem): string {
    const lowerTitle = title.toLowerCase();
    const assetName = includesTerm(lowerTitle, 'bitcoin') || includesTerm(lowerTitle, 'btc')
        ? '比特币'
        : includesTerm(lowerTitle, 'ethereum') || includesTerm(lowerTitle, 'ether') || includesTerm(lowerTitle, 'eth')
            ? '以太坊'
            : includesTerm(lowerTitle, 'solana') || includesTerm(lowerTitle, 'sol')
                ? 'Solana'
                : '';
    const stablecoinTicker = title.match(/\b([A-Z0-9]{3,10})\s+stablecoin\b/)?.[1];

    if (includesTerm(lowerTitle, 'spot') && includesTerm(lowerTitle, 'etf')) {
        const suffix = includesTerm(lowerTitle, 'staking')
            ? '质押提案'
            : includesTerm(lowerTitle, 'rule change')
                ? '规则变更'
                : '相关事项';
        return `${assetName || ''}现货 ETF ${suffix}`.trim();
    }
    if (includesTerm(lowerTitle, 'bitcoin') && includesTerm(lowerTitle, 'etf')) {
        return includesTerm(lowerTitle, 'filing')
            ? '比特币 ETF 备案更新'
            : '比特币 ETF';
    }
    if (includesTerm(lowerTitle, 'ethereum') && includesTerm(lowerTitle, 'etf')) {
        return includesTerm(lowerTitle, 'filing')
            ? '以太坊 ETF 备案更新'
            : '以太坊 ETF';
    }
    if (includesTerm(lowerTitle, 'treasury yield') || includesTerm(lowerTitle, 'treasury yields') || includesTerm(lowerTitle, 'yields')) {
        if (includesTerm(lowerTitle, 'may 2025 highs')) {
            return '美债收益率升至 2025年5月以来高位';
        }
        if (includesTerm(lowerTitle, '30-year') || includesTerm(lowerTitle, '30 year')) {
            return includesTerm(lowerTitle, 'tops') || includesTerm(lowerTitle, 'top') || includesTerm(lowerTitle, 'hit') || includesTerm(lowerTitle, 'hits')
                ? '30年期美债收益率升破 5.1%'
                : '30年期美债收益率上行';
        }
        if (includesTerm(lowerTitle, 'uk') && (includesTerm(lowerTitle, '10-year') || includesTerm(lowerTitle, '10 year'))) {
            return includesTerm(lowerTitle, '2008')
                ? '英国10年期国债收益率创 2008年以来高位'
                : '英国10年期国债收益率上行';
        }
        if (includesTerm(lowerTitle, '10-year') || includesTerm(lowerTitle, '10 year')) {
            return includesTerm(lowerTitle, 'highest')
                ? '10年期美债收益率升至阶段高位'
                : '10年期美债收益率上行';
        }
        if (includesTerm(lowerTitle, 'middle east')) {
            return '中东僵局推高全球债券收益率，美元走强';
        }
        if ((includesTerm(lowerTitle, 'global markets') || includesTerm(lowerTitle, 'u.s. futures'))
            && includesTerm(lowerTitle, 'oil rise')) {
            return '美股期货和全球市场下跌，美债收益率与油价上行';
        }
        if (includesTerm(lowerTitle, 'tricky rates path') || includesTerm(lowerTitle, 'fed chair')) {
            return '通胀数据令美联储利率路径更棘手，美债收益率跳升';
        }
        if (includesTerm(lowerTitle, 'japan')) {
            return '日本国债收益率升至多年高位';
        }
        if (includesTerm(lowerTitle, 'dollar') && (includesTerm(lowerTitle, 'weekly gain') || includesTerm(lowerTitle, 'largest weekly gain'))) {
            return '美元受美债收益率上行支撑创两个月最大周涨幅';
        }
        if ((includesTerm(lowerTitle, 'nasdaq') || includesTerm(lowerTitle, 's&p 500') || includesTerm(lowerTitle, 'futures'))
            && (includesTerm(lowerTitle, 'tumble') || includesTerm(lowerTitle, 'slide'))) {
            return '美债收益率跳升压低纳指与标普期货';
        }
        if (includesTerm(lowerTitle, 'bitcoin') && (includesTerm(lowerTitle, '12-month high') || includesTerm(lowerTitle, '200-day average'))) {
            return '美债收益率创阶段高位，比特币承压';
        }
        return includesTerm(lowerTitle, '5%')
            ? '美债收益率接近 5%'
            : '美债收益率变化';
    }
    if (includesTerm(lowerTitle, 'fed') || includesTerm(lowerTitle, 'federal reserve')) {
        return includesTerm(lowerTitle, 'powell')
            ? '美联储主席任期争议'
            : '美联储政策信号';
    }
    if (stablecoinTicker) {
        const chainPrefix = assetName ? `在 ${assetName} 上` : '';
        return `${chainPrefix}推出 ${stablecoinTicker} 稳定币`.trim();
    }
    if (includesTerm(lowerTitle, 'threat intelligence')) {
        return includesTerm(lowerTitle, 'north korean') || includesTerm(lowerTitle, 'north korea')
            ? '朝鲜威胁情报'
            : '威胁情报';
    }
    if (includesTerm(lowerTitle, 'wallet') && (includesTerm(lowerTitle, 'security incident') || includesTerm(lowerTitle, 'withdrawal pause'))) {
        return '钱包安全事件';
    }
    if (includesTerm(lowerTitle, 'custody reporting')) {
        return `${assetName || '加密'}基金机构托管报告`;
    }
    if (includesTerm(lowerTitle, 'reserve')) {
        return '加密托管储备更新';
    }
    if (includesTerm(lowerTitle, 'tpu')) {
        return 'TPU 服务';
    }
    if (includesTerm(lowerTitle, 'ai services company')) {
        return 'AI 服务公司';
    }
    if (includesTerm(lowerTitle, 'rate cuts')) {
        return includesTerm(lowerTitle, 'inflation')
            ? '通胀数据后的降息预期'
            : '降息预期';
    }
    if (includesTerm(lowerTitle, 'cpi')) {
        return includesTerm(lowerTitle, 'hotter') || includesTerm(lowerTitle, 'jumps') || includesTerm(lowerTitle, 'rise')
            ? 'CPI 通胀升温'
            : 'CPI 通胀数据';
    }
    if (includesTerm(lowerTitle, 'payrolls') || includesTerm(lowerTitle, 'nonfarm') || includesTerm(lowerTitle, 'jobs')) {
        return '美国就业数据';
    }
    if (includesTerm(lowerTitle, 'tariff') || includesTerm(lowerTitle, 'tariffs')) {
        return '关税冲击';
    }
    if (includesTerm(lowerTitle, 'oil')) {
        return includesTerm(lowerTitle, 'war')
            ? '战争风险推升油价'
            : '油价变化';
    }
    if (includesTerm(lowerTitle, 'staff')) {
        return '运营人员调整';
    }

    return item.subcategory || CATEGORY_LABELS[item.category];
}

function buildActionHeadline(actor: string, topic: string, text: string): string | null {
    if ((includesTerm(text, 'shares slide') || includesTerm(text, 'shares slid') || includesTerm(text, 'stock falls') || includesTerm(text, 'stock down'))
        && (includesTerm(text, 'loss') || includesTerm(text, 'revenue miss') || includesTerm(text, 'missed revenue'))) {
        return `${actor} 股价因财报亏损和营收不及预期承压`;
    }
    if (includesTerm(text, 'disclose') || includesTerm(text, 'discloses') || includesTerm(text, 'disclosed')) {
        return `${actor}披露${topic}`;
    }
    if (includesTerm(text, 'reject') || includesTerm(text, 'rejected') || includesTerm(text, 'rejects')) {
        return `${actor} 拒绝${topic}`;
    }
    if (includesTerm(text, 'delay') || includesTerm(text, 'delays') || includesTerm(text, 'delayed')) {
        return `${actor} 推迟${topic}决定`;
    }
    if (includesTerm(text, 'approve') || includesTerm(text, 'approval') || includesTerm(text, 'approved')) {
        return `${actor} 批准${topic}`;
    }
    if (includesTerm(text, 'expand') || includesTerm(text, 'expands') || includesTerm(text, 'expanded')) {
        return `${actor} 扩展${topic}`;
    }
    if ((includesTerm(text, 'share') || includesTerm(text, 'shares'))
        && (includesTerm(text, 'threat intelligence') || includesTerm(text, 'data') || includesTerm(text, 'information'))) {
        return `${actor} 将共享${topic}`;
    }
    if (includesTerm(text, 'begins') || includesTerm(text, 'rollout') || includesTerm(text, 'launch') || includesTerm(text, 'launches') || includesTerm(text, 'release')) {
        return `${actor} 开始${topic}`;
    }
    if (includesTerm(text, 'opens')) {
        return `${topic}窗口打开`;
    }
    if (includesTerm(text, 'hit') || includesTerm(text, 'hits') || includesTerm(text, 'near')) {
        return `${topic}`;
    }
    if (includesTerm(text, 'says') || includesTerm(text, 'said')) {
        return `${topic}`;
    }
    if (includesTerm(text, 'announce') || includesTerm(text, 'announces')) {
        return `${actor} 宣布${topic}`;
    }
    if (includesTerm(text, 'signal') || includesTerm(text, 'signals') || includesTerm(text, 'signaled')) {
        return `${actor}释放${topic}信号`;
    }
    if (includesTerm(text, 'reportedly follows suit')) {
        return `${actor} 据称跟进${topic}布局`;
    }
    if (includesTerm(text, 'cuts') || includesTerm(text, 'layoff') || includesTerm(text, 'layoffs')) {
        return `${actor} 调整${topic}`;
    }

    return null;
}

function buildAiObjectiveHeadline(item: DailyNewsItem, actor: string, topic: string, text: string): string | null {
    const subject = actor || extractHeadlineActor(item.title, item);

    if ((includesTerm(text, 'legal action') || includesTerm(text, 'lawsuit')) && includesTerm(text, 'apple')) {
        return `${subject}考虑对 Apple 采取法律行动`;
    }
    if (includesTerm(text, 'codex') && (includesTerm(text, 'phone') || includesTerm(text, 'mobile'))) {
        return `${subject}推进 Codex 移动端`;
    }
    if ((includesTerm(text, 'chip controls') || includesTerm(text, 'chip restrictions') || includesTerm(text, 'restrictions'))
        && (includesTerm(text, 'china') || includesTerm(text, 'h200'))) {
        return `${subject}推动 AI 芯片出口限制议题`;
    }
    if (includesTerm(text, 'h200') && (includesTerm(text, 'china') || includesTerm(text, 'beijing'))) {
        return 'Nvidia H200 对华销售许可受关注';
    }
    if (includesTerm(text, 'funding') || includesTerm(text, 'valuation') || includesTerm(text, 'raise')) {
        return `${subject}融资估值更新`;
    }
    if (includesTerm(text, 'ipo') && (includesTerm(text, 'cerebras') || includesTerm(text, 'chip'))) {
        return 'Cerebras AI 芯片 IPO 吸引资金';
    }
    if (includesTerm(text, 'deploy') || includesTerm(text, 'deploying') || includesTerm(text, 'deployment')) {
        const product = includesTerm(text, 'claude')
            ? 'Claude'
            : topic;
        return `${subject}推进 ${product} 企业落地`;
    }
    if (includesTerm(text, 'data center') || includesTerm(text, 'data centres') || includesTerm(text, 'datacenter')) {
        return `${subject}推进 AI 数据中心计划`;
    }
    if (includesTerm(text, 'compute crunch') || includesTerm(text, 'compute gamble') || includesTerm(text, 'compute demand')) {
        return `${subject}算力需求压力升温`;
    }
    if (includesTerm(text, 'education') && (includesTerm(text, 'policy') || includesTerm(text, 'practice'))) {
        return `${subject}发布 AI 教育政策实践`;
    }
    if (includesTerm(text, 'genkit') || includesTerm(text, 'middleware')) {
        return `${subject}发布 AI 应用中间件`;
    }
    if (includesTerm(text, 'agent') && (includesTerm(text, 'launch') || includesTerm(text, 'releases') || includesTerm(text, 'coding'))) {
        return `${subject}推出 AI Agent 工具`;
    }

    return null;
}

function buildMacroObjectiveHeadline(item: DailyNewsItem, topic: string, text: string): string | null {
    const title = cleanChineseStyle(item.title);
    const lowerTitle = title.toLowerCase();

    if (includesTerm(lowerTitle, '30-year') || includesTerm(lowerTitle, '30 year')) {
        const yieldMatch = title.match(/\b(5(?:\.\d+)?)\s*%/);
        return yieldMatch
            ? `30年期美债收益率升破 ${yieldMatch[1]}%`
            : '30年期美债收益率上行';
    }
    if ((includesTerm(lowerTitle, 'nasdaq') || includesTerm(lowerTitle, 's&p 500') || includesTerm(lowerTitle, 'futures'))
        && (includesTerm(lowerTitle, 'tumble') || includesTerm(lowerTitle, 'slide'))) {
        return '美债收益率跳升压低纳指与标普期货';
    }
    if (includesTerm(lowerTitle, 'may 2025 highs')) {
        return '美债收益率升至 2025年5月以来高位';
    }
    if (includesTerm(lowerTitle, 'dollar') && (includesTerm(lowerTitle, 'weekly gain') || includesTerm(lowerTitle, 'largest weekly gain'))) {
        return '美元受美债收益率上行支撑创两个月最大周涨幅';
    }
    if (includesTerm(lowerTitle, 'middle east')) {
        return '中东僵局推高全球债券收益率，美元走强';
    }
    if ((includesTerm(lowerTitle, 'global markets') || includesTerm(lowerTitle, 'u.s. futures'))
        && includesTerm(lowerTitle, 'oil rise')) {
        return '美股期货和全球市场下跌，美债收益率与油价上行';
    }
    if (includesTerm(lowerTitle, 'tricky rates path') || includesTerm(lowerTitle, 'fed chair')) {
        return '通胀数据令美联储利率路径更棘手，美债收益率跳升';
    }
    if (includesTerm(lowerTitle, 'japan') && includesTerm(lowerTitle, 'yields')) {
        return '日本国债收益率因全球通胀担忧升至多年高位';
    }
    if (includesTerm(lowerTitle, 'uk') && includesTerm(lowerTitle, '10-year')) {
        return '英国10年期国债收益率创 2008年以来高位';
    }
    if (includesTerm(lowerTitle, 'bitcoin') && includesTerm(lowerTitle, 'treasury yields')) {
        return '美债收益率走高令比特币承压';
    }
    if (includesTerm(text, 'cpi') && (includesTerm(text, 'hotter') || includesTerm(text, 'inflation worries'))) {
        return '通胀担忧推高美债收益率';
    }

    return topic === item.subcategory || topic === CATEGORY_LABELS[item.category]
        ? null
        : topic;
}

function buildObjectiveChineseTitle(item: DailyNewsItem): string {
    const cleanedCurrentTitle = cleanChineseStyle(item.title.trim());
    if (hasCjkText(item.title) && !isGenericNormalizedFallback(item)) {
        return cleanedCurrentTitle;
    }

    const evidenceTitle = [
        getEventSourceTitle(item.earliestSource),
        getEventSourceTitle(item.latestSource),
        ...(item.timeline || []).map((entry) => entry.title),
    ].find((candidate) => candidate && !hasCjkText(candidate));
    const objectiveItem = evidenceTitle ? { ...item, title: evidenceTitle } : item;
    const text = newsText(objectiveItem);
    const title = objectiveItem.title.trim();
    const subject = extractHeadlineActor(title, objectiveItem);
    const topic = extractHeadlineTopic(title, objectiveItem);
    const macroHeadline = objectiveItem.category === 'macro'
        ? buildMacroObjectiveHeadline(objectiveItem, topic, text)
        : null;
    if (macroHeadline) {
        return macroHeadline;
    }

    const aiHeadline = objectiveItem.category === 'ai'
        ? buildAiObjectiveHeadline(objectiveItem, subject, topic, text)
        : null;
    if (aiHeadline) {
        return aiHeadline;
    }

    const actionHeadline = buildActionHeadline(subject, topic, text);

    if (actionHeadline) {
        return actionHeadline;
    }

    if (includesTerm(text, 'reject') || includesTerm(text, 'rejected') || includesTerm(text, 'delay') || includesTerm(text, 'delays')) {
        return `${subject}${objectiveItem.subcategory || CATEGORY_LABELS[objectiveItem.category]}出现监管进展`;
    }
    if (includesTerm(text, 'approve') || includesTerm(text, 'approval') || includesTerm(text, 'approved')) {
        return `${subject}${objectiveItem.subcategory || CATEGORY_LABELS[objectiveItem.category]}获得批准`;
    }
    if (includesTerm(text, 'launch') || includesTerm(text, 'release') || includesTerm(text, 'rollout')) {
        return `${subject}${topic}开始落地`;
    }
    if (includesTerm(text, 'hack') || includesTerm(text, 'exploit') || includesTerm(text, 'breach')) {
        return `${subject}安全事件披露细节`;
    }
    if (includesTerm(text, 'lawsuit') || includesTerm(text, 'charges') || includesTerm(text, 'settlement')) {
        return `${subject}监管或法律事件披露细节`;
    }

    if (objectiveItem.category === 'macro') {
        return topic === objectiveItem.subcategory || topic === CATEGORY_LABELS[objectiveItem.category]
            ? cleanedCurrentTitle
            : topic;
    }
    if (objectiveItem.category === 'crypto') {
        return `${subject}${topic}出现新进展`;
    }
    if (objectiveItem.category === 'ai') {
        return `${subject}${topic}出现新进展`;
    }

    return cleanChineseStyle(title);
}

function extractNumericFacts(text: string): string[] {
    const facts = new Set<string>();
    const patterns = [
        /\b\d{1,2}\s*-\s*year\b/gi,
        /\b\d{1,2}\s*year\b/gi,
        /\b\d+(?:\.\d+)?\s*%/g,
        /\$\s?\d+(?:\.\d+)?\s?(?:bn|billion|tn|trillion|m|million|t)\b/gi,
        /\b\d+(?:\.\d+)?\s?(?:bn|billion|tn|trillion)\b/gi,
    ];

    patterns.forEach((pattern) => {
        text.match(pattern)?.forEach((match) => facts.add(match.replace(/\s+/g, ' ').trim()));
    });

    return [...facts].slice(0, 3);
}

function localizeNumericFact(fact: string): string {
    return fact
        .replace(/\b(\d{1,2})\s*-\s*year\b/i, '$1年期')
        .replace(/\b(\d{1,2})\s*year\b/i, '$1年期')
        .replace(/\bbn\b/i, '十亿')
        .replace(/\bbillion\b/i, '十亿')
        .replace(/\btn\b/i, '万亿')
        .replace(/\btrillion\b/i, '万亿')
        .replace(/\bmillion\b/i, '百万')
        .replace(/\bm\b/i, '百万')
        .replace(/\bt\b/i, '万亿')
        .replace(/\$\s?/g, '');
}

function buildMacroFactSummary(item: DailyNewsItem, title: string): string {
    const sourceText = `${item.title} ${item.summary || ''} ${(item.tags || []).join(' ')}`;
    const lowerText = sourceText.toLowerCase();
    const facts = extractNumericFacts(sourceText).map(localizeNumericFact);
    const factText = facts.length > 0 ? `，关键数字包括 ${facts.join('、')}` : '';

    if ((includesTerm(lowerText, 'fed') || includesTerm(lowerText, 'federal reserve'))
        && (includesTerm(lowerText, 'rate cut') || includesTerm(lowerText, 'rate cuts') || includesTerm(lowerText, 'rates'))) {
        const inflationText = includesTerm(lowerText, 'cpi') || includesTerm(lowerText, 'inflation')
            ? '，背景是 CPI/通胀数据仍偏黏'
            : '';
        return `报道称，美联储相关信号使降息路径重新定价${inflationText}${factText}。`;
    }

    if (includesTerm(lowerText, 'treasury yield') || includesTerm(lowerText, 'treasury yields') || includesTerm(lowerText, 'yields')) {
        const costText = includesTerm(lowerText, 'interest bill') || includesTerm(lowerText, 'interest costs')
            ? '，同时抬高美国财政利息支出压力'
            : '';
        return `报道称，美债收益率上行${costText}${factText}，会压缩风险资产估值空间。`;
    }

    if (includesTerm(lowerText, 'cpi') || includesTerm(lowerText, 'inflation') || includesTerm(lowerText, 'ppi')) {
        return `报道称，通胀读数改变市场对实际利率和政策转向时点的判断${factText}。`;
    }

    if (includesTerm(lowerText, 'payrolls') || includesTerm(lowerText, 'nonfarm') || includesTerm(lowerText, 'jobs')) {
        return `报道称，就业数据会影响工资通胀、增长韧性和美联储政策反应判断${factText}。`;
    }

    if (includesTerm(lowerText, 'oil') || includesTerm(lowerText, 'war') || includesTerm(lowerText, 'sanction') || includesTerm(lowerText, 'tariff')) {
        return `报道称，能源、地缘或关税冲击正在影响通胀预期、美元避险需求和全球风险偏好${factText}。`;
    }

    return `${title}。报道指向利率、美元流动性或通胀预期的重新定价${factText}。`;
}

function buildObjectiveChineseSummary(item: DailyNewsItem, title: string): string {
    if (hasCjkText(item.summary)) {
        return compactNewsSummary(item.summary.trim(), title);
    }

    if (item.category === 'macro') {
        return buildMacroFactSummary(item, title);
    }

    if (item.summary && item.summary.trim()) {
        return `${title}。`;
    }

    return `${title}，具体细节未公开。`;
}

export function normalizeToChinese(item: DailyNewsItem): DailyNewsItem {
    const title = buildObjectiveChineseTitle(item);
    const summary = buildObjectiveChineseSummary(item, title);
    const normalized: DailyNewsItem = {
        ...item,
        title,
        summary,
    };

    normalized.summarySections = buildSummarySections({
        ...normalized,
        summary,
        title,
    });

    return {
        ...normalized,
        title: cleanChineseStyle(normalized.title),
        summary: cleanChineseStyle(normalized.summary),
        summarySections: {
            whatHappened: cleanChineseStyle(normalized.summarySections.whatHappened),
            whyImportant: cleanChineseStyle(normalized.summarySections.whyImportant),
            whatToWatch: cleanChineseStyle(normalized.summarySections.whatToWatch),
            sourceAndConfirmation: cleanChineseStyle(normalized.summarySections.sourceAndConfirmation),
        },
        earliestSource: cleanEventSource(normalized.earliestSource),
        latestSource: cleanEventSource(normalized.latestSource),
        officialSource: cleanEventSource(normalized.officialSource),
        timeline: normalized.timeline?.map((entry) => ({
            ...entry,
            title: cleanChineseStyle(entry.title),
            source: cleanChineseStyle(entry.source),
        })),
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
    const hasRoutineNoise = category !== 'macro'
        && ROUTINE_NOISE_TERMS.some((term) => includesTerm(text, term));
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
        .filter((item) => !isHardMarketingNoise(item)
            && !isKolOpinionNoise(item)
            && !isAdviceExplainerNoise(item)
            && !isWeakMarketRecap(item)
            && !isMacroCryptoCarryTradeNoise(item)
            && !isSingleStockMacroNoise(item)
            && !isCryptoRoundupNoise(item)
            && !isCryptoAdjacentBusinessNoise(item)
            && !isAiProductRumorNoise(item)
            && !isLowValueAiIndustryNoise(item)
            && !isAnalysisOrOpinionWithoutEvent(item))
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
    const text = dailyItemEvidenceText(item);
    const sourceText = [
        item.title,
        item.summary,
        item.tags.join(' '),
        item.timeline?.map((entry) => entry.title).join(' ') || '',
    ].join(' ').toLowerCase();
    const hasSystemicSignal = SYSTEMIC_IMPORTANCE_TERMS.some((term) => includesTerm(text, term));
    const hasRoutineNoise = ROUTINE_NOISE_TERMS.some((term) => includesTerm(text, term));
    const hasSocialRumorSource = item.earliestSource?.domain
        ? domainMatches(item.earliestSource.domain, SOCIAL_RUMOR_DOMAINS)
        : false;
    const hasLowValueAiSignal = item.category === 'ai' && LOW_VALUE_AI_TERMS.some((term) => includesTerm(text, term));
    const hasLowValueCryptoSignal = item.category === 'crypto' && LOW_VALUE_CRYPTO_TERMS.some((term) => includesTerm(text, term));
    const hasMacroCryptoCarryTradeNoise = item.category === 'macro'
        && item.sourceTier !== 'major'
        && (sourceText.includes('bitcoin') || sourceText.includes(' btc') || sourceText.includes('etf') || sourceText.includes('比特币') || sourceText.includes('加密'))
        && (sourceText.includes('treasury yield') || sourceText.includes('treasury yields') || sourceText.includes('yields') || sourceText.includes('美债收益率'))
        && !(sourceText.includes('cpi') || sourceText.includes('inflation data') || includesTerm(sourceText, 'fed') || sourceText.includes('federal reserve') || sourceText.includes('rate decision') || sourceText.includes('dollar') || sourceText.includes('oil') || sourceText.includes('通胀') || sourceText.includes('美元') || sourceText.includes('油价'));
    const hasSingleStockMacroNoise = item.category === 'macro'
        && (sourceText.includes('nvidia') || sourceText.includes('英伟达') || sourceText.includes('stock') || sourceText.includes('stocks') || sourceText.includes('shares') || sourceText.includes('bulls') || sourceText.includes('market cap') || sourceText.includes('trillion-dollar'))
        && !(sourceText.includes('treasury') || sourceText.includes('yield') || sourceText.includes('dxy') || sourceText.includes('cpi') || sourceText.includes('inflation') || includesTerm(sourceText, 'fed') || sourceText.includes('rate decision') || sourceText.includes('oil') || sourceText.includes('tariff') || sourceText.includes('美债') || sourceText.includes('美元') || sourceText.includes('通胀') || sourceText.includes('油价'));
    const hasCryptoRoundupNoise = item.category === 'crypto'
        && (sourceText.includes('星球午讯') || sourceText.includes('星球晚讯') || sourceText.includes('午讯') || sourceText.includes('晚讯') || sourceText.includes('top stories') || sourceText.includes('daily recap') || sourceText.includes('roundup'))
        && (sourceText.includes('1.') || sourceText.includes('2.') || sourceText.includes('3.') || sourceText.includes('总净流出') || sourceText.includes('要闻'));

    if (isHardMarketingNoise(item)
        || isKolOpinionNoise(item)
        || isAdviceExplainerNoise(item)
        || isPurePriceMove(item)
        || isListingPriceReaction(item)
        || isWeakMarketRecap(item)
        || isMacroCryptoCarryTradeNoise(item)
        || isSingleStockMacroNoise(item)
        || isCryptoRoundupNoise(item)
        || hasMacroCryptoCarryTradeNoise
        || hasSingleStockMacroNoise
        || hasCryptoRoundupNoise
        || isCryptoAdjacentBusinessNoise(item)
        || isAiProductRumorNoise(item)
        || isLowValueAiIndustryNoise(item)
        || isAnalysisOrOpinionWithoutEvent(item)
        || isGenericNormalizedFallback(item)) {
        return false;
    }

    if (hasSocialRumorSource && item.confirmationLevel === 'single_source') {
        return false;
    }

    if ((hasRoutineNoise || hasLowValueAiSignal || hasLowValueCryptoSignal) && !hasSystemicSignal) {
        return false;
    }

    if (item.category === 'macro' && !hasCategoryEventEvidence(item)) {
        return false;
    }

    return item.importanceScore >= MIN_EDITORIAL_IMPORTANCE_SCORE
        || (hasSystemicSignal && item.importanceScore >= 50)
        || (item.importanceScore >= 45 && item.sourceTier !== 'unknown' && item.confirmationLevel !== 'single_source');
}

function isGenericNormalizedFallback(item: DailyNewsItem): boolean {
    const title = item.title.trim();
    if (/^(监管|芯片|模型|加密|宏观|交易所|稳定币|ETF|央行|通胀|就业|商品|美债收益率变化)$/.test(title)) {
        return true;
    }
    if (/^\d+年期美债收益率升至阶段高位$/.test(title)) {
        return true;
    }
    if (/出现新进展$/.test(title)) {
        return true;
    }
    if (/^[A-Za-z0-9 .&-]+\s+(加密|模型|芯片|交易所|监管)出现新进展$/.test(title)) {
        return true;
    }
    if (/^ETF\s+开始\s+ETF$/.test(title) || /^.+\s+开始(加密|模型|芯片|交易所|监管|安全事件)$/.test(title)) {
        return true;
    }
    if (/^(比特币|以太坊)?\s*ETF$/.test(title) && item.importanceScore < TOP_STORY_MIN_SCORE) {
        return true;
    }
    return false;
}

export function isTopStoryEligible(item: DailyNewsItem): boolean {
    if (item.importanceScore < TOP_STORY_MIN_SCORE) {
        return false;
    }

    return !isHardMarketingNoise(item)
        && !isKolOpinionNoise(item)
        && !isAdviceExplainerNoise(item)
        && !isPurePriceMove(item)
        && !isListingPriceReaction(item)
        && !isPriceFramedWithoutConcreteEvent(item)
        && !isWeakMarketRecap(item)
        && !isMacroCryptoCarryTradeNoise(item)
        && !isSingleStockMacroNoise(item)
        && !isCryptoRoundupNoise(item)
        && !isCryptoAdjacentBusinessNoise(item)
        && !isAiProductRumorNoise(item)
        && !isLowValueAiIndustryNoise(item)
        && !isAnalysisOrOpinionWithoutEvent(item)
        && hasCategoryEventEvidence(item);
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
        .filter(isTopStoryEligible)
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

        if (isMacroCryptoCarryTradeNoise(candidate) || isSingleStockMacroNoise(candidate) || isCryptoRoundupNoise(candidate)) {
            dropped.unimportant += 1;
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
            digest.categoryStatus[category] = {
                ...emptyStatus(result?.error || 'Category collection failed'),
                sourceAttempts: result?.sourceAttempts,
                totalCandidates: result?.candidates.length ?? 0,
                degradedReason: result?.degradedReason,
            };
            return;
        }

        const ranked = dedupeAndRankCandidates(category, result.candidates, window, limit);
        digest[category] = ranked.items.map(normalizeToChinese);
        digest.categoryStatus[category] = {
            status: ranked.items.length >= limit ? 'ok' : 'partial',
            requested: result.candidates.length,
            returned: ranked.items.length,
            dropped: ranked.dropped,
            sourceAttempts: result.sourceAttempts,
            totalCandidates: result.candidates.length,
            degradedReason: result.degradedReason,
        };
    });

    digest.brief = buildDailyNewsBrief(digest);
    digest.topStories = buildTopStories(digest);

    return digest;
}

export function sanitizeDailyNewsDigest(digest: DailyNewsDigest): DailyNewsDigest {
    NEWS_CATEGORIES.forEach((category) => {
        digest[category] = digest[category].map(normalizeToChinese);
        const before = digest[category].length;
        digest[category] = digest[category].filter(isEditoriallyImportant);
        const removed = before - digest[category].length;
        if (removed > 0) {
            digest.categoryStatus[category] = {
                ...digest.categoryStatus[category],
                returned: digest[category].length,
                dropped: {
                    ...digest.categoryStatus[category].dropped,
                    unimportant: digest.categoryStatus[category].dropped.unimportant + removed,
                },
                status: digest[category].length >= DEFAULT_CATEGORY_LIMIT ? 'ok' : 'partial',
            };
        }
    });

    digest.brief = buildDailyNewsBrief(digest);
    digest.topStories = buildTopStories(digest);

    return digest;
}

export function hasAnyDailyNewsItems(digest: DailyNewsDigest): boolean {
    return NEWS_CATEGORIES.some((category) => digest[category].length > 0);
}
