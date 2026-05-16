import test from 'node:test';
import assert from 'node:assert/strict';

import {
    buildNewsViewModel,
    getAvailableFilters,
    getFallbackTopEvents,
    getNewsHealthStatus,
    sortNewsItems,
} from './viewModel.ts';
import type { DailyNewsDigest, DailyNewsItem } from './types.ts';

const BASE_ITEM: DailyNewsItem = {
    id: 'crypto-1',
    category: 'crypto',
    title: 'Coinbase 交易所宕机超 2 小时',
    summary: 'Coinbase 交易所服务中断。',
    source: 'Odaily 星球日报',
    url: 'https://www.odaily.news/zh-CN/newsflash/479918',
    publishedAt: '2026-05-08T03:55:18.000Z',
    collectedAt: '2026-05-08T05:18:14.786Z',
    importanceScore: 61,
    importanceLevel: 'medium',
    tags: ['加密', '交易所'],
    subcategory: '交易所',
    affectedAssets: ['COINBASE'],
    impactDirection: 'neutral',
    impactHorizon: '1-3d',
    sourceTier: 'specialist',
    confirmationLevel: 'single_authoritative',
    editorialReason: '权威/专业来源报道，属于加密行业监管、交易所、安全或基础设施中的交易所事件。',
    summarySections: {
        whatHappened: '发生了什么：Coinbase 交易所服务中断超过 2 小时。',
        whyImportant: '为什么重要：交易所故障会影响用户访问、交易连续性和基础设施信任。',
        whatToWatch: '后续看什么：后续看官方公告和补偿方案。',
        sourceAndConfirmation: '来源与确认度：Odaily 星球日报，专业媒体，权威单源。',
    },
    scoreBreakdown: {
        entityWeight: 4,
        sourceWeight: 14,
        confirmationWeight: 10,
        categoryWeight: 12,
        noveltyWeight: 7,
        impactWeight: 14,
    },
};

function status(overrides: Partial<DailyNewsDigest['categoryStatus']['crypto']> = {}): DailyNewsDigest['categoryStatus']['crypto'] {
    return {
        status: 'partial',
        requested: 20,
        returned: 1,
        dropped: {
            outsideWindow: 0,
            irrelevant: 7,
            unimportant: 10,
            duplicates: 2,
            invalidDate: 0,
            invalidUrl: 0,
        },
        ...overrides,
    };
}

function digest(overrides: Partial<DailyNewsDigest> = {}): DailyNewsDigest {
    return {
        generatedAt: '2026-05-08T05:18:14.786Z',
        windowStart: '2026-05-07T05:18:14.786Z',
        windowEnd: '2026-05-08T05:18:14.786Z',
        timezone: 'Asia/Shanghai',
        crypto: [BASE_ITEM],
        macro: [],
        ai: [],
        categoryStatus: {
            crypto: status(),
            macro: status({
                status: 'failed',
                requested: 0,
                returned: 0,
                error: 'This operation was aborted',
            }),
            ai: status({
                status: 'failed',
                requested: 0,
                returned: 0,
                error: 'This operation was aborted',
            }),
        },
        brief: {
            riskBias: 'neutral',
            headline: '过去 24 小时大事集中在交易所，整体脉络是方向性信息有限。',
            driverTags: ['交易所'],
            affectedAssets: ['COINBASE'],
            highImpactCount: 0,
            latestSignals: ['交易所：Coinbase 交易所宕机超 2 小时'],
        },
        topStories: [],
        ...overrides,
    };
}

test('getFallbackTopEvents returns highest score events when topStories is empty', () => {
    const lowerScoreItem: DailyNewsItem = {
        ...BASE_ITEM,
        id: 'macro-1',
        category: 'macro',
        title: '美联储官员释放谨慎信号',
        importanceScore: 58,
        confirmationLevel: 'multi_source',
        publishedAt: '2026-05-08T04:00:00.000Z',
    };
    const model = getFallbackTopEvents(digest({ macro: [lowerScoreItem] }));

    assert.equal(model.title, '当前最高优先级事件');
    assert.equal(model.events.length, 2);
    assert.equal(model.events[0]?.id, BASE_ITEM.id);
});

test('getFallbackTopEvents reports truly empty state when all categories have no items', () => {
    const model = getFallbackTopEvents(digest({ crypto: [], macro: [], ai: [] }));

    assert.equal(model.title, '过去 24 小时暂无达到入选标准的事件');
    assert.match(model.subtitle, /来源失败不代表对应领域没有新闻/);
    assert.equal(model.events.length, 0);
});

test('getNewsHealthStatus distinguishes failed collection from no news', () => {
    const health = getNewsHealthStatus(digest(), new Date('2026-05-08T06:18:14.786Z'));

    assert.equal(health.overallStatus, 'degraded');
    assert.equal(health.failedCategories.length, 2);
    assert.match(health.categoryHealth.macro.message, /宏观采集失败，本次摘要不代表宏观无重大新闻/);
    assert.match(health.categoryHealth.ai.message, /AI 采集失败，本次摘要不代表 AI 无重大新闻/);
    assert.equal(health.cacheAgeMinutes, 60);
});

test('getNewsHealthStatus marks all partial categories as partial rather than healthy', () => {
    const health = getNewsHealthStatus(digest({
        macro: [{
            ...BASE_ITEM,
            id: 'macro-1',
            category: 'macro',
            title: '美联储官员释放谨慎信号',
        }],
        ai: [{
            ...BASE_ITEM,
            id: 'ai-1',
            category: 'ai',
            title: 'NVIDIA 扩大 AI 芯片供应',
        }],
        categoryStatus: {
            crypto: status({ status: 'partial', returned: 1 }),
            macro: status({ status: 'partial', returned: 1 }),
            ai: status({ status: 'partial', returned: 1 }),
        },
    }));

    assert.equal(health.overallStatus, 'partial');
    assert.match(health.message, /部分可用/);
});

test('getNewsHealthStatus marks success plus partial as partial', () => {
    const health = getNewsHealthStatus(digest({
        macro: [{
            ...BASE_ITEM,
            id: 'macro-1',
            category: 'macro',
            title: '美联储官员释放谨慎信号',
        }],
        categoryStatus: {
            crypto: status({ status: 'ok', returned: 1 }),
            macro: status({ status: 'partial', returned: 1 }),
            ai: status({ status: 'ok', returned: 0 }),
        },
    }));

    assert.equal(health.overallStatus, 'partial');
});

test('getNewsHealthStatus keeps zero-result partial categories visible', () => {
    const health = getNewsHealthStatus(digest({
        crypto: [],
        macro: [],
        ai: [],
        categoryStatus: {
            crypto: status({ status: 'partial', returned: 0 }),
            macro: status({ status: 'ok', returned: 0 }),
            ai: status({ status: 'ok', returned: 0 }),
        },
    }));

    assert.equal(health.categoryHealth.crypto.status, 'partial');
    assert.match(health.categoryHealth.crypto.message, /采集部分可用/);
    assert.equal(health.overallStatus, 'partial');
});

test('getNewsHealthStatus keeps failed categories degraded', () => {
    const health = getNewsHealthStatus(digest({
        macro: [{
            ...BASE_ITEM,
            id: 'macro-1',
            category: 'macro',
            title: '美联储官员释放谨慎信号',
        }],
        categoryStatus: {
            crypto: status({ status: 'ok', returned: 1 }),
            macro: status({ status: 'partial', returned: 1 }),
            ai: status({ status: 'failed', returned: 0, error: 'AI timeout after 10000ms' }),
        },
    }));

    assert.equal(health.overallStatus, 'degraded');
});

test('getNewsHealthStatus only marks all successful and sufficient samples as healthy', () => {
    const health = getNewsHealthStatus(digest({
        macro: [{
            ...BASE_ITEM,
            id: 'macro-1',
            category: 'macro',
            title: '美联储官员释放谨慎信号',
        }],
        ai: [{
            ...BASE_ITEM,
            id: 'ai-1',
            category: 'ai',
            title: 'NVIDIA 扩大 AI 芯片供应',
        }],
        categoryStatus: {
            crypto: status({ status: 'ok', returned: 1 }),
            macro: status({ status: 'ok', returned: 1 }),
            ai: status({ status: 'ok', returned: 1 }),
        },
    }));

    assert.equal(health.overallStatus, 'healthy');
});

test('getNewsHealthStatus marks one successful selected event as partial sample', () => {
    const health = getNewsHealthStatus(digest({
        categoryStatus: {
            crypto: status({ status: 'ok', returned: 1 }),
            macro: status({ status: 'ok', returned: 0 }),
            ai: status({ status: 'ok', returned: 0 }),
        },
    }));

    assert.equal(health.overallStatus, 'partial');
    assert.match(health.message, /样本不足/);
});

test('buildNewsViewModel marks one selected event as limited sample and incomplete brief', () => {
    const model = buildNewsViewModel(digest(), new Date('2026-05-08T06:18:14.786Z'));

    assert.equal(model.briefQuality, 'incomplete');
    assert.equal(model.isSampleLimited, true);
    assert.ok(model.briefNotice);
    assert.match(model.briefNotice, /部分分类采集失败/);
    assert.deepEqual(model.briefNotices, [
        '部分分类采集失败，本次摘要只反映已成功采集的来源。',
        '当前入选事件较少，风险偏向参考价值有限；这不等同于对应领域没有新闻。',
    ]);
    assert.equal(model.topEvents.title, '当前最高优先级事件');
});

test('getAvailableFilters generates active filters from category and subcategory', () => {
    const filters = getAvailableFilters([BASE_ITEM]);
    const activeKeys = filters.filter((filter) => filter.count > 0).map((filter) => filter.key);

    assert.deepEqual(activeKeys, ['all', 'crypto', 'exchange']);
});

test('sortNewsItems orders by score confirmation and publish time', () => {
    const officialOlder: DailyNewsItem = {
        ...BASE_ITEM,
        id: 'official',
        importanceScore: 70,
        confirmationLevel: 'official',
        publishedAt: '2026-05-08T01:00:00.000Z',
    };
    const singleNewer: DailyNewsItem = {
        ...BASE_ITEM,
        id: 'single',
        importanceScore: 70,
        confirmationLevel: 'single_source',
        publishedAt: '2026-05-08T04:00:00.000Z',
    };
    const highest: DailyNewsItem = {
        ...BASE_ITEM,
        id: 'highest',
        importanceScore: 75,
        confirmationLevel: 'single_source',
        publishedAt: '2026-05-08T02:00:00.000Z',
    };

    assert.deepEqual(sortNewsItems([singleNewer, officialOlder, highest]).map((item) => item.id), [
        'highest',
        'official',
        'single',
    ]);
});

test('buildNewsViewModel exposes event card fields without requiring scoreBreakdown', () => {
    const itemWithoutScore: DailyNewsItem = {
        ...BASE_ITEM,
        scoreBreakdown: undefined,
    };
    const model = buildNewsViewModel(digest({ crypto: [itemWithoutScore] }));

    assert.equal(model.items[0]?.card.whyImportant, BASE_ITEM.summarySections?.whyImportant);
    assert.equal(model.items[0]?.card.confirmationLabel, '权威单源');
    assert.equal(model.items[0]?.card.affectedAssets.join(','), 'COINBASE');
    assert.equal(model.items[0]?.card.hasScoreBreakdown, false);
});
