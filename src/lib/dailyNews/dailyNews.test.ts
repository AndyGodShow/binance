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
