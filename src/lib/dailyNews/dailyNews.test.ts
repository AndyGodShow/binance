import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import {
    buildDailyNewsDigestFromResults,
    calculateDailyNewsWindow,
    dedupeAndRankCandidates,
    formatDailyNewsWindow,
    isNewsCandidateRelevant,
    sanitizeDailyNewsDigest,
} from './pipeline.ts';
import { normalizeGdeltDate } from './gdelt.ts';
import { rssInternals } from './rss.ts';
import { sixFiveFiveOneInternals } from './sixFiveFiveOne.ts';
import { scoreNewsCandidate, toImportanceLevel } from './scoring.ts';
import { createDailyNewsFileStorage } from './storage.ts';
import { translationInternals } from './translate.ts';
import type { CategoryCollectionResult, NewsCandidate } from './types.ts';

const NOW = new Date('2026-04-18T00:00:00.000Z');
const WINDOW = calculateDailyNewsWindow(NOW);

function candidate(overrides: Partial<NewsCandidate> = {}): NewsCandidate {
    return {
        category: 'macro',
        title: 'Federal Reserve officials signal caution on rate cuts after inflation data',
        summary: 'Fed officials pushed back on faster cuts after inflation stayed sticky, lifting the policy risk premium for risk assets.',
        source: 'Reuters',
        domain: 'reuters.com',
        url: 'https://www.reuters.com/markets/us/fed-officials-signal-caution-rate-cuts-2026-04-17/',
        publishedAt: '2026-04-17T16:00:00.000Z',
        collectedAt: '2026-04-18T00:00:00.000Z',
        tags: ['Fed', 'rates'],
        rawSnippet: 'Federal Reserve officials signaled caution after inflation data.',
        ...overrides,
    };
}

test('calculateDailyNewsWindow uses a rolling 24 hour window in Asia/Shanghai', () => {
    assert.equal(WINDOW.timezone, 'Asia/Shanghai');
    assert.equal(WINDOW.windowEnd, '2026-04-18T00:00:00.000Z');
    assert.equal(WINDOW.windowStart, '2026-04-17T00:00:00.000Z');
    assert.equal(
        formatDailyNewsWindow(WINDOW),
        '2026-04-17 08:00 ~ 2026-04-18 08:00'
    );
});

test('normalizeGdeltDate parses GDELT seendate timestamps', () => {
    assert.equal(
        normalizeGdeltDate('20260418T044500Z'),
        '2026-04-18T04:45:00.000Z'
    );
});

test('daily news RSS sources include Chinese crypto media feeds', () => {
    const cryptoSources = rssInternals.getSourcesForCategory('crypto');
    const urls = cryptoSources.map((source) => source.url);

    assert.ok(urls.includes('https://api.theblockbeats.news/v2/rss/newsflash'));
    assert.ok(urls.includes('https://api.theblockbeats.news/v2/rss/article'));
    assert.ok(urls.includes('https://rss.odaily.news/rss/newsflash'));
    assert.ok(urls.includes('https://rss.odaily.news/rss/post'));
});

test('daily news RSS sources include official and specialist AI feeds', () => {
    const aiSources = rssInternals.getSourcesForCategory('ai');
    const urls = aiSources.map((source) => source.url);

    assert.ok(urls.includes('https://openai.com/news/rss.xml'));
    assert.ok(urls.includes('https://blog.google/innovation-and-ai/technology/ai/rss/'));
    assert.ok(urls.includes('https://blogs.nvidia.com/feed/'));
    assert.ok(urls.includes('https://blogs.microsoft.com/ai/feed/'));
    assert.ok(urls.includes('https://www.theverge.com/rss/ai-artificial-intelligence/index.xml'));
    assert.ok(urls.includes('https://huggingface.co/blog/feed.xml'));
});

test('6551 hot news payload parser maps open news items into candidates', () => {
    const candidates = sixFiveFiveOneInternals.parse6551HotNewsPayload({
        success: true,
        data: {
            news: [
                {
                    title: '律动消息：某交易所披露钱包安全事件<br/>已暂停提现',
                    summary_zh: '<span>交易所公告称已暂停提现并排查钱包基础设施。</span>',
                    url: 'https://www.theblockbeats.info/flash/123',
                    source: '律动 BlockBeats',
                    published_at: '2026-04-17T18:00:00.000Z',
                },
            ],
            tweets: [
                {
                    text: 'SEC delays decision on spot Ethereum ETF staking proposal',
                    link: 'https://x.com/example/status/1',
                    author: 'opennews',
                    created_at: '2026-04-17T19:00:00.000Z',
                },
            ],
        },
    }, 'crypto', WINDOW);

    assert.equal(candidates.length, 2);
    assert.equal(candidates[0]?.category, 'crypto');
    assert.equal(candidates[0]?.source, '律动 BlockBeats');
    assert.equal(candidates[0]?.domain, 'theblockbeats.info');
    assert.match(candidates[0]?.title || '', /钱包安全事件/);
    assert.doesNotMatch(candidates[0]?.title || '', /<br|span/i);
    assert.equal(candidates[0]?.summary, '交易所公告称已暂停提现并排查钱包基础设施。');
    assert.equal(candidates[1]?.source, '6551 Twitter');
    assert.equal(candidates[1]?.domain, 'x.com');
});

test('translation helpers only translate non-Chinese text', () => {
    assert.equal(translationInternals.containsCjk('每日新闻'), true);
    assert.equal(translationInternals.containsCjk('Daily News'), false);
    assert.equal(translationInternals.shouldTranslateText('Ethereum ETF staking proposal delayed again'), true);
    assert.equal(translationInternals.shouldTranslateText('以太坊 ETF 质押提案再次延期'), false);
});

test('isNewsCandidateRelevant keeps category-specific events and rejects weak matches', () => {
    assert.equal(isNewsCandidateRelevant(candidate(), 'macro'), true);
    assert.equal(isNewsCandidateRelevant(candidate({
        category: 'ai',
        title: 'OpenAI releases new reasoning model for enterprise developers',
        summary: 'The release changes the competitive bar for AI products and developer platforms.',
        domain: 'openai.com',
        source: 'OpenAI',
    }), 'ai'), true);
    assert.equal(isNewsCandidateRelevant(candidate({
        category: 'crypto',
        title: 'Bitcoin ETF issuers record heavy daily inflows as BTC holds breakout',
        summary: 'Spot ETF demand increased institutional exposure and can affect BTC market liquidity.',
        domain: 'cointelegraph.com',
        source: 'Cointelegraph',
    }), 'crypto'), true);
    assert.equal(isNewsCandidateRelevant(candidate({
        category: 'crypto',
        title: 'Local startup opens a small community event',
        summary: 'The event is unrelated to digital assets or market structure.',
        domain: 'example.com',
        source: 'Example',
    }), 'crypto'), false);
});

test('dedupeAndRankCandidates aggregates same-event articles before selecting top items', () => {
    const candidates: NewsCandidate[] = [
        candidate({
            title: 'SEC delays decision on spot Ethereum ETF staking proposal',
            summary: 'The delay keeps staking yield out of US spot ETH ETF products for now.',
            source: 'Reuters',
            domain: 'reuters.com',
            url: 'https://www.reuters.com/technology/sec-delays-eth-staking-etf-2026-04-17/',
            category: 'crypto',
            tags: ['ETH', 'ETF', 'SEC'],
        }),
        candidate({
            title: 'SEC delays decision on Ethereum ETF staking plan',
            summary: 'The regulator postponed its decision on staking inside spot ether funds.',
            source: 'Bloomberg',
            domain: 'bloomberg.com',
            url: 'https://www.bloomberg.com/news/articles/2026-04-17/sec-delays-ethereum-etf-staking-plan',
            category: 'crypto',
            tags: ['ETH', 'ETF', 'SEC'],
        }),
        candidate({
            title: 'Bitcoin miner reserves fall after hashprice pressure',
            summary: 'Miner treasury pressure can add supply risk during weak liquidity windows.',
            source: 'CoinDesk',
            domain: 'coindesk.com',
            url: 'https://www.coindesk.com/markets/2026/04/17/bitcoin-miner-reserves-fall/',
            category: 'crypto',
            tags: ['BTC', 'mining'],
        }),
    ];

    const result = dedupeAndRankCandidates('crypto', candidates, WINDOW, 10);

    assert.equal(result.items.length, 2);
    assert.match(result.items[0].title, /Ethereum ETF staking/i);
    assert.ok(result.items[0].tags.includes('2 家来源'));
    assert.equal(result.dropped.duplicates, 1);
});

test('dedupeAndRankCandidates orders selected news by newest publish time first', () => {
    const result = dedupeAndRankCandidates('crypto', [
        candidate({
            category: 'crypto',
            title: 'SEC approves spot Solana ETF filing after Bitcoin ETF inflows',
            summary: 'A US ETF approval can widen institutional access to crypto assets.',
            source: 'Reuters',
            domain: 'reuters.com',
            url: 'https://www.reuters.com/technology/sec-approves-solana-etf-2026-04-17/',
            publishedAt: '2026-04-17T10:00:00.000Z',
            tags: ['SEC', 'ETF', 'SOL', 'BTC'],
        }),
        candidate({
            category: 'crypto',
            title: 'Bitcoin miners report liquidation pressure as crypto markets steady',
            summary: 'Miner pressure can affect BTC supply during weaker liquidity windows.',
            source: 'CoinDesk',
            domain: 'coindesk.com',
            url: 'https://www.coindesk.com/markets/2026/04/17/bitcoin-miners-liquidation-pressure/',
            publishedAt: '2026-04-17T22:00:00.000Z',
            tags: ['BTC', 'liquidation'],
        }),
    ], WINDOW, 10);

    assert.match(result.items[0].title, /miners/i);
    assert.match(result.items[1].title, /Solana ETF/i);
});

test('dedupeAndRankCandidates uses importance score as a tie breaker for same-time news', () => {
    const publishedAt = '2026-04-17T18:00:00.000Z';
    const result = dedupeAndRankCandidates('crypto', [
        candidate({
            category: 'crypto',
            title: 'Small blockchain token announces community wallet update',
            summary: 'A crypto wallet update was released for a smaller blockchain community.',
            source: 'Example',
            domain: 'example.com',
            url: 'https://example.com/small-blockchain-token-wallet-update',
            publishedAt,
            tags: ['crypto', 'wallet'],
        }),
        candidate({
            category: 'crypto',
            title: 'SEC approves spot Bitcoin ETF options as Ethereum liquidity improves',
            summary: 'The approval can shift institutional crypto liquidity and BTC market structure.',
            source: 'Reuters',
            domain: 'reuters.com',
            url: 'https://www.reuters.com/markets/sec-approves-bitcoin-etf-options-2026-04-17/',
            publishedAt,
            tags: ['SEC', 'ETF', 'BTC', 'ETH'],
        }),
    ], WINDOW, 10);

    assert.match(result.items[0].title, /Bitcoin ETF/i);
    assert.ok(result.items[0].importanceScore > result.items[1].importanceScore);
});

test('dedupeAndRankCandidates rejects routine small-project and price-only noise', () => {
    const result = dedupeAndRankCandidates('crypto', [
        candidate({
            category: 'crypto',
            title: 'Tiny token announces community AMA and airdrop campaign',
            summary: 'A small token community plans an AMA, giveaway and roadmap update.',
            source: 'Example',
            domain: 'example.com',
            url: 'https://example.com/tiny-token-ama-airdrop',
            publishedAt: '2026-04-17T18:00:00.000Z',
            tags: ['token', 'airdrop', 'AMA'],
            rawSnippet: '',
        }),
        candidate({
            category: 'crypto',
            title: 'Meme coin jumps 8% as trader predicts more upside',
            summary: 'A trader said the token could rally further after a short-term price move.',
            source: 'Example',
            domain: 'example.com',
            url: 'https://example.com/meme-coin-price-prediction',
            publishedAt: '2026-04-17T19:00:00.000Z',
            tags: ['crypto', 'token'],
            rawSnippet: '',
        }),
        candidate({
            category: 'crypto',
            title: 'SEC charges major crypto exchange over stablecoin reserve disclosures',
            summary: 'The enforcement action can change compliance expectations for exchanges and stablecoin issuers.',
            source: 'Reuters',
            domain: 'reuters.com',
            url: 'https://www.reuters.com/technology/sec-crypto-exchange-stablecoin-charges-2026-04-17/',
            publishedAt: '2026-04-17T20:00:00.000Z',
            tags: ['SEC', 'stablecoin', 'exchange'],
            rawSnippet: '',
        }),
    ], WINDOW, 10);

    assert.equal(result.items.length, 1);
    assert.match(result.items[0].title, /SEC charges/i);
    assert.equal(result.dropped.unimportant, 2);
});

test('dedupeAndRankCandidates rejects price crossing marketing and KOL opinion noise', () => {
    const result = dedupeAndRankCandidates('crypto', [
        candidate({
            category: 'crypto',
            title: 'Bitcoin crosses $81,000, ETH, SOL, DOGE steady as options desks bid on further price jump',
            summary: 'The article describes a short-term price crossing without a new regulatory or infrastructure fact.',
            source: 'CoinDesk',
            domain: 'coindesk.com',
            url: 'https://www.coindesk.com/markets/2026/04/17/bitcoin-crosses-81000/',
            publishedAt: '2026-04-17T18:00:00.000Z',
            tags: ['BTC', 'ETH', 'SOL'],
            rawSnippet: '',
        }),
        candidate({
            category: 'crypto',
            title: 'Pepeto price prediction: best crypto presale to buy now before token sale',
            summary: 'A sponsored article says the token could be the next moonshot gem with 100x potential.',
            source: 'FinanceFeeds',
            domain: 'financefeeds.com',
            url: 'https://example.com/pepeto-price-prediction-best-crypto-presale',
            publishedAt: '2026-04-17T19:00:00.000Z',
            tags: ['crypto', 'token'],
            rawSnippet: '',
        }),
        candidate({
            category: 'crypto',
            title: 'Scott Melker says SEC and CFTC may clarify crypto rules soon',
            summary: 'The trader predicts regulators could act soon without citing a filing.',
            source: 'Traders Union',
            domain: 'tradersunion.com',
            url: 'https://example.com/scott-melker-sec-cftc-crypto-rules',
            publishedAt: '2026-04-17T20:00:00.000Z',
            tags: ['SEC', 'CFTC'],
            rawSnippet: '',
        }),
        candidate({
            category: 'crypto',
            title: 'SEC rejects spot Bitcoin ETF rule change, BTC falls after decision',
            summary: 'The regulator rejected a filing for a spot Bitcoin ETF rule change.',
            source: 'Reuters',
            domain: 'reuters.com',
            url: 'https://www.reuters.com/technology/sec-rejects-bitcoin-etf-rule-change-2026-04-17/',
            publishedAt: '2026-04-17T21:00:00.000Z',
            tags: ['SEC', 'ETF', 'BTC'],
            rawSnippet: '',
        }),
    ], WINDOW, 10);

    assert.equal(result.items.length, 1);
    assert.match(result.items[0].title, /SEC rejects/i);
    assert.equal(result.dropped.unimportant, 3);
});

test('dedupeAndRankCandidates rejects Chinese translated crypto marketing noise', () => {
    const result = dedupeAndRankCandidates('crypto', [
        candidate({
            category: 'crypto',
            title: '2026 年 5 月最佳加密预售：随着 ETF 资金大量涌入比特币，AlphaPepe 领先 7 个精选',
            summary: '这是一篇推广 AlphaPepe 预售和精选代币的营销稿。',
            source: 'openPR.com',
            domain: 'openpr.com',
            url: 'https://example.com/alphapepe-best-crypto-presale',
            publishedAt: '2026-04-17T18:00:00.000Z',
            tags: ['ETF', 'BTC'],
            rawSnippet: '',
        }),
        candidate({
            category: 'crypto',
            title: 'Pepeto 模仿 SOL 和 LINK 起源，新加密货币资本推动 BTC ETF 流入创纪录',
            summary: '这篇文章推广 Pepeto 项目并借 BTC ETF 流入包装叙事。',
            source: 'TechBullion',
            domain: 'techbullion.com',
            url: 'https://example.com/pepeto-sol-link-btc-etf',
            publishedAt: '2026-04-17T19:00:00.000Z',
            tags: ['ETF', 'BTC', 'SOL'],
            rawSnippet: '',
        }),
        candidate({
            category: 'crypto',
            title: 'SEC rejects spot Bitcoin ETF rule change, BTC falls after decision',
            summary: 'The regulator rejected a filing for a spot Bitcoin ETF rule change.',
            source: 'Reuters',
            domain: 'reuters.com',
            url: 'https://www.reuters.com/technology/sec-rejects-bitcoin-etf-rule-change-2026-04-17/',
            publishedAt: '2026-04-17T20:00:00.000Z',
            tags: ['SEC', 'ETF', 'BTC'],
            rawSnippet: '',
        }),
    ], WINDOW, 10);

    assert.equal(result.items.length, 1);
    assert.match(result.items[0].title, /SEC rejects/i);
    assert.doesNotMatch(result.items.map((item) => item.title).join('\n'), /AlphaPepe|Pepeto|预售|最佳加密/i);
});

test('dedupeAndRankCandidates filters routine financing partnership listing and activity noise', () => {
    const result = dedupeAndRankCandidates('crypto', [
        candidate({
            category: 'crypto',
            title: 'Small DeFi token raises seed round and teases roadmap update',
            summary: 'A low market cap project announced financing and future staking plans.',
            source: 'Example',
            domain: 'example.com',
            url: 'https://example.com/small-defi-seed-roadmap',
            publishedAt: '2026-04-17T12:00:00.000Z',
            tags: ['DeFi', 'funding', 'staking'],
            rawSnippet: '',
        }),
        candidate({
            category: 'crypto',
            title: 'Altcoin project announces integration partnership and NFT testnet event',
            summary: 'The team said it will run an NFT activity and testnet campaign.',
            source: 'Example',
            domain: 'example.com',
            url: 'https://example.com/altcoin-integration-nft-testnet',
            publishedAt: '2026-04-17T13:00:00.000Z',
            tags: ['partnership', 'NFT', 'testnet'],
            rawSnippet: '',
        }),
        candidate({
            category: 'crypto',
            title: 'Binance reports wallet incident affecting exchange withdrawal infrastructure',
            summary: 'The exchange said it paused withdrawals while investigating a wallet security incident.',
            source: 'Binance',
            domain: 'binance.com',
            url: 'https://www.binance.com/en/support/announcement/wallet-security-incident-2026-04-17',
            publishedAt: '2026-04-17T14:00:00.000Z',
            tags: ['Binance', 'wallet', 'security'],
            rawSnippet: '',
        }),
    ], WINDOW, 10);

    assert.equal(result.items.length, 1);
    assert.match(result.items[0].title, /wallet incident/i);
    assert.equal(result.dropped.unimportant, 2);
});

test('dedupeAndRankCandidates keeps systemic crypto events that should not be overfiltered', () => {
    const result = dedupeAndRankCandidates('crypto', [
        candidate({
            category: 'crypto',
            title: 'Major DeFi bridge exploit drains $180 million in crypto assets',
            summary: 'Security researchers said the bridge exploit affected multiple chains and user funds.',
            source: 'The Block',
            domain: 'theblock.co',
            url: 'https://www.theblock.co/post/bridge-exploit-180m-2026-04-17',
            publishedAt: '2026-04-17T11:00:00.000Z',
            tags: ['hack', 'exploit', 'DeFi'],
            rawSnippet: '',
        }),
        candidate({
            category: 'crypto',
            title: 'USDC briefly depegs after reserve disclosure prompts regulatory review',
            summary: 'Circle said it is working with regulators after a reserve disclosure raised questions.',
            source: 'Reuters',
            domain: 'reuters.com',
            url: 'https://www.reuters.com/technology/usdc-depeg-reserve-disclosure-2026-04-17/',
            publishedAt: '2026-04-17T12:00:00.000Z',
            tags: ['USDC', 'stablecoin', 'regulation'],
            rawSnippet: '',
        }),
        candidate({
            category: 'crypto',
            title: 'Coinbase discloses security incident involving institutional custody system',
            summary: 'The exchange said it contained a security issue in institutional custody infrastructure.',
            source: 'Coinbase',
            domain: 'coinbase.com',
            url: 'https://www.coinbase.com/blog/custody-security-incident-2026-04-17',
            publishedAt: '2026-04-17T13:00:00.000Z',
            tags: ['Coinbase', 'security', 'custody'],
            rawSnippet: '',
        }),
    ], WINDOW, 10);

    assert.equal(result.items.length, 3);
    assert.ok(result.items.some((item) => /bridge exploit/i.test(item.title)));
    assert.ok(result.items.some((item) => /USDC/i.test(item.title)));
    assert.ok(result.items.some((item) => /Coinbase/i.test(item.title)));
});

test('dedupeAndRankCandidates annotates source confidence and editorial reason', () => {
    const result = dedupeAndRankCandidates('crypto', [
        candidate({
            category: 'crypto',
            title: 'Binance publishes proof-of-reserves update for major crypto assets',
            summary: 'The official reserve update affects exchange transparency and asset custody expectations.',
            source: 'Binance',
            domain: 'binance.com',
            url: 'https://www.binance.com/en/proof-of-reserves/update-2026-04-17',
            publishedAt: '2026-04-17T18:00:00.000Z',
            tags: ['Binance', 'reserve', 'BTC', 'ETH'],
            rawSnippet: '',
        }),
        candidate({
            category: 'crypto',
            title: 'SEC delays decision on spot Ethereum ETF staking proposal',
            summary: 'The delay keeps staking yield out of US spot ETH ETF products for now.',
            source: 'Reuters',
            domain: 'reuters.com',
            url: 'https://www.reuters.com/technology/sec-delays-eth-staking-etf-2026-04-17/',
            publishedAt: '2026-04-17T17:00:00.000Z',
            tags: ['SEC', 'ETF', 'ETH'],
            rawSnippet: '',
        }),
        candidate({
            category: 'crypto',
            title: 'SEC delays decision on Ethereum ETF staking plan',
            summary: 'The regulator postponed its decision on staking inside spot ether funds.',
            source: 'Bloomberg',
            domain: 'bloomberg.com',
            url: 'https://www.bloomberg.com/news/articles/2026-04-17/sec-delays-ethereum-etf-staking-plan',
            publishedAt: '2026-04-17T17:05:00.000Z',
            tags: ['SEC', 'ETF', 'ETH'],
            rawSnippet: '',
        }),
    ], WINDOW, 10);

    const officialItem = result.items.find((item) => item.source === 'Binance');
    const multiSourceItem = result.items.find((item) => /Ethereum ETF staking/i.test(item.title));

    assert.equal(officialItem?.sourceTier, 'official');
    assert.equal(officialItem?.confirmationLevel, 'official');
    assert.match(officialItem?.editorialReason || '', /官方来源|储备|交易所/);
    assert.equal(multiSourceItem?.sourceTier, 'major');
    assert.equal(multiSourceItem?.confirmationLevel, 'multi_source');
    assert.match(multiSourceItem?.editorialReason || '', /多家来源|ETF|监管/);
});

test('dedupeAndRankCandidates aggregates same event by entities and builds a timeline', () => {
    const result = dedupeAndRankCandidates('crypto', [
        candidate({
            category: 'crypto',
            title: 'Reuters: SEC delays Ethereum ETF staking decision',
            summary: 'The regulator delayed a decision on allowing staking in spot ETH ETF products.',
            source: 'Reuters',
            domain: 'reuters.com',
            url: 'https://www.reuters.com/technology/sec-eth-etf-staking-delay-2026-04-17/',
            publishedAt: '2026-04-17T10:00:00.000Z',
            tags: ['SEC', 'ETH', 'ETF'],
            rawSnippet: '',
        }),
        candidate({
            category: 'crypto',
            title: 'Bloomberg says SEC postpones decision on Ether fund staking',
            summary: 'A later report said the SEC pushed back the staking decision for spot ether ETFs.',
            source: 'Bloomberg',
            domain: 'bloomberg.com',
            url: 'https://www.bloomberg.com/news/articles/2026-04-17/sec-postpones-ether-fund-staking',
            publishedAt: '2026-04-17T10:30:00.000Z',
            tags: ['SEC', 'ETH', 'ETF'],
            rawSnippet: '',
        }),
        candidate({
            category: 'crypto',
            title: 'SEC filing confirms delay on Ethereum ETF staking proposal',
            summary: 'An SEC filing confirmed the agency delayed its decision on the Ethereum ETF staking proposal.',
            source: 'SEC',
            domain: 'sec.gov',
            url: 'https://www.sec.gov/files/eth-etf-staking-delay-2026-04-17.pdf',
            publishedAt: '2026-04-17T12:00:00.000Z',
            tags: ['SEC', 'ETH', 'ETF'],
            rawSnippet: '',
        }),
    ], WINDOW, 10);

    assert.equal(result.items.length, 1);
    const item = result.items[0];
    assert.equal(item.eventStatus, 'confirmed');
    assert.equal(item.earliestSource?.source, 'Reuters');
    assert.equal(item.latestSource?.source, 'SEC');
    assert.equal(item.officialSource?.source, 'SEC');
    assert.equal(item.timeline?.length, 3);
    assert.deepEqual(item.coreEntities?.sort(), ['ETF', 'ETH', 'SEC']);
});

test('dedupeAndRankCandidates marks single social rumors as single source and does not keep them', () => {
    const result = dedupeAndRankCandidates('crypto', [
        candidate({
            category: 'crypto',
            title: 'Influencer claims SEC may approve a tiny token ETF next week',
            summary: 'A single social media account speculated about an ETF approval without documents.',
            source: 'X',
            domain: 'x.com',
            url: 'https://x.com/random/status/123',
            publishedAt: '2026-04-17T16:00:00.000Z',
            tags: ['SEC', 'ETF', 'rumor'],
            rawSnippet: '',
        }),
    ], WINDOW, 10);

    assert.equal(result.items.length, 0);
    assert.equal(result.dropped.unimportant, 1);
});

test('dedupeAndRankCandidates enriches news with event context fields', () => {
    const result = dedupeAndRankCandidates('crypto', [
        candidate({
            category: 'crypto',
            title: 'SEC approves spot Ethereum ETF staking proposal as Bitcoin holds breakout',
            summary: 'The approval may improve ETH liquidity and shift institutional crypto risk appetite.',
            source: 'Reuters',
            domain: 'reuters.com',
            url: 'https://www.reuters.com/technology/sec-approves-ethereum-etf-staking-2026-04-17/',
            publishedAt: '2026-04-17T18:00:00.000Z',
            tags: ['SEC', 'ETF', 'ETH', 'BTC'],
            rawSnippet: '',
        }),
    ], WINDOW, 10);

    const item = result.items[0];
    assert.equal(item.subcategory, 'ETF');
    assert.deepEqual(item.affectedAssets, ['BTC', 'ETH']);
    assert.equal(item.impactDirection, 'risk_on');
    assert.equal(item.impactHorizon, '1-3d');
    assert.match(item.whyItMatters || '', /ETF|流动性|监管预期|行业叙事/);
    assert.ok((item.watchpoints || []).length >= 2);
});

test('scoreNewsCandidate rewards authoritative multi-source market-moving news', () => {
    const score = scoreNewsCandidate(candidate({
        category: 'crypto',
        title: 'SEC approves spot Solana ETF filings as Bitcoin risk appetite improves',
        summary: 'A US ETF approval would widen institutional access to major crypto assets and can shift market liquidity.',
        source: 'Reuters',
        domain: 'reuters.com',
        tags: ['SEC', 'ETF', 'SOL', 'BTC'],
    }), {
        category: 'crypto',
        windowEndMs: WINDOW.windowEndMs,
        sourceCount: 3,
    });

    assert.ok(score >= 80);
    assert.equal(toImportanceLevel(score), 'high');
    assert.equal(toImportanceLevel(62), 'medium');
    assert.equal(toImportanceLevel(42), 'low');
});

test('buildDailyNewsDigestFromResults survives one failed category', () => {
    const results: CategoryCollectionResult[] = [
        {
            category: 'macro',
            ok: false,
            error: 'GDELT timed out',
            candidates: [],
        },
        {
            category: 'ai',
            ok: true,
            candidates: [
                candidate({
                    category: 'ai',
                    title: 'NVIDIA launches next AI accelerator for hyperscale data centers',
                    summary: 'A new accelerator can reshape AI compute supply and capex expectations.',
                    source: 'NVIDIA',
                    domain: 'nvidia.com',
                    url: 'https://www.nvidia.com/en-us/data-center/new-ai-accelerator/',
                    tags: ['NVIDIA', 'chips'],
                }),
            ],
        },
        {
            category: 'crypto',
            ok: true,
            candidates: [],
        },
    ];

    const digest = buildDailyNewsDigestFromResults(results, WINDOW);

    assert.equal(digest.generatedAt, WINDOW.windowEnd);
    assert.equal(digest.macro.length, 0);
    assert.equal(digest.ai.length, 1);
    assert.equal(digest.categoryStatus.macro.status, 'failed');
    assert.equal(digest.categoryStatus.crypto.status, 'partial');
});

test('buildDailyNewsDigestFromResults creates an important signal brief from event context', () => {
    const digest = buildDailyNewsDigestFromResults([
        {
            category: 'macro',
            ok: true,
            candidates: [
                candidate({
                    title: 'US CPI inflation jumps as Treasury yields rise after tariff shock',
                    summary: 'Sticky inflation and higher Treasury yields can pressure risk assets.',
                    source: 'Reuters',
                    domain: 'reuters.com',
                    url: 'https://www.reuters.com/markets/us-cpi-inflation-treasury-yields-2026-04-17/',
                    publishedAt: '2026-04-17T20:00:00.000Z',
                    tags: ['CPI', 'inflation', 'Treasury'],
                    rawSnippet: '',
                }),
                candidate({
                    title: 'Oil rises as war risk renews inflation fears',
                    summary: 'War risk and oil prices can keep inflation expectations elevated.',
                    source: 'CNBC',
                    domain: 'cnbc.com',
                    url: 'https://www.cnbc.com/2026/04/17/oil-war-inflation-risk.html',
                    publishedAt: '2026-04-17T19:00:00.000Z',
                    tags: ['市场', '聚合', 'oil', 'war', 'inflation'],
                    rawSnippet: '',
                }),
            ],
        },
        {
            category: 'crypto',
            ok: true,
            candidates: [
                candidate({
                    category: 'crypto',
                    title: 'Bitcoin ETF inflows improve as BTC liquidity expands',
                    summary: 'ETF inflows can improve BTC market liquidity.',
                    source: 'CoinDesk',
                    domain: 'coindesk.com',
                    url: 'https://www.coindesk.com/markets/2026/04/17/bitcoin-etf-inflows/',
                    publishedAt: '2026-04-17T18:00:00.000Z',
                    tags: ['BTC', 'ETF'],
                    rawSnippet: '',
                }),
            ],
        },
        {
            category: 'ai',
            ok: true,
            candidates: [],
        },
    ], WINDOW);

    assert.equal(digest.brief?.riskBias, 'risk_off');
    assert.match(digest.brief?.headline || '', /过去 24 小时|大事/);
    assert.doesNotMatch(digest.brief?.headline || '', /风险偏好|多空|交易/);
    assert.ok(digest.brief?.driverTags.includes('通胀'));
    assert.equal(digest.brief?.driverTags.includes('聚合'), false);
    assert.ok((digest.brief?.affectedAssets || []).some((asset) => ['UST', 'Oil'].includes(asset)));
    assert.ok((digest.brief?.latestSignals || []).length >= 2);
});

test('buildDailyNewsDigestFromResults creates top stories sorted by importance without padding', () => {
    const digest = buildDailyNewsDigestFromResults([
        {
            category: 'crypto',
            ok: true,
            candidates: [
                candidate({
                    category: 'crypto',
                    title: 'Binance discloses major wallet security incident and withdrawal pause',
                    summary: 'Binance said it paused withdrawals after detecting a wallet infrastructure security incident.',
                    source: 'Binance',
                    domain: 'binance.com',
                    url: 'https://www.binance.com/en/support/announcement/wallet-security-incident-2026-04-17',
                    publishedAt: '2026-04-17T10:00:00.000Z',
                    tags: ['Binance', 'security', 'wallet'],
                    rawSnippet: '',
                }),
                candidate({
                    category: 'crypto',
                    title: 'SEC delays decision on spot Ethereum ETF staking proposal',
                    summary: 'The delay affects the structure of US spot ETH ETF products.',
                    source: 'Reuters',
                    domain: 'reuters.com',
                    url: 'https://www.reuters.com/technology/sec-delays-eth-staking-etf-2026-04-17/',
                    publishedAt: '2026-04-17T20:00:00.000Z',
                    tags: ['SEC', 'ETH', 'ETF'],
                    rawSnippet: '',
                }),
            ],
        },
        {
            category: 'macro',
            ok: true,
            candidates: [
                candidate({
                    category: 'macro',
                    title: 'Federal Reserve signals fewer rate cuts after hotter CPI inflation data',
                    summary: 'The Fed signal can reshape rate expectations and dollar liquidity conditions.',
                    source: 'Reuters',
                    domain: 'reuters.com',
                    url: 'https://www.reuters.com/markets/fed-cpi-rate-cuts-2026-04-17/',
                    publishedAt: '2026-04-17T21:00:00.000Z',
                    tags: ['Fed', 'CPI', 'rates'],
                    rawSnippet: '',
                }),
            ],
        },
        {
            category: 'ai',
            ok: true,
            candidates: [
                candidate({
                    category: 'ai',
                    title: 'Local AI startup announces small funding round for chatbot app',
                    summary: 'The startup raised a small seed round for a consumer chatbot.',
                    source: 'Example',
                    domain: 'example.com',
                    url: 'https://example.com/local-ai-startup-small-funding',
                    publishedAt: '2026-04-17T22:00:00.000Z',
                    tags: ['AI', 'funding'],
                    rawSnippet: '',
                }),
            ],
        },
    ], WINDOW);

    assert.equal(digest.topStories?.length, 3);
    assert.match(digest.topStories?.[0].headline || '', /Binance|wallet/i);
    assert.ok((digest.topStories?.[0].importanceScore || 0) >= (digest.topStories?.[1].importanceScore || 0));
    assert.equal(digest.ai.length, 0);
});

test('buildDailyNewsDigestFromResults does not pad top stories when fewer major events exist', () => {
    const digest = buildDailyNewsDigestFromResults([
        {
            category: 'crypto',
            ok: true,
            candidates: [
                candidate({
                    category: 'crypto',
                    title: 'SEC charges major crypto exchange over stablecoin reserve disclosures',
                    summary: 'The enforcement action can change compliance expectations for exchanges and stablecoin issuers.',
                    source: 'Reuters',
                    domain: 'reuters.com',
                    url: 'https://www.reuters.com/technology/sec-crypto-exchange-stablecoin-charges-2026-04-17/',
                    publishedAt: '2026-04-17T20:00:00.000Z',
                    tags: ['SEC', 'stablecoin', 'exchange'],
                    rawSnippet: '',
                }),
            ],
        },
        { category: 'macro', ok: true, candidates: [] },
        { category: 'ai', ok: true, candidates: [] },
    ], WINDOW);

    assert.equal(digest.topStories?.length, 1);
});

test('buildDailyNewsDigestFromResults excludes price-only stories from top stories without padding', () => {
    const digest = buildDailyNewsDigestFromResults([
        {
            category: 'crypto',
            ok: true,
            candidates: [
                candidate({
                    category: 'crypto',
                    title: 'Bitcoin crosses $81,000 as ETH and SOL rally to new high',
                    summary: 'The article only describes short-term price action across large crypto assets.',
                    source: 'CoinDesk',
                    domain: 'coindesk.com',
                    url: 'https://www.coindesk.com/markets/2026/04/17/bitcoin-crosses-81000-eth-sol-rally/',
                    publishedAt: '2026-04-17T18:00:00.000Z',
                    tags: ['BTC', 'ETH', 'SOL'],
                    rawSnippet: '',
                }),
                candidate({
                    category: 'crypto',
                    title: 'SEC rejects spot Bitcoin ETF rule change, BTC falls after decision',
                    summary: 'The regulator rejected a filing for a spot Bitcoin ETF rule change.',
                    source: 'Reuters',
                    domain: 'reuters.com',
                    url: 'https://www.reuters.com/technology/sec-rejects-bitcoin-etf-rule-change-2026-04-17/',
                    publishedAt: '2026-04-17T21:00:00.000Z',
                    tags: ['SEC', 'ETF', 'BTC'],
                    rawSnippet: '',
                }),
            ],
        },
        { category: 'macro', ok: true, candidates: [] },
        { category: 'ai', ok: true, candidates: [] },
    ], WINDOW);

    assert.equal(digest.crypto.length, 1);
    assert.equal(digest.topStories?.length, 1);
    assert.match(digest.topStories?.[0].headline || '', /SEC|ETF|监管/);
    assert.doesNotMatch(digest.topStories?.[0].headline || '', /crosses|rally|new high/i);
});

test('buildDailyNewsDigestFromResults keeps ETF flow context out of top stories when it is price framed', () => {
    const digest = buildDailyNewsDigestFromResults([
        {
            category: 'crypto',
            ok: true,
            candidates: [
                candidate({
                    category: 'crypto',
                    title: 'Bitcoin holds $80K as ETF flows drive the next move',
                    summary: 'The article frames ETF flows around BTC holding a price level without a new filing or regulatory action.',
                    source: 'Crypto Adventure',
                    domain: 'cryptoadventure.com',
                    url: 'https://example.com/bitcoin-holds-80k-etf-flows',
                    publishedAt: '2026-04-17T18:00:00.000Z',
                    tags: ['BTC', 'ETF'],
                    rawSnippet: '',
                }),
                candidate({
                    category: 'crypto',
                    title: 'BTC leads market as spot ETF inflows increase',
                    summary: 'The exchange recap frames spot ETF inflows as a market move without a new issuer filing or regulatory decision.',
                    source: 'MEXC Exchange',
                    domain: 'mexc.com',
                    url: 'https://example.com/btc-leads-market-spot-etf-inflows',
                    publishedAt: '2026-04-17T19:00:00.000Z',
                    tags: ['BTC', 'ETF'],
                    rawSnippet: '',
                }),
                candidate({
                    category: 'crypto',
                    title: 'SEC rejects spot Bitcoin ETF rule change, BTC falls after decision',
                    summary: 'The regulator rejected a filing for a spot Bitcoin ETF rule change.',
                    source: 'Reuters',
                    domain: 'reuters.com',
                    url: 'https://www.reuters.com/technology/sec-rejects-bitcoin-etf-rule-change-2026-04-17/',
                    publishedAt: '2026-04-17T21:00:00.000Z',
                    tags: ['SEC', 'ETF', 'BTC'],
                    rawSnippet: '',
                }),
            ],
        },
        { category: 'macro', ok: true, candidates: [] },
        { category: 'ai', ok: true, candidates: [] },
    ], WINDOW);

    assert.ok(digest.crypto.length >= 2);
    assert.equal(digest.topStories?.length, 1);
    assert.match(digest.topStories?.[0].headline || '', /SEC|ETF|监管/);
    assert.doesNotMatch([
        ...(digest.topStories || []).map((story) => story.headline),
        ...(digest.brief?.latestSignals || []),
    ].join('\n'), /holds \$80K|ETF flows drive|leads market|inflows|80K/i);
});

test('daily news items expose fixed summary sections', () => {
    const digest = buildDailyNewsDigestFromResults([
        {
            category: 'crypto',
            ok: true,
            candidates: [
                candidate({
                    category: 'crypto',
                    title: 'SEC approves spot Ethereum ETF staking proposal',
                    summary: 'The approval may reshape ETF product design and institutional access to ETH staking yield.',
                    source: 'Reuters',
                    domain: 'reuters.com',
                    url: 'https://www.reuters.com/technology/sec-approves-ethereum-etf-staking-2026-04-17/',
                    publishedAt: '2026-04-17T18:00:00.000Z',
                    tags: ['SEC', 'ETF', 'ETH'],
                    rawSnippet: '',
                }),
            ],
        },
        { category: 'macro', ok: true, candidates: [] },
        { category: 'ai', ok: true, candidates: [] },
    ], WINDOW);

    const item = digest.crypto[0];
    assert.ok(item.summarySections);
    assert.match(item.summarySections?.whatHappened || '', /发生|报道|宣布|确认|批准|延迟|披露|SEC/i);
    assert.match(item.summarySections?.whyImportant || '', /重要|影响|改变|监管|结构|基础设施|预期/);
    assert.match(item.summarySections?.whatToWatch || '', /后续|确认|文件|监管|官方|细节/);
    assert.match(item.summarySections?.sourceAndConfirmation || '', /来源|确认|单源|多源|官方|Reuters/);
});

test('daily news output uses simplified Chinese formal wording without banned promotional terms', () => {
    const digest = buildDailyNewsDigestFromResults([
        {
            category: 'crypto',
            ok: true,
            candidates: [
                candidate({
                    category: 'crypto',
                    title: 'SEC approves spot Ethereum ETF staking proposal',
                    summary: 'The approval may reshape ETF product design and institutional access to ETH staking yield.',
                    source: 'Reuters',
                    domain: 'reuters.com',
                    url: 'https://www.reuters.com/technology/sec-approves-ethereum-etf-staking-2026-04-17/',
                    publishedAt: '2026-04-17T18:00:00.000Z',
                    tags: ['SEC', 'ETF', 'ETH'],
                    rawSnippet: '',
                }),
            ],
        },
        { category: 'macro', ok: true, candidates: [] },
        { category: 'ai', ok: true, candidates: [] },
    ], WINDOW);

    const item = digest.crypto[0];
    const combined = [
        item.title,
        item.summary,
        item.summarySections?.whatHappened,
        item.summarySections?.whyImportant,
        item.summarySections?.whatToWatch,
        item.summarySections?.sourceAndConfirmation,
        digest.topStories?.[0].headline,
        ...(digest.brief?.latestSignals || []),
    ].join('\n');

    assert.match(combined, /[\u3400-\u9FFF]/);
    assert.doesNotMatch(combined, /SEC approves spot Ethereum ETF staking proposal|The approval may reshape/i);
    assert.doesNotMatch(combined, /暴涨|起飞|必买|利好|利空|看涨|看跌/);
    assert.match(item.summarySections?.whatHappened || '', /^发生了什么：/);
    assert.match(item.summarySections?.whyImportant || '', /^为什么重要：/);
    assert.match(item.summarySections?.whatToWatch || '', /^后续看什么：/);
    assert.match(item.summarySections?.sourceAndConfirmation || '', /^来源与确认度：/);
});

test('daily news Chinese normalization preserves concrete facts instead of empty templates', () => {
    const digest = buildDailyNewsDigestFromResults([
        {
            category: 'crypto',
            ok: true,
            candidates: [
                candidate({
                    category: 'crypto',
                    title: 'Western Union begins USDPT stablecoin rollout on Solana',
                    summary: 'Western Union started rolling out its USDPT stablecoin on Solana.',
                    source: 'Cointelegraph',
                    domain: 'cointelegraph.com',
                    url: 'https://cointelegraph.com/news/western-union-usdpt-stablecoin-solana',
                    publishedAt: '2026-04-17T18:00:00.000Z',
                    tags: ['stablecoin', 'SOL'],
                    rawSnippet: '',
                }),
                candidate({
                    category: 'crypto',
                    title: 'Ripple to share North Korean threat intelligence with crypto firms',
                    summary: 'Ripple plans to share threat intelligence tied to North Korean activity with crypto companies.',
                    source: 'CoinDesk',
                    domain: 'coindesk.com',
                    url: 'https://www.coindesk.com/tech/2026/04/17/ripple-threat-intelligence-north-korea/',
                    publishedAt: '2026-04-17T19:00:00.000Z',
                    tags: ['security'],
                    rawSnippet: '',
                }),
            ],
        },
        { category: 'macro', ok: true, candidates: [] },
        { category: 'ai', ok: true, candidates: [] },
    ], WINDOW);

    const titles = digest.crypto.map((item) => item.title).join('\n');
    assert.match(titles, /西联汇款|Western Union/);
    assert.match(titles, /USDPT/);
    assert.match(titles, /Solana/);
    assert.match(titles, /Ripple/);
    assert.match(titles, /朝鲜|North Korean/);
    assert.doesNotMatch(titles, /相关.*事项|披露新进展|启动推进/);
});

test('daily news Chinese normalization avoids glued entities and duplicate event wording', () => {
    const digest = buildDailyNewsDigestFromResults([
        {
            category: 'crypto',
            ok: true,
            candidates: [
                candidate({
                    category: 'crypto',
                    title: 'SEC rejects spot Bitcoin ETF rule change, BTC falls after decision',
                    summary: 'The regulator rejected a filing for a spot Bitcoin ETF rule change.',
                    source: 'Reuters',
                    domain: 'reuters.com',
                    url: 'https://www.reuters.com/technology/sec-rejects-bitcoin-etf-rule-change-2026-04-17/',
                    publishedAt: '2026-04-17T18:00:00.000Z',
                    tags: ['SEC', 'ETF', 'BTC'],
                    rawSnippet: '',
                }),
                candidate({
                    category: 'crypto',
                    title: 'Coinbase expands institutional custody reporting for Bitcoin funds',
                    summary: 'The update adds reporting details for institutional Bitcoin custody clients.',
                    source: 'CoinDesk',
                    domain: 'coindesk.com',
                    url: 'https://example.com/coinbase-institutional-custody-reporting',
                    publishedAt: '2026-04-17T19:00:00.000Z',
                    tags: ['crypto', 'exchange', 'custody', 'BTC'],
                    rawSnippet: '',
                }),
            ],
        },
        { category: 'macro', ok: true, candidates: [] },
        { category: 'ai', ok: true, candidates: [] },
    ], WINDOW);

    const combined = digest.crypto
        .flatMap((item) => [item.title, item.summarySections?.whyImportant || ''])
        .join('\n');

    assert.match(combined, /SEC 拒绝比特币现货 ETF 规则变更/);
    assert.match(combined, /Coinbase 扩展比特币基金机构托管报告/);
    assert.doesNotMatch(combined, /SECETF|ETFETF|安全事件事件|ETF事件|交易所事件/);
});

test('daily news Chinese normalization cleans html entities and avoids untranslated fallback headlines', () => {
    const digest = buildDailyNewsDigestFromResults([
        {
            category: 'macro',
            ok: true,
            candidates: [
                candidate({
                    category: 'macro',
                    title: "Jerome Powell making a &apos;significant mistake&apos; by staying on at the Fed, Sen. Tim Scott says",
                    summary: "Sen. Tim Scott said Jerome Powell made a &apos;significant mistake&apos; by staying on at the Federal Reserve.",
                    source: 'CNBC',
                    domain: 'cnbc.com',
                    url: 'https://www.cnbc.com/2026/04/17/powell-fed-tim-scott.html',
                    publishedAt: '2026-04-17T18:00:00.000Z',
                    tags: ['Fed', 'rates'],
                    rawSnippet: '',
                }),
                candidate({
                    category: 'macro',
                    title: "30-Year Treasury Yields Hit 5%: Trump's Interest Bill Top $1.2T",
                    summary: 'Thirty-year Treasury yields moved near 5%, renewing concern about US interest costs.',
                    source: 'MarketWatch',
                    domain: 'marketwatch.com',
                    url: 'https://www.marketwatch.com/story/treasury-yields-hit-5-percent',
                    publishedAt: '2026-04-17T19:00:00.000Z',
                    tags: ['Treasury', 'yields'],
                    rawSnippet: '',
                }),
                candidate({
                    category: 'macro',
                    title: 'Nasdaq, S&P 500 futures tumble as yields jump on inflation worries &#x2014; Reuters',
                    summary: 'US equity futures fell as Treasury yields jumped on renewed inflation worries.',
                    source: 'Reuters',
                    domain: 'reuters.com',
                    url: 'https://www.reuters.com/markets/us/futures-yields-inflation-worries-2026-04-17/',
                    publishedAt: '2026-04-17T20:00:00.000Z',
                    tags: ['Treasury', 'yields', 'inflation'],
                    rawSnippet: '',
                }),
            ],
        },
        { category: 'crypto', ok: true, candidates: [] },
        { category: 'ai', ok: true, candidates: [] },
    ], WINDOW);

    const combined = [
        ...digest.macro.map((item) => item.title),
        ...digest.macro.map((item) => item.summary),
        ...(digest.topStories || []).map((story) => story.headline),
        ...(digest.brief?.latestSignals || []),
    ].join('\n');
    const timelineText = digest.macro
        .flatMap((item) => item.timeline?.map((entry) => entry.title) || [])
        .join('\n');

    assert.doesNotMatch(combined, /&apos;|&#39;|&quot;|Jerome Powell making|30-Year Treasury Yields Hit/i);
    assert.doesNotMatch(combined, /&#x2014;|&#8217;|&[a-z]+;/i);
    assert.doesNotMatch(timelineText, /&#x2014;|&#8217;|&[a-z]+;/i);
    assert.match(combined, /30年期美债收益率升破 5%/);
    assert.match(combined, /美债收益率跳升压低纳指与标普期货/);
    assert.match(combined, /美联储|收益率|利率/);
});

test('daily news macro normalization preserves concrete policy and market facts', () => {
    const digest = buildDailyNewsDigestFromResults([
        {
            category: 'macro',
            ok: true,
            candidates: [
                candidate({
                    category: 'macro',
                    title: 'Federal Reserve signals fewer rate cuts after hotter CPI inflation data',
                    summary: 'The Fed signal can reshape rate expectations and dollar liquidity conditions.',
                    source: 'Reuters',
                    domain: 'reuters.com',
                    url: 'https://www.reuters.com/markets/fed-cpi-rate-cuts-2026-04-17/',
                    publishedAt: '2026-04-17T21:00:00.000Z',
                    tags: ['Fed', 'CPI', 'rates'],
                    rawSnippet: '',
                }),
                candidate({
                    category: 'macro',
                    title: "30-Year Treasury Yields Hit 5%: Trump's Interest Bill Top $1.2T",
                    summary: 'Thirty-year Treasury yields moved near 5%, renewing concern about US interest costs.',
                    source: 'MarketWatch',
                    domain: 'marketwatch.com',
                    url: 'https://www.marketwatch.com/story/treasury-yields-hit-5-percent',
                    publishedAt: '2026-04-17T19:00:00.000Z',
                    tags: ['Treasury', 'yields'],
                    rawSnippet: '',
                }),
            ],
        },
        { category: 'crypto', ok: true, candidates: [] },
        { category: 'ai', ok: true, candidates: [] },
    ], WINDOW);

    const combined = digest.macro
        .flatMap((item) => [
            item.title,
            item.summary,
            item.summarySections?.whatHappened || '',
            item.summarySections?.whyImportant || '',
            item.summarySections?.whatToWatch || '',
        ])
        .join('\n');

    assert.match(combined, /美联储|降息|CPI|通胀/);
    assert.match(combined, /美债收益率|5%|1\.2/);
    assert.match(combined, /利率期货|美元|黄金|美股期货|风险资产/);
    assert.doesNotMatch(combined, /受到关注|相关变化|产生影响|具体细节未公开|美债收益率变化|^央行$/m);
});

test('daily news macro normalization keeps specific yield market triggers in titles', () => {
    const digest = buildDailyNewsDigestFromResults([
        {
            category: 'macro',
            ok: true,
            candidates: [
                candidate({
                    category: 'macro',
                    title: 'Yields surge to May 2025 highs as oil prices and inflation data rattle markets',
                    summary: 'Treasury yields rose as oil and inflation data rattled markets.',
                    source: 'Reuters',
                    domain: 'reuters.com',
                    url: 'https://www.reuters.com/markets/yields-surge-may-2025-highs-2026-04-17/',
                    publishedAt: '2026-04-17T21:00:00.000Z',
                    tags: ['Treasury', 'yields', 'inflation'],
                    rawSnippet: '',
                }),
                candidate({
                    category: 'macro',
                    title: 'Global Bond Yields Jump, Dollar Firms on Middle East Stalemate',
                    summary: 'Global bond yields rose and the dollar firmed as Middle East talks stalled.',
                    source: 'WSJ',
                    domain: 'wsj.com',
                    url: 'https://www.wsj.com/markets/global-bond-yields-dollar-middle-east-2026-04-17/',
                    publishedAt: '2026-04-17T20:00:00.000Z',
                    tags: ['yields', 'dollar', 'oil'],
                    rawSnippet: '',
                }),
                candidate({
                    category: 'macro',
                    title: 'U.S. Futures, Global Markets Fall; Treasury Yields, Oil Rise',
                    summary: 'US futures and global markets fell while Treasury yields and oil rose.',
                    source: 'WSJ',
                    domain: 'wsj.com',
                    url: 'https://www.wsj.com/markets/us-futures-global-markets-yields-oil-2026-04-17/',
                    publishedAt: '2026-04-17T19:00:00.000Z',
                    tags: ['futures', 'yields', 'oil'],
                    rawSnippet: '',
                }),
                candidate({
                    category: 'macro',
                    title: 'Treasury yields surge as inflation data points to tricky rates path for new Fed chair Warsh',
                    summary: 'Inflation data pointed to a tricky policy path and pushed Treasury yields higher.',
                    source: 'CNBC',
                    domain: 'cnbc.com',
                    url: 'https://www.cnbc.com/2026/04/17/treasury-yields-fed-chair-warsh.html',
                    publishedAt: '2026-04-17T18:00:00.000Z',
                    tags: ['Fed', 'yields', 'inflation'],
                    rawSnippet: '',
                }),
            ],
        },
        { category: 'crypto', ok: true, candidates: [] },
        { category: 'ai', ok: true, candidates: [] },
    ], WINDOW);

    const titles = digest.macro.map((item) => item.title).join('\n');

    assert.match(titles, /美债收益率升至 2025年5月以来高位/);
    assert.match(titles, /中东僵局推高全球债券收益率，美元走强/);
    assert.match(titles, /美股期货和全球市场下跌，美债收益率与油价上行/);
    assert.match(titles, /通胀数据令美联储利率路径更棘手，美债收益率跳升/);
    assert.doesNotMatch(titles, /美债收益率变化|^央行$/m);
});

test('sanitizeDailyNewsDigest repairs persisted generic macro yield titles from source evidence', () => {
    const digest = buildDailyNewsDigestFromResults([
        {
            category: 'macro',
            ok: true,
            candidates: [
                candidate({
                    category: 'macro',
                    title: 'Yields surge to May 2025 highs as oil prices and inflation data rattle markets',
                    summary: 'Treasury yields rose as oil and inflation data rattled markets.',
                    source: 'Reuters',
                    domain: 'reuters.com',
                    url: 'https://www.reuters.com/markets/yields-surge-may-2025-highs-2026-04-17/',
                    publishedAt: '2026-04-17T21:00:00.000Z',
                    tags: ['Treasury', 'yields', 'inflation'],
                    rawSnippet: '',
                }),
            ],
        },
        { category: 'crypto', ok: true, candidates: [] },
        { category: 'ai', ok: true, candidates: [] },
    ], WINDOW);
    digest.macro[0] = {
        ...digest.macro[0],
        title: '美债收益率变化',
        summary: '报道称，美债收益率上行，会压缩风险资产估值空间。',
    };

    const sanitized = sanitizeDailyNewsDigest(digest);

    assert.equal(sanitized.macro[0]?.title, '美债收益率升至 2025年5月以来高位');
});

test('dedupeAndRankCandidates rejects macro category drift and crypto roundup bundles', () => {
    const macroResult = dedupeAndRankCandidates('macro', [
        candidate({
            category: 'macro',
            title: 'Bitcoin Shrugs Off CLARITY Gains as Institutions Sell Amid Surging Treasury Yields',
            summary: 'Bitcoin ETFs saw selling as Treasury yields rose.',
            source: 'Decrypt',
            domain: 'decrypt.co',
            url: 'https://decrypt.co/bitcoin-yields-etf-selling',
            publishedAt: '2026-04-17T18:00:00.000Z',
            tags: ['BTC', 'ETF', 'Treasury'],
            rawSnippet: '',
        }),
        candidate({
            category: 'macro',
            title: "Nvidia's trillion-dollar run puts pressure on the bulls",
            summary: 'The stock market story focused on Nvidia valuation and bulls.',
            source: 'CNBC',
            domain: 'cnbc.com',
            url: 'https://www.cnbc.com/2026/04/17/nvidia-trillion-dollar-run.html',
            publishedAt: '2026-04-17T17:00:00.000Z',
            tags: ['NVIDIA', 'stocks'],
            rawSnippet: '',
        }),
        candidate({
            category: 'macro',
            title: 'Yields surge to May 2025 highs as oil prices and inflation data rattle markets',
            summary: 'Treasury yields rose as oil and inflation data rattled markets.',
            source: 'Reuters',
            domain: 'reuters.com',
            url: 'https://www.reuters.com/markets/yields-surge-may-2025-highs-2026-04-17/',
            publishedAt: '2026-04-17T19:00:00.000Z',
            tags: ['Treasury', 'yields', 'inflation'],
            rawSnippet: '',
        }),
    ], WINDOW, 10);
    const cryptoResult = dedupeAndRankCandidates('crypto', [
        candidate({
            category: 'crypto',
            title: '星球午讯',
            summary: '1. 比特币现货 ETF 昨日总净流出； 2. Hyperliquid 领跑； 3. 多协议开始迁移。',
            source: 'Odaily 星球日报',
            domain: 'odaily.news',
            url: 'https://www.odaily.news/zh-CN/newsflash/noon',
            publishedAt: '2026-04-17T18:00:00.000Z',
            tags: ['BTC', 'ETF'],
            rawSnippet: '',
        }),
        candidate({
            category: 'crypto',
            title: 'Chainalysis traces THORChain attack source after cross-chain fund movements',
            summary: 'Chainalysis said wallets moved funds across chains before a THORChain attack.',
            source: 'Odaily 星球日报',
            domain: 'odaily.news',
            url: 'https://www.odaily.news/zh-CN/newsflash/thorchain-attack',
            publishedAt: '2026-04-17T19:00:00.000Z',
            tags: ['THORChain', 'hack'],
            rawSnippet: '',
        }),
    ], WINDOW, 10);

    assert.equal(macroResult.items.length, 1);
    assert.match(macroResult.items[0]?.title || '', /Yields surge to May 2025 highs/);
    assert.doesNotMatch(macroResult.items.map((item) => item.title).join('\n'), /Bitcoin|Nvidia|比特币承压|英伟达/);
    assert.equal(cryptoResult.items.length, 1);
    assert.match(cryptoResult.items[0]?.title || '', /THORChain|攻击/i);
    assert.doesNotMatch(cryptoResult.items.map((item) => item.title).join('\n'), /星球午讯/);
});

test('dedupeAndRankCandidates rejects macro previews politics and opinion without tradeable event evidence', () => {
    const result = dedupeAndRankCandidates('macro', [
        candidate({
            category: 'macro',
            title: 'Pirro changes course in Fed investigation, move unlikely to satisfy Powell',
            summary: 'The article focuses on a political investigation rather than a policy decision or macro data release.',
            source: 'CNBC',
            domain: 'cnbc.com',
            url: 'https://www.cnbc.com/2026/04/17/pirro-fed-investigation-powell.html',
            publishedAt: '2026-04-17T16:00:00.000Z',
            tags: ['Fed'],
            rawSnippet: '',
        }),
        candidate({
            category: 'macro',
            title: 'CPI Shock Incoming May 12: Trump vs Powell Drama Fuel Market',
            summary: 'The article previews a future CPI event with political drama framing but no released data.',
            source: 'Coin Gabbar',
            domain: 'coingabbar.com',
            url: 'https://www.coingabbar.com/en/crypto-currency-news/cpi-shock-incoming-may-12',
            publishedAt: '2026-04-17T17:00:00.000Z',
            tags: ['CPI', 'Fed'],
            rawSnippet: '',
        }),
        candidate({
            category: 'macro',
            title: 'Federal Reserve holds rates steady as Powell says inflation remains sticky',
            summary: 'The Fed held rates steady and Powell said sticky inflation keeps policy restrictive.',
            source: 'Reuters',
            domain: 'reuters.com',
            url: 'https://www.reuters.com/markets/us/fed-holds-rates-inflation-2026-04-17/',
            publishedAt: '2026-04-17T18:00:00.000Z',
            tags: ['Fed', 'rates', 'inflation'],
            rawSnippet: '',
        }),
    ], WINDOW, 10);

    const titles = result.items.map((item) => item.title).join('\n');
    assert.equal(result.items.length, 1);
    assert.match(titles, /美联储|利率|通胀|Fed/i);
    assert.doesNotMatch(titles, /Pirro|investigation|CPI Shock|Drama/i);
    assert.equal(result.dropped.unimportant, 2);
});

test('dedupeAndRankCandidates rejects research opinion pieces that only borrow crypto and AI keywords', () => {
    const cryptoResult = dedupeAndRankCandidates('crypto', [
        candidate({
            category: 'crypto',
            title: 'Bitwise CEO：法币货币体系“已死”',
            summary: 'Bitwise CEO expressed an opinion about fiat currency and Bitcoin without a filing, product launch or regulatory event.',
            source: 'Odaily 星球日报',
            domain: 'odaily.news',
            url: 'https://www.odaily.news/zh-CN/newsflash/bitwise-ceo-fiat-dead',
            publishedAt: '2026-04-17T16:00:00.000Z',
            tags: ['BTC'],
            rawSnippet: '',
        }),
        candidate({
            category: 'crypto',
            title: 'Tiger Research：AI 智能体也要查身份证了',
            summary: 'The research article discusses KYA standards and identity verification but cites no new official rule or product launch.',
            source: 'Odaily 星球日报',
            domain: 'odaily.news',
            url: 'https://www.odaily.news/zh-CN/post/kya-ai-agent-identity',
            publishedAt: '2026-04-17T17:00:00.000Z',
            tags: ['USDT', 'USDC', 'OpenAI', 'stablecoin'],
            rawSnippet: '',
        }),
        candidate({
            category: 'crypto',
            title: 'SEC charges major crypto exchange over stablecoin reserve disclosures',
            summary: 'The enforcement action can change compliance expectations for exchanges and stablecoin issuers.',
            source: 'Reuters',
            domain: 'reuters.com',
            url: 'https://www.reuters.com/technology/sec-crypto-exchange-stablecoin-charges-2026-04-17/',
            publishedAt: '2026-04-17T18:00:00.000Z',
            tags: ['SEC', 'stablecoin', 'exchange'],
            rawSnippet: '',
        }),
    ], WINDOW, 10);

    const aiResult = dedupeAndRankCandidates('ai', [
        candidate({
            category: 'ai',
            title: 'AI researchers explain why agent identity will matter for stablecoin payments',
            summary: 'A research commentary discusses future agent payments without a new model, rule, launch or financing event.',
            source: 'Example Research',
            domain: 'example.com',
            url: 'https://example.com/ai-agent-identity-explainer',
            publishedAt: '2026-04-17T16:00:00.000Z',
            tags: ['AI', 'agent'],
            rawSnippet: '',
        }),
        candidate({
            category: 'ai',
            title: 'OpenAI releases new reasoning model for enterprise developers',
            summary: 'OpenAI released a new reasoning model that changes enterprise developer platform competition.',
            source: 'OpenAI',
            domain: 'openai.com',
            url: 'https://openai.com/index/new-reasoning-model-2026-04-17/',
            publishedAt: '2026-04-17T18:00:00.000Z',
            tags: ['OpenAI', 'model'],
            rawSnippet: '',
        }),
    ], WINDOW, 10);

    assert.equal(cryptoResult.items.length, 1);
    assert.match(cryptoResult.items[0]?.title || '', /SEC|稳定币|交易所|监管/);
    assert.doesNotMatch(cryptoResult.items.map((item) => item.title).join('\n'), /Bitwise|Tiger Research|已死|身份证/);
    assert.equal(cryptoResult.dropped.unimportant, 2);

    assert.equal(aiResult.items.length, 1);
    assert.match(aiResult.items[0]?.title || '', /OpenAI|模型|reasoning/i);
    assert.doesNotMatch(aiResult.items.map((item) => item.title).join('\n'), /explain|identity will matter/i);
});

test('sanitizeDailyNewsDigest keeps concrete AI model chip and legal events', () => {
    const digest = buildDailyNewsDigestFromResults([
        { category: 'macro', ok: true, candidates: [] },
        { category: 'crypto', ok: true, candidates: [] },
        {
            category: 'ai',
            ok: true,
            candidates: [
                candidate({
                    category: 'ai',
                    title: 'OpenAI explores legal options against Apple, source says',
                    summary: 'The potential legal action reflects pressure around AI platform distribution.',
                    source: 'Reuters',
                    domain: 'reuters.com',
                    url: 'https://www.reuters.com/technology/openai-apple-legal-options-2026-04-17/',
                    publishedAt: '2026-04-17T18:00:00.000Z',
                    tags: ['OpenAI', 'legal action'],
                    rawSnippet: '',
                }),
                candidate({
                    category: 'ai',
                    title: 'Anthropic urges tough chip controls as Nvidia CEO joins Trump in China',
                    summary: 'Anthropic called for tighter chip restrictions while H200 export policy remains in focus.',
                    source: 'The Information',
                    domain: 'theinformation.com',
                    url: 'https://www.theinformation.com/briefings/anthropic-chip-controls-china',
                    publishedAt: '2026-04-17T17:00:00.000Z',
                    tags: ['Anthropic', 'NVIDIA', 'chips'],
                    rawSnippet: '',
                }),
                candidate({
                    category: 'ai',
                    title: 'PwC is deploying Claude to build technology and execute deals for clients',
                    summary: 'Anthropic said PwC is deploying Claude across enterprise technology and deal workflows.',
                    source: 'Anthropic',
                    domain: 'anthropic.com',
                    url: 'https://www.anthropic.com/news/pwc-deploying-claude',
                    publishedAt: '2026-04-17T16:00:00.000Z',
                    tags: ['Anthropic', 'Claude', 'enterprise'],
                    rawSnippet: '',
                }),
            ],
        },
    ], WINDOW);

    const sanitized = sanitizeDailyNewsDigest(digest);
    const titles = sanitized.ai.map((item) => item.title).join('\n');

    assert.equal(sanitized.ai.length, 3);
    assert.match(titles, /OpenAI.*Apple.*法律行动/);
    assert.match(titles, /Anthropic.*芯片出口限制/);
    assert.match(titles, /PwC.*Claude.*企业落地/);
    assert.doesNotMatch(titles, /出现新进展|^模型$/m);
});

test('daily news Chinese normalization avoids duplicated ETF wording in generic crypto fallbacks', () => {
    const digest = buildDailyNewsDigestFromResults([
        {
            category: 'crypto',
            ok: true,
            candidates: [
                candidate({
                    category: 'crypto',
                    title: 'Bitcoin ETF launch window opens after exchange filing update',
                    summary: 'An exchange filing update opened a new launch window for a Bitcoin ETF product.',
                    source: 'CoinDesk',
                    domain: 'coindesk.com',
                    url: 'https://www.coindesk.com/markets/2026/04/17/bitcoin-etf-launch-window',
                    publishedAt: '2026-04-17T18:00:00.000Z',
                    tags: ['ETF', 'BTC'],
                    rawSnippet: '',
                }),
            ],
        },
        { category: 'macro', ok: true, candidates: [] },
        { category: 'ai', ok: true, candidates: [] },
    ], WINDOW);

    const combined = [
        digest.crypto[0]?.title,
        digest.crypto[0]?.summary,
        digest.crypto[0]?.summarySections?.whatHappened,
        digest.topStories?.[0]?.headline,
    ].join('\n');

    assert.match(combined, /比特币现货 ETF|比特币 ETF/);
    assert.doesNotMatch(combined, /ETFETF|ETF进展开始落地|比特币、ETF/);
});

test('daily news Chinese normalization compacts long Chinese media summaries', () => {
    const longSummary = '原创 | Odaily 星球日报 作者 | Asher。Kalshi 宣布完成新一轮 10 亿美元融资，投后估值达到 220 亿美元。预测市场正在从边缘化事件交易工具进入主流金融机构视野。'.repeat(20);
    const digest = buildDailyNewsDigestFromResults([
        {
            category: 'crypto',
            ok: true,
            candidates: [
                candidate({
                    category: 'crypto',
                    title: 'Circle 更新 USDC 储备证明流程，银行合作方审计要求提高',
                    summary: longSummary,
                    source: 'Odaily 星球日报',
                    domain: 'odaily.news',
                    url: 'https://www.odaily.news/zh-CN/post/usdc-reserve-attestation',
                    publishedAt: '2026-04-17T18:00:00.000Z',
                    tags: ['USDC', 'stablecoin', 'reserve'],
                    rawSnippet: '',
                }),
            ],
        },
        { category: 'macro', ok: true, candidates: [] },
        { category: 'ai', ok: true, candidates: [] },
    ], WINDOW);

    const item = digest.crypto[0];
    assert.ok((item.summary || '').length < 260);
    assert.ok((item.summarySections?.whatHappened || '').length < 280);
    assert.doesNotMatch(item.summary || '', /原创 |作者/);
});

test('dedupeAndRankCandidates filters crypto-adjacent GameStop eBay media noise', () => {
    const result = dedupeAndRankCandidates('crypto', [
        candidate({
            category: 'crypto',
            title: 'GameStop CEO卖袜子买eBay：一场560亿美元的行为艺术',
            summary: '文章讨论 GameStop CEO Ryan Cohen 对 eBay 的收购表演，只有边缘比特币财库背景。',
            source: 'Odaily 星球日报',
            domain: 'odaily.news',
            url: 'https://www.odaily.news/zh-CN/post/5210649',
            publishedAt: '2026-04-17T18:00:00.000Z',
            tags: ['加密'],
            rawSnippet: '',
        }),
        candidate({
            category: 'crypto',
            title: 'SEC delays decision on spot Ethereum ETF staking proposal',
            summary: 'The delay affects the structure of US spot ETH ETF products.',
            source: 'Reuters',
            domain: 'reuters.com',
            url: 'https://www.reuters.com/technology/sec-delays-eth-staking-etf-2026-04-17/',
            publishedAt: '2026-04-17T19:00:00.000Z',
            tags: ['SEC', 'ETH', 'ETF'],
            rawSnippet: '',
        }),
    ], WINDOW, 10);

    assert.equal(result.items.length, 1);
    assert.match(result.items[0]?.title || '', /SEC|以太坊|ETF/);
    assert.doesNotMatch(result.items.map((item) => item.title).join('\n'), /GameStop|eBay|卖袜子/);
});

test('dedupeAndRankCandidates filters Chinese stock commentary and roundup recaps from crypto news', () => {
    const result = dedupeAndRankCandidates('crypto', [
        candidate({
            category: 'crypto',
            title: '2026 年的美股，赚得我有点心慌',
            summary: '文章讨论美股存储股、股票账户收益和投资者情绪，缺少加密市场结构事实。',
            source: 'Odaily 星球日报',
            domain: 'odaily.news',
            url: 'https://www.odaily.news/zh-CN/post/us-stocks-2026',
            publishedAt: '2026-04-17T18:00:00.000Z',
            tags: ['加密'],
            rawSnippet: '',
        }),
        candidate({
            category: 'crypto',
            title: '24H 热门币种与要闻｜美伊发生交火，停火并未结束',
            summary: 'CEX 热门币种 CEX 成交额 Top 10 及 24 小时涨跌幅，24 小时涨幅榜单和市场快讯合集。',
            source: 'Odaily 星球日报',
            domain: 'odaily.news',
            url: 'https://www.odaily.news/zh-CN/post/market-recap',
            publishedAt: '2026-04-17T18:30:00.000Z',
            tags: ['加密'],
            rawSnippet: '',
        }),
        candidate({
            category: 'crypto',
            title: 'Coinbase交易所宕机超2小时',
            summary: 'Coinbase 交易所发生宕机，用户交易和提现短时受影响。',
            source: 'Odaily 星球日报',
            domain: 'odaily.news',
            url: 'https://www.odaily.news/zh-CN/newsflash/coinbase-outage',
            publishedAt: '2026-04-17T19:00:00.000Z',
            tags: ['Coinbase', 'exchange'],
            rawSnippet: '',
        }),
    ], WINDOW, 10);

    assert.equal(result.items.length, 1);
    assert.match(result.items[0]?.title || '', /Coinbase|宕机/);
    assert.ok((result.items[0]?.importanceScore || 0) >= 58);
    assert.equal(result.items[0]?.sourceTier, 'specialist');
    assert.equal(result.items[0]?.confirmationLevel, 'single_authoritative');
});

test('dedupeAndRankCandidates filters Chinese price reaction news while keeping exchange incidents', () => {
    const result = dedupeAndRankCandidates('crypto', [
        candidate({
            category: 'crypto',
            title: 'Binance 将上线 PROSUSDT 永续合约，PROS 短时涨超 70%',
            summary: '行情显示，受 Binance 将上线 PROSUSDT 永续合约影响，PROS 短时涨超 70%。',
            source: 'Odaily 星球日报',
            domain: 'odaily.news',
            url: 'https://www.odaily.news/zh-CN/newsflash/pros-price-surge',
            publishedAt: '2026-04-17T18:00:00.000Z',
            tags: ['PROS', 'Binance', 'USDT'],
            rawSnippet: '',
        }),
        candidate({
            category: 'crypto',
            title: 'Coinbase交易所宕机超2小时',
            summary: 'Coinbase 交易所发生宕机，用户交易和提现短时受影响。',
            source: 'Odaily 星球日报',
            domain: 'odaily.news',
            url: 'https://www.odaily.news/zh-CN/newsflash/coinbase-outage',
            publishedAt: '2026-04-17T19:00:00.000Z',
            tags: ['Coinbase', 'exchange'],
            rawSnippet: '',
        }),
    ], WINDOW, 10);

    const titles = result.items.map((item) => item.title).join('\n');
    assert.doesNotMatch(titles, /PROS|短时涨超/);
    assert.match(titles, /Coinbase|宕机/);
});

test('daily news Chinese normalization hard caps long first-sentence recaps', () => {
    const longSummary = `CEX 热门币种 CEX 成交额 Top 10 及 24 小时涨跌幅：${' BTC: -1.55% ETH: -1.7% SOL: -0.02%'.repeat(40)}。后续还有市场要闻。`;
    const digest = buildDailyNewsDigestFromResults([
        {
            category: 'crypto',
            ok: true,
            candidates: [
                candidate({
                    category: 'crypto',
                    title: 'Circle 更新 USDC 储备证明流程，银行合作方审计要求提高',
                    summary: longSummary,
                    source: 'Odaily 星球日报',
                    domain: 'odaily.news',
                    url: 'https://www.odaily.news/zh-CN/post/usdc-reserve-long-summary',
                    publishedAt: '2026-04-17T18:00:00.000Z',
                    tags: ['USDC', 'stablecoin', 'reserve'],
                    rawSnippet: '',
                }),
            ],
        },
        { category: 'macro', ok: true, candidates: [] },
        { category: 'ai', ok: true, candidates: [] },
    ], WINDOW);

    assert.ok((digest.crypto[0]?.summary || '').length < 260);
});

test('daily news Chinese normalization does not translate shares slide as sharing', () => {
    const digest = buildDailyNewsDigestFromResults([
        {
            category: 'crypto',
            ok: true,
            candidates: [
                candidate({
                    category: 'crypto',
                    title: 'Coinbase shares slide on $400M Q1 loss, revenue miss',
                    summary: 'Coinbase shares slid after the exchange reported a Q1 loss and missed revenue estimates.',
                    source: 'Cointelegraph',
                    domain: 'cointelegraph.com',
                    url: 'https://cointelegraph.com/news/coinbase-shares-slide-q1-loss-revenue-miss',
                    publishedAt: '2026-04-17T18:00:00.000Z',
                    tags: ['Coinbase', 'exchange'],
                    rawSnippet: '',
                }),
            ],
        },
        { category: 'macro', ok: true, candidates: [] },
        { category: 'ai', ok: true, candidates: [] },
    ], WINDOW);

    const combined = [digest.crypto[0]?.title, digest.crypto[0]?.summary].join('\n');
    assert.match(combined, /Coinbase 股价|财报|营收/);
    assert.doesNotMatch(combined, /共享交易所|将共享/);
});

test('daily news Chinese normalization does not translate stock shares as sharing', () => {
    const digest = buildDailyNewsDigestFromResults([
        {
            category: 'ai',
            ok: true,
            candidates: [
                candidate({
                    category: 'ai',
                    title: 'IREN stock surges as Nvidia backs AI expansion with warrants tied to 30 million shares',
                    summary: 'Nvidia-backed warrants are tied to 30 million shares as IREN expands AI infrastructure.',
                    source: '6551News',
                    domain: 'ai.6551.io',
                    url: 'https://ai.6551.io/news/iren-nvidia-ai-expansion',
                    publishedAt: '2026-04-17T18:00:00.000Z',
                    tags: ['NVIDIA', 'AI'],
                    rawSnippet: '',
                }),
            ],
        },
        { category: 'macro', ok: true, candidates: [] },
        { category: 'crypto', ok: true, candidates: [] },
    ], WINDOW);

    const combined = [digest.ai[0]?.title, digest.ai[0]?.summary].join('\n');
    assert.match(combined, /Nvidia|AI|芯片/);
    assert.doesNotMatch(combined, /将共享|共享芯片/);
});

test('dedupeAndRankCandidates keeps a richer set of non-noise category items', () => {
    const result = dedupeAndRankCandidates('crypto', [
        candidate({
            category: 'crypto',
            title: 'Coinbase expands institutional custody reporting for Bitcoin funds',
            summary: 'The update adds reporting details for institutional Bitcoin custody clients.',
            source: 'CoinDesk',
            domain: 'coindesk.com',
            url: 'https://example.com/coinbase-institutional-custody-reporting',
            publishedAt: '2026-04-17T10:00:00.000Z',
            tags: ['crypto', 'exchange', 'custody', 'BTC'],
            rawSnippet: '',
        }),
        candidate({
            category: 'crypto',
            title: 'Kraken adds proof-of-reserve disclosures for institutional accounts',
            summary: 'The exchange published additional reserve disclosures for large accounts.',
            source: 'Cointelegraph',
            domain: 'cointelegraph.com',
            url: 'https://example.com/kraken-proof-of-reserve-institutional',
            publishedAt: '2026-04-17T11:00:00.000Z',
            tags: ['crypto', 'exchange', 'reserve'],
            rawSnippet: '',
        }),
        candidate({
            category: 'crypto',
            title: 'Circle updates USDC reserve attestation process for banks',
            summary: 'Circle described changes to its reserve attestation process for banking partners.',
            source: 'The Block',
            domain: 'theblock.co',
            url: 'https://example.com/circle-usdc-reserve-attestation-banks',
            publishedAt: '2026-04-17T12:00:00.000Z',
            tags: ['stablecoin', 'USDC', 'reserve'],
            rawSnippet: '',
        }),
        candidate({
            category: 'crypto',
            title: 'Tether publishes new USDT reserve disclosure for token holders',
            summary: 'Tether released a reserve disclosure covering assets backing USDT.',
            source: 'CoinDesk',
            domain: 'coindesk.com',
            url: 'https://example.com/tether-usdt-reserve-disclosure',
            publishedAt: '2026-04-17T13:00:00.000Z',
            tags: ['stablecoin', 'USDT', 'reserve'],
            rawSnippet: '',
        }),
        candidate({
            category: 'crypto',
            title: 'Solana validators prepare network upgrade after outage review',
            summary: 'Validators prepared a network upgrade following a review of outage conditions.',
            source: 'Decrypt',
            domain: 'decrypt.co',
            url: 'https://example.com/solana-network-upgrade-outage-review',
            publishedAt: '2026-04-17T14:00:00.000Z',
            tags: ['SOL', 'upgrade', 'outage'],
            rawSnippet: '',
        }),
        candidate({
            category: 'crypto',
            title: 'Binance updates withdrawal controls after wallet security review',
            summary: 'The exchange changed withdrawal controls after a wallet security review.',
            source: 'Cointelegraph',
            domain: 'cointelegraph.com',
            url: 'https://example.com/binance-withdrawal-controls-wallet-security',
            publishedAt: '2026-04-17T15:00:00.000Z',
            tags: ['exchange', 'wallet security', 'Binance'],
            rawSnippet: '',
        }),
        candidate({
            category: 'crypto',
            title: 'Ethereum client teams schedule upgrade coordination call',
            summary: 'Client teams scheduled a coordination call for the next network upgrade.',
            source: 'The Block',
            domain: 'theblock.co',
            url: 'https://example.com/ethereum-client-teams-upgrade-call',
            publishedAt: '2026-04-17T16:00:00.000Z',
            tags: ['ETH', 'upgrade'],
            rawSnippet: '',
        }),
        candidate({
            category: 'crypto',
            title: 'CFTC opens comment period on crypto derivatives custody rules',
            summary: 'The agency opened a comment period on custody rules for crypto derivatives.',
            source: 'Reuters',
            domain: 'reuters.com',
            url: 'https://example.com/cftc-crypto-derivatives-custody-rules',
            publishedAt: '2026-04-17T17:00:00.000Z',
            tags: ['CFTC', 'custody', 'regulation'],
            rawSnippet: '',
        }),
        candidate({
            category: 'crypto',
            title: 'Token presale price prediction says best crypto to buy now',
            summary: 'The marketing post promotes a token sale and moonshot claim.',
            source: 'Example',
            domain: 'example.com',
            url: 'https://example.com/token-presale-price-prediction',
            publishedAt: '2026-04-17T20:00:00.000Z',
            tags: ['token'],
            rawSnippet: '',
        }),
    ], WINDOW, 10);

    assert.equal(result.items.length, 8);
    assert.equal(result.dropped.unimportant, 1);
});

test('dedupeAndRankCandidates removes low-information crypto market recaps while backfilling richer items', () => {
    const result = dedupeAndRankCandidates('crypto', [
        candidate({
            category: 'crypto',
            title: 'Bitcoin ETF inflows hit $532 million as BTC recovers above $80K',
            summary: 'The article recaps ETF inflows and BTC price recovery without a new policy fact.',
            source: 'Cointelegraph',
            domain: 'cointelegraph.com',
            url: 'https://example.com/bitcoin-etf-inflows-btc-recovers',
            publishedAt: '2026-04-17T10:00:00.000Z',
            tags: ['BTC', 'ETF'],
            rawSnippet: '',
        }),
        candidate({
            category: 'crypto',
            title: 'Bitcoin ETFs pull in $532M as BTC reclaims $80K amid post-ceasefire recovery',
            summary: 'The article recaps ETF demand and BTC reclaiming a price level.',
            source: 'Cointelegraph',
            domain: 'cointelegraph.com',
            url: 'https://example.com/bitcoin-etfs-pull-in-532m',
            publishedAt: '2026-04-17T10:30:00.000Z',
            tags: ['BTC', 'ETF'],
            rawSnippet: '',
        }),
        candidate({
            category: 'crypto',
            title: 'Bitcoin used to hate inflation. Now the opposite may be true',
            summary: 'A market commentary links BTC price behavior to inflation expectations.',
            source: 'CoinDesk',
            domain: 'coindesk.com',
            url: 'https://example.com/bitcoin-inflation-commentary',
            publishedAt: '2026-04-17T11:00:00.000Z',
            tags: ['BTC', 'inflation'],
            rawSnippet: '',
        }),
        candidate({
            category: 'crypto',
            title: 'Western Union begins USDPT stablecoin rollout on Solana',
            summary: 'Western Union started rolling out its USDPT stablecoin on Solana.',
            source: 'Cointelegraph',
            domain: 'cointelegraph.com',
            url: 'https://cointelegraph.com/news/western-union-usdpt-stablecoin-solana',
            publishedAt: '2026-04-17T12:00:00.000Z',
            tags: ['stablecoin', 'SOL'],
            rawSnippet: '',
        }),
        candidate({
            category: 'crypto',
            title: 'Ripple to share North Korean threat intelligence with crypto firms',
            summary: 'Ripple plans to share threat intelligence tied to North Korean activity with crypto companies.',
            source: 'CoinDesk',
            domain: 'coindesk.com',
            url: 'https://www.coindesk.com/tech/2026/04/17/ripple-threat-intelligence-north-korea/',
            publishedAt: '2026-04-17T13:00:00.000Z',
            tags: ['security'],
            rawSnippet: '',
        }),
    ], WINDOW, 10);

    const titles = result.items.map((item) => item.title).join('\n');
    assert.equal(result.items.length, 2);
    assert.match(titles, /Western Union|Ripple/i);
    assert.doesNotMatch(titles, /ETF inflows|pull in|hate inflation|above \$80K|reclaims/i);
});

test('dedupeAndRankCandidates filters advice explainers and crypto-adjacent business noise', () => {
    const result = dedupeAndRankCandidates('crypto', [
        candidate({
            category: 'crypto',
            title: 'Elon Musk settles SEC Twitter case with $1.5M fine',
            summary: 'The case concerns a Twitter disclosure dispute and does not add a crypto market structure fact.',
            source: 'crypto.news',
            domain: 'crypto.news',
            url: 'https://example.com/elon-musk-sec-twitter-case',
            publishedAt: '2026-04-17T10:00:00.000Z',
            tags: ['SEC'],
            rawSnippet: '',
        }),
        candidate({
            category: 'crypto',
            title: 'GameStop eBay takeover bid puts its bitcoin stash in the crosshairs',
            summary: 'The article frames a retail merger around a company bitcoin treasury.',
            source: 'crypto.news',
            domain: 'crypto.news',
            url: 'https://example.com/gamestop-ebay-bitcoin-stash',
            publishedAt: '2026-04-17T11:00:00.000Z',
            tags: ['BTC'],
            rawSnippet: '',
        }),
        candidate({
            category: 'crypto',
            title: 'SEC rejects spot Bitcoin ETF rule change, BTC falls after decision',
            summary: 'The regulator rejected a filing for a spot Bitcoin ETF rule change.',
            source: 'Reuters',
            domain: 'reuters.com',
            url: 'https://www.reuters.com/technology/sec-rejects-bitcoin-etf-rule-change-2026-04-17/',
            publishedAt: '2026-04-17T12:00:00.000Z',
            tags: ['SEC', 'ETF', 'BTC'],
            rawSnippet: '',
        }),
    ], WINDOW, 10);

    assert.equal(result.items.length, 1);
    assert.match(result.items[0].title, /SEC rejects/i);
});

test('dedupeAndRankCandidates filters AI consumer device rumors', () => {
    const result = dedupeAndRankCandidates('ai', [
        candidate({
            category: 'ai',
            title: 'OpenAI may launch AI phone in 2027',
            summary: 'A report says OpenAI may launch a consumer AI phone in 2027.',
            source: 'MacRumors',
            domain: 'macrumors.com',
            url: 'https://example.com/openai-ai-phone-2027',
            publishedAt: '2026-04-17T10:00:00.000Z',
            tags: ['OpenAI'],
            rawSnippet: '',
        }),
        candidate({
            category: 'ai',
            title: 'NVIDIA launches new AI accelerator for hyperscale data centers',
            summary: 'The chip launch changes compute supply for large model training.',
            source: 'NVIDIA',
            domain: 'nvidia.com',
            url: 'https://www.nvidia.com/en-us/data-center/new-ai-accelerator/',
            publishedAt: '2026-04-17T11:00:00.000Z',
            tags: ['NVIDIA', 'chip'],
            rawSnippet: '',
        }),
    ], WINDOW, 10);

    assert.equal(result.items.length, 1);
    assert.match(result.items[0].title, /NVIDIA/i);
});

test('dedupeAndRankCandidates filters low-value AI personnel and routine partnership news', () => {
    const result = dedupeAndRankCandidates('ai', [
        candidate({
            category: 'ai',
            title: 'Former Pentagon think tank head joins Anthropic',
            summary: 'The appointment does not describe a model, chip, infrastructure or regulatory change.',
            source: 'Example',
            domain: 'example.com',
            url: 'https://example.com/former-pentagon-head-joins-anthropic',
            publishedAt: '2026-04-17T10:00:00.000Z',
            tags: ['Anthropic'],
            rawSnippet: '',
        }),
        candidate({
            category: 'ai',
            title: 'FIS partners to bring agentic AI to banking with Anthropic',
            summary: 'A routine commercial partnership announcement for banking software.',
            source: 'Example',
            domain: 'example.com',
            url: 'https://example.com/fis-anthropic-agentic-ai-banking',
            publishedAt: '2026-04-17T11:00:00.000Z',
            tags: ['Anthropic', 'AI'],
            rawSnippet: '',
        }),
        candidate({
            category: 'ai',
            title: 'Google, xAI and Microsoft agree to US national security reviews of new AI models',
            summary: 'The agreement gives US officials access to review frontier AI model safety.',
            source: 'Financial Times',
            domain: 'ft.com',
            url: 'https://www.ft.com/content/ai-model-national-security-review',
            publishedAt: '2026-04-17T12:00:00.000Z',
            tags: ['Google', 'Microsoft', 'AI', 'regulation'],
            rawSnippet: '',
        }),
    ], WINDOW, 10);

    assert.equal(result.items.length, 1);
    assert.match(result.items[0].title, /national security reviews/i);
});

test('sanitizeDailyNewsDigest removes translated low-information items and rebuilds top stories', () => {
    const digest = buildDailyNewsDigestFromResults([
        {
            category: 'crypto',
            ok: true,
            candidates: [
                candidate({
                    category: 'crypto',
                    title: 'Western Union begins USDPT stablecoin rollout on Solana',
                    summary: 'Western Union started rolling out its USDPT stablecoin on Solana.',
                    source: 'Cointelegraph',
                    domain: 'cointelegraph.com',
                    url: 'https://cointelegraph.com/news/western-union-usdpt-stablecoin-solana',
                    publishedAt: '2026-04-17T10:00:00.000Z',
                    tags: ['stablecoin', 'SOL'],
                    rawSnippet: '',
                }),
                candidate({
                    category: 'crypto',
                    title: 'Ripple to share North Korean threat intelligence with crypto firms',
                    summary: 'Ripple plans to share threat intelligence tied to North Korean activity with crypto companies.',
                    source: 'CoinDesk',
                    domain: 'coindesk.com',
                    url: 'https://www.coindesk.com/tech/2026/04/17/ripple-threat-intelligence-north-korea/',
                    publishedAt: '2026-04-17T11:00:00.000Z',
                    tags: ['security'],
                    rawSnippet: '',
                }),
            ],
        },
        { category: 'macro', ok: true, candidates: [] },
        { category: 'ai', ok: true, candidates: [] },
    ], WINDOW);

    digest.crypto.unshift({
        ...digest.crypto[0],
        id: 'crypto-translated-noise',
        title: '随着黄金支持代币的需求上升，Tether Gold 突破 $3.3B',
        summary: '随着黄金支持代币的需求上升，Tether Gold 突破 $3.3B。',
        importanceScore: 90,
        subcategory: '稳定币',
        tags: ['加密', '稳定币'],
    });
    digest.topStories = digest.crypto.slice(0, 3).map((item) => ({
        id: item.id,
        headline: item.title,
        whyImportant: item.whyItMatters || item.summary,
        category: item.category,
        confirmationLevel: item.confirmationLevel,
        sourceTier: item.sourceTier,
        importanceScore: item.importanceScore,
    }));

    const sanitized = sanitizeDailyNewsDigest(digest);
    const combined = [
        ...sanitized.crypto.map((item) => item.title),
        ...(sanitized.topStories || []).map((story) => story.headline),
    ].join('\n');

    assert.doesNotMatch(combined, /Tether Gold|突破 \$3\.3B/);
    assert.match(combined, /西联汇款|Ripple/);
});

test('sanitizeDailyNewsDigest removes generic normalized fallback placeholders', () => {
    const digest = buildDailyNewsDigestFromResults([
        {
            category: 'crypto',
            ok: true,
            candidates: [
                candidate({
                    category: 'crypto',
                    title: 'Coinbase交易所宕机超2小时',
                    summary: 'Coinbase 交易所发生宕机，用户交易和提现短时受影响。',
                    source: 'Odaily 星球日报',
                    domain: 'odaily.news',
                    url: 'https://www.odaily.news/zh-CN/newsflash/coinbase-outage',
                    publishedAt: '2026-04-17T19:00:00.000Z',
                    tags: ['Coinbase', 'exchange'],
                    rawSnippet: '',
                }),
            ],
        },
        { category: 'macro', ok: true, candidates: [] },
        { category: 'ai', ok: true, candidates: [] },
    ], WINDOW);

    digest.crypto.push({
        ...digest.crypto[0],
        id: 'generic-regulation',
        title: '监管',
        summary: '监管。',
        importanceScore: 90,
    }, {
        ...digest.crypto[0],
        id: 'generic-etf',
        title: 'ETF 开始 ETF',
        summary: 'ETF 开始 ETF。',
        importanceScore: 90,
    });
    digest.ai.push({
        ...digest.crypto[0],
        id: 'generic-ai',
        category: 'ai',
        title: 'Anthropic 模型出现新进展',
        summary: 'Anthropic 模型出现新进展。',
        importanceScore: 90,
        tags: ['Anthropic', 'AI'],
    });

    const sanitized = sanitizeDailyNewsDigest(digest);
    const combined = [
        ...sanitized.crypto.map((item) => item.title),
        ...sanitized.ai.map((item) => item.title),
    ].join('\n');

    assert.match(combined, /Coinbase/);
    assert.doesNotMatch(combined, /(^|\n)监管($|\n)|ETF 开始 ETF|出现新进展/);
});

test('dedupeAndRankCandidates filters price predictions but keeps systemic ETF stablecoin and AI events', () => {
    const cryptoResult = dedupeAndRankCandidates('crypto', [
        candidate({
            category: 'crypto',
            title: '分析师称 BTC 将上涨至 120000 美元',
            summary: '交易员预测比特币价格将上涨，投资者关注价格目标。',
            source: 'Odaily 星球日报',
            domain: 'odaily.news',
            url: 'https://www.odaily.news/zh-CN/post/btc-price-prediction',
            publishedAt: '2026-04-17T18:00:00.000Z',
            tags: ['BTC', '价格预测'],
            rawSnippet: '',
        }),
        candidate({
            category: 'crypto',
            title: 'SEC delays decision on spot Ethereum ETF staking proposal',
            summary: 'The delay affects the structure of US spot ETH ETF products and requires updated filings.',
            source: 'Reuters',
            domain: 'reuters.com',
            url: 'https://www.reuters.com/technology/sec-delays-eth-staking-etf-2026-04-17/',
            publishedAt: '2026-04-17T19:00:00.000Z',
            tags: ['SEC', 'ETH', 'ETF'],
            rawSnippet: '',
        }),
        candidate({
            category: 'crypto',
            title: 'Circle updates USDC reserve attestations after redemption pressure',
            summary: 'USDC reserve attestations were updated after redemption pressure and regulatory scrutiny.',
            source: 'CoinDesk',
            domain: 'coindesk.com',
            url: 'https://www.coindesk.com/policy/usdc-reserve-attestation-redemption-pressure',
            publishedAt: '2026-04-17T20:00:00.000Z',
            tags: ['USDC', 'stablecoin', 'reserve'],
            rawSnippet: '',
        }),
    ], WINDOW, 10);

    const cryptoTitles = cryptoResult.items.map((item) => item.title).join('\n');
    assert.doesNotMatch(cryptoTitles, /120000|价格预测|分析师称/);
    assert.match(cryptoTitles, /SEC|ETF/);
    assert.match(cryptoTitles, /USDC|储备|赎回|reserve/i);

    const aiResult = dedupeAndRankCandidates('ai', [
        candidate({
            category: 'ai',
            title: 'Nvidia and TSMC expand AI chip capacity after major cloud demand surge',
            summary: 'Nvidia and TSMC expanded AI chip capacity as cloud demand for accelerators surged.',
            source: 'Reuters',
            domain: 'reuters.com',
            url: 'https://www.reuters.com/technology/nvidia-tsmc-ai-chip-capacity-2026-04-17/',
            publishedAt: '2026-04-17T21:00:00.000Z',
            tags: ['NVIDIA', 'TSMC', 'AI chips'],
            rawSnippet: '',
        }),
    ], WINDOW, 10);

    assert.equal(aiResult.items.length, 1);
    assert.equal(aiResult.items[0]?.sourceTier, 'major');
    assert.match(aiResult.items[0]?.title || '', /Nvidia|TSMC|芯片|AI/i);
});

test('buildDailyNewsDigestFromResults summarizes the 24 hour brief without trading language', () => {
    const digest = buildDailyNewsDigestFromResults([
        {
            category: 'crypto',
            ok: true,
            candidates: [
                candidate({
                    category: 'crypto',
                    title: 'SEC approves spot Ethereum ETF staking proposal',
                    summary: 'The approval may reshape ETF product design and institutional access to ETH staking yield.',
                    source: 'Reuters',
                    domain: 'reuters.com',
                    url: 'https://www.reuters.com/technology/sec-approves-ethereum-etf-staking-2026-04-17/',
                    publishedAt: '2026-04-17T18:00:00.000Z',
                    tags: ['SEC', 'ETF', 'ETH'],
                    rawSnippet: '',
                }),
            ],
        },
        { category: 'macro', ok: true, candidates: [] },
        { category: 'ai', ok: true, candidates: [] },
    ], WINDOW);

    assert.match(digest.brief?.headline || '', /过去 24 小时|大事/);
    assert.doesNotMatch(digest.brief?.headline || '', /风险偏好|多空|price|交易/);
    assert.doesNotMatch(digest.crypto[0].whyItMatters || '', /交易者|风险偏好|盘中/);
    assert.ok((digest.crypto[0].watchpoints || []).some((point) => /后续|确认|规则|披露/.test(point)));
});

test('file storage saves latest digest and reuses an existing same-window digest', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'daily-news-'));
    try {
        const storage = createDailyNewsFileStorage(rootDir);
        const digest = buildDailyNewsDigestFromResults([
            { category: 'macro', ok: true, candidates: [candidate()] },
            { category: 'ai', ok: true, candidates: [] },
            { category: 'crypto', ok: true, candidates: [] },
        ], WINDOW);

        await storage.saveDigest(digest);
        const latest = await storage.readLatestDigest();
        const sameWindow = await storage.readDigestForWindow(WINDOW);

        assert.equal(latest?.generatedAt, WINDOW.windowEnd);
        assert.equal(sameWindow?.windowStart, WINDOW.windowStart);
        assert.equal(sameWindow?.macro.length, 1);
    } finally {
        await rm(rootDir, { recursive: true, force: true });
    }
});
