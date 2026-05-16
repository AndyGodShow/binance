import type {
    DailyNewsDigest,
    DailyNewsItem,
    DailyNewsTopStory,
    ImportanceLevel,
    ImpactDirection,
    ImpactHorizon,
    NewsCategory,
    NewsConfirmationLevel,
    NewsSourceTier,
} from './types.ts';

export type NewsFilterKey =
    | 'all'
    | NewsCategory
    | 'regulation'
    | 'security'
    | 'etf'
    | 'exchange'
    | 'stablecoin'
    | 'centralBank'
    | 'inflation'
    | 'chip'
    | 'model';

export type NewsHealthOverallStatus = 'healthy' | 'partial' | 'degraded' | 'empty';
export type NewsBriefQuality = 'normal' | 'limited_sample' | 'incomplete';

export interface NewsFilterOption {
    key: NewsFilterKey;
    label: string;
    count: number;
    weak: boolean;
}

export interface NewsCategoryHealth {
    category: NewsCategory;
    label: string;
    status: 'success' | 'partial' | 'failed' | 'empty';
    requested: number;
    selected: number;
    irrelevant: number;
    unimportant: number;
    duplicates: number;
    error?: string;
    message: string;
}

export interface NewsHealthStatus {
    overallStatus: NewsHealthOverallStatus;
    message: string;
    failedCategories: NewsCategory[];
    hasFailures: boolean;
    totalSelected: number;
    highImpactCount: number;
    generatedAt: string;
    cacheAgeMinutes: number | null;
    categoryHealth: Record<NewsCategory, NewsCategoryHealth>;
}

export interface NewsTopEventsModel {
    title: string;
    subtitle: string;
    events: DailyNewsTopStory[];
    source: 'digest' | 'fallback' | 'empty';
}

export interface NewsEventCardModel {
    whyImportant: string;
    confirmationLabel: string;
    sourceTierLabel: string;
    directionLabel: string;
    horizonLabel: string;
    importanceLabel: string;
    categoryLabel: string;
    affectedAssets: string[];
    hasScoreBreakdown: boolean;
}

export interface NewsItemViewModel {
    item: DailyNewsItem;
    card: NewsEventCardModel;
}

export interface NewsViewModel {
    items: NewsItemViewModel[];
    allItems: DailyNewsItem[];
    filters: NewsFilterOption[];
    topEvents: NewsTopEventsModel;
    health: NewsHealthStatus;
    briefQuality: NewsBriefQuality;
    briefNotice: string | null;
    briefNotices: string[];
    isSampleLimited: boolean;
    highestScoreItem: DailyNewsItem | null;
}

const CATEGORY_LABELS: Record<NewsCategory, string> = {
    crypto: '加密',
    macro: '宏观',
    ai: 'AI',
};

const FILTER_DEFINITIONS: Array<{
    key: NewsFilterKey;
    label: string;
    matches: (item: DailyNewsItem) => boolean;
}> = [
    { key: 'all', label: '全部', matches: () => true },
    { key: 'crypto', label: '加密', matches: (item) => item.category === 'crypto' },
    { key: 'macro', label: '宏观', matches: (item) => item.category === 'macro' },
    { key: 'ai', label: 'AI', matches: (item) => item.category === 'ai' },
    { key: 'regulation', label: '监管', matches: (item) => item.subcategory === '监管' },
    { key: 'security', label: '安全事件', matches: (item) => item.subcategory === '安全事件' },
    { key: 'etf', label: 'ETF', matches: (item) => item.subcategory === 'ETF' },
    { key: 'exchange', label: '交易所', matches: (item) => item.subcategory === '交易所' },
    { key: 'stablecoin', label: '稳定币', matches: (item) => item.subcategory === '稳定币' },
    { key: 'centralBank', label: '央行', matches: (item) => item.subcategory === '央行' },
    { key: 'inflation', label: '通胀', matches: (item) => item.subcategory === '通胀' },
    { key: 'chip', label: '芯片', matches: (item) => item.subcategory === '芯片' },
    { key: 'model', label: '模型', matches: (item) => item.subcategory === '模型' },
];

const CONFIRMATION_RANK: Record<NewsConfirmationLevel, number> = {
    official: 4,
    multi_source: 3,
    single_authoritative: 2,
    single_source: 1,
};

export function getAllNewsItems(digest: DailyNewsDigest): DailyNewsItem[] {
    return [...digest.crypto, ...digest.macro, ...digest.ai];
}

export function getCategoryLabel(category: NewsCategory): string {
    return CATEGORY_LABELS[category];
}

export function getConfirmationLabel(level?: NewsConfirmationLevel): string {
    if (level === 'official') return '官方确认';
    if (level === 'multi_source') return '多源交叉';
    if (level === 'single_authoritative') return '权威单源';
    return '单源待复核';
}

export function getSourceTierLabel(tier?: NewsSourceTier): string {
    if (tier === 'official') return '官方来源';
    if (tier === 'major') return '主流媒体';
    if (tier === 'specialist') return '专业媒体';
    if (tier === 'aggregated') return '聚合来源';
    return '普通来源';
}

export function getDirectionLabel(direction?: ImpactDirection): string {
    if (direction === 'risk_on') return '利好';
    if (direction === 'risk_off') return '利空';
    if (direction === 'mixed') return '风险并存';
    if (direction === 'neutral') return '中性';
    return '待确认';
}

export function getHorizonLabel(horizon?: ImpactHorizon): string {
    if (horizon === 'intraday') return '短期';
    if (horizon === '1-4w') return '数周';
    if (horizon === '1-3d') return '1-3 天';
    return '待确认';
}

export function getImportanceLabel(level: ImportanceLevel, score: number): string {
    if (level === 'high') return `重大 ${score}`;
    if (level === 'medium') return `重要 ${score}`;
    return `观察 ${score}`;
}

export function sortNewsItems(items: DailyNewsItem[]): DailyNewsItem[] {
    return [...items].sort((a, b) => {
        if (b.importanceScore !== a.importanceScore) {
            return b.importanceScore - a.importanceScore;
        }

        const bConfirmation = b.confirmationLevel ? CONFIRMATION_RANK[b.confirmationLevel] : 0;
        const aConfirmation = a.confirmationLevel ? CONFIRMATION_RANK[a.confirmationLevel] : 0;
        if (bConfirmation !== aConfirmation) {
            return bConfirmation - aConfirmation;
        }

        return new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime();
    });
}

export function getFallbackTopEvents(digest: DailyNewsDigest): NewsTopEventsModel {
    if (digest.topStories && digest.topStories.length > 0) {
        return {
            title: '过去 24 小时值得优先看的事件',
            subtitle: '按影响程度、来源确认度和发布时间排序。',
            events: digest.topStories,
            source: 'digest',
        };
    }

    const fallbackItems = sortNewsItems(getAllNewsItems(digest)).slice(0, 3);
    if (fallbackItems.length === 0) {
        return {
            title: '过去 24 小时暂无达到入选标准的事件',
            subtitle: '请结合采集健康状态判断；来源失败不代表对应领域没有新闻。',
            events: [],
            source: 'empty',
        };
    }

    return {
        title: '当前最高优先级事件',
        subtitle: '按影响程度、来源确认度和发布时间排序。',
        events: fallbackItems.map((item) => ({
            id: item.id,
            headline: item.title,
            whyImportant: item.summarySections?.whyImportant || item.whyItMatters || item.summary,
            category: item.category,
            confirmationLevel: item.confirmationLevel,
            sourceTier: item.sourceTier,
            importanceScore: item.importanceScore,
        })),
        source: 'fallback',
    };
}

function minutesSince(iso: string, now: Date): number | null {
    const timestamp = new Date(iso).getTime();
    if (!Number.isFinite(timestamp)) return null;
    return Math.max(0, Math.floor((now.getTime() - timestamp) / 60000));
}

function categoryFailureMessage(category: NewsCategory): string {
    const label = CATEGORY_LABELS[category];
    const spacedLabel = category === 'ai' ? 'AI ' : label;
    const targetLabel = category === 'ai' ? ' AI ' : label;
    return `${spacedLabel}采集失败，本次摘要不代表${targetLabel}无重大新闻。`;
}

function buildCategoryHealth(digest: DailyNewsDigest, category: NewsCategory): NewsCategoryHealth {
    const status = digest.categoryStatus[category];
    const selected = digest[category].length;
    const normalizedStatus: NewsCategoryHealth['status'] = status?.status === 'failed'
        ? 'failed'
        : status?.status === 'partial'
            ? 'partial'
        : selected === 0
            ? 'empty'
            : status?.status === 'ok'
                ? 'success'
                : 'partial';

    let message = `${CATEGORY_LABELS[category]}新闻源正常。`;
    if (normalizedStatus === 'failed') {
        message = categoryFailureMessage(category);
    } else if (normalizedStatus === 'empty') {
        message = `${CATEGORY_LABELS[category]}本次没有达到入选标准的事件，需结合采集状态判断。`;
    } else if (normalizedStatus === 'partial') {
        message = `${CATEGORY_LABELS[category]}采集部分可用，结果可能不完整。`;
    }

    return {
        category,
        label: CATEGORY_LABELS[category],
        status: normalizedStatus,
        requested: status?.requested ?? 0,
        selected,
        irrelevant: status?.dropped.irrelevant ?? 0,
        unimportant: status?.dropped.unimportant ?? 0,
        duplicates: status?.dropped.duplicates ?? 0,
        error: status?.error,
        message,
    };
}

export function getNewsHealthStatus(digest: DailyNewsDigest, now = new Date()): NewsHealthStatus {
    const categoryHealth = {
        crypto: buildCategoryHealth(digest, 'crypto'),
        macro: buildCategoryHealth(digest, 'macro'),
        ai: buildCategoryHealth(digest, 'ai'),
    } satisfies Record<NewsCategory, NewsCategoryHealth>;
    const failedCategories = (Object.values(categoryHealth) as NewsCategoryHealth[])
        .filter((item) => item.status === 'failed')
        .map((item) => item.category);
    const categoryHealthItems = Object.values(categoryHealth) as NewsCategoryHealth[];
    const allItems = getAllNewsItems(digest);
    const hasFailures = failedCategories.length > 0;
    const hasPartialCategories = categoryHealthItems.some((item) => item.status === 'partial');
    const allCategoriesEmpty = categoryHealthItems.every((item) => item.status === 'empty');
    const hasLimitedSample = allItems.length > 0 && allItems.length <= 1;
    const overallStatus: NewsHealthOverallStatus = hasFailures
        ? 'degraded'
        : hasPartialCategories
            ? 'partial'
        : allCategoriesEmpty || allItems.length === 0
            ? 'empty'
            : hasLimitedSample
                ? 'partial'
                : 'healthy';
    const message = overallStatus === 'healthy'
        ? '数据健康状态正常'
        : overallStatus === 'degraded'
            ? '部分源失败，当前结果可能不完整'
            : overallStatus === 'partial'
                ? hasLimitedSample
                    ? '样本不足，当前风险偏向参考价值有限'
                    : '部分可用，当前结果可能不完整'
                : '数据不足，当前窗口暂无达到入选标准的事件';

    return {
        overallStatus,
        message,
        failedCategories,
        hasFailures,
        totalSelected: allItems.length,
        highImpactCount: allItems.filter((item) => item.importanceLevel === 'high').length,
        generatedAt: digest.generatedAt,
        cacheAgeMinutes: minutesSince(digest.generatedAt, now),
        categoryHealth,
    };
}

export function getAvailableFilters(items: DailyNewsItem[]): NewsFilterOption[] {
    return FILTER_DEFINITIONS
        .map((definition) => {
            const count = items.filter(definition.matches).length;
            return {
                key: definition.key,
                label: definition.label,
                count,
                weak: count === 0,
            };
        })
        .filter((filter) => filter.key === 'all' || filter.count > 0);
}

function getCardModel(item: DailyNewsItem): NewsEventCardModel {
    return {
        whyImportant: item.summarySections?.whyImportant || item.editorialReason || item.whyItMatters || item.summary,
        confirmationLabel: getConfirmationLabel(item.confirmationLevel),
        sourceTierLabel: getSourceTierLabel(item.sourceTier),
        directionLabel: getDirectionLabel(item.impactDirection),
        horizonLabel: getHorizonLabel(item.impactHorizon),
        importanceLabel: getImportanceLabel(item.importanceLevel, item.importanceScore),
        categoryLabel: `${CATEGORY_LABELS[item.category]}${item.subcategory ? ` / ${item.subcategory}` : ''}`,
        affectedAssets: item.affectedAssets || [],
        hasScoreBreakdown: Boolean(item.scoreBreakdown),
    };
}

function getBriefQuality(digest: DailyNewsDigest, health: NewsHealthStatus): NewsBriefQuality {
    if (health.hasFailures) return 'incomplete';
    if (getAllNewsItems(digest).length <= 1) return 'limited_sample';
    return 'normal';
}

function getBriefNotices(digest: DailyNewsDigest, health: NewsHealthStatus): string[] {
    const notices: string[] = [];
    if (health.hasFailures) {
        notices.push('部分分类采集失败，本次摘要只反映已成功采集的来源。');
    }
    if (getAllNewsItems(digest).length <= 1) {
        notices.push('当前入选事件较少，风险偏向参考价值有限；这不等同于对应领域没有新闻。');
    }
    return notices;
}

export function buildNewsViewModel(digest: DailyNewsDigest, now = new Date()): NewsViewModel {
    const allItems = sortNewsItems(getAllNewsItems(digest));
    const health = getNewsHealthStatus(digest, now);
    const briefQuality = getBriefQuality(digest, health);
    const briefNotices = getBriefNotices(digest, health);

    return {
        items: allItems.map((item) => ({
            item,
            card: getCardModel(item),
        })),
        allItems,
        filters: getAvailableFilters(allItems),
        topEvents: getFallbackTopEvents(digest),
        health,
        briefQuality,
        briefNotice: briefNotices[0] || null,
        briefNotices,
        isSampleLimited: allItems.length <= 1,
        highestScoreItem: allItems[0] || null,
    };
}

export function filterNewsItems(items: DailyNewsItem[], filter: NewsFilterKey): DailyNewsItem[] {
    const definition = FILTER_DEFINITIONS.find((candidate) => candidate.key === filter);
    if (!definition) return items;
    return items.filter(definition.matches);
}
