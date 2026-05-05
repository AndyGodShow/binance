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
    assert.ok(digest.brief?.affectedAssets.includes('BTC'));
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
