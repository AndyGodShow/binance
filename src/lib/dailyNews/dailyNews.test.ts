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
