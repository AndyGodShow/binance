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
