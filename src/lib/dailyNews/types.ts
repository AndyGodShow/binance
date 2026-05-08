export type NewsCategory = 'macro' | 'ai' | 'crypto';
export type ImportanceLevel = 'high' | 'medium' | 'low';
export type CategoryStatus = 'ok' | 'partial' | 'failed';
export type DailyNewsSourceName = 'rss' | '6551' | 'gdelt';
export type DailyNewsSourceAttemptStatus = 'success' | 'partial' | 'empty' | 'failed';
export type ImpactDirection = 'risk_on' | 'risk_off' | 'mixed' | 'neutral';
export type ImpactHorizon = 'intraday' | '1-3d' | '1-4w';
export type NewsRiskBias = ImpactDirection;
export type NewsSourceTier = 'official' | 'major' | 'specialist' | 'aggregated' | 'unknown';
export type NewsConfirmationLevel = 'official' | 'multi_source' | 'single_authoritative' | 'single_source';
export type NewsEventStatus = 'pending' | 'confirmed' | 'disputed' | 'reversed';

export interface DailyNewsEventSource {
    source: string;
    domain?: string;
    url: string;
    publishedAt: string;
    sourceTier?: NewsSourceTier;
}

export interface DailyNewsTimelineEntry extends DailyNewsEventSource {
    label: '首次报道' | '多源跟进' | '官方确认' | '后续更新';
    title: string;
}

export interface DailyNewsSummarySections {
    whatHappened: string;
    whyImportant: string;
    whatToWatch: string;
    sourceAndConfirmation: string;
}

export interface DailyNewsScoreBreakdown {
    entityWeight: number;
    sourceWeight: number;
    confirmationWeight: number;
    categoryWeight: number;
    noveltyWeight: number;
    impactWeight: number;
}

export const NEWS_CATEGORIES: NewsCategory[] = ['macro', 'ai', 'crypto'];

export interface DailyNewsWindow {
    windowStart: string;
    windowEnd: string;
    windowStartMs: number;
    windowEndMs: number;
    timezone: string;
}

export interface NewsCandidate {
    category: NewsCategory;
    title: string;
    summary?: string;
    source: string;
    domain?: string;
    url: string;
    publishedAt?: string;
    collectedAt: string;
    tags?: string[];
    rawSnippet?: string;
}

export interface DailyNewsSourceAttempt {
    source: DailyNewsSourceName;
    status: DailyNewsSourceAttemptStatus;
    candidateCount: number;
    durationMs: number;
    error?: string;
}

export interface DailyNewsItem {
    id: string;
    category: NewsCategory;
    title: string;
    summary: string;
    source: string;
    url: string;
    publishedAt: string;
    collectedAt: string;
    importanceScore: number;
    importanceLevel: ImportanceLevel;
    tags: string[];
    subcategory?: string;
    affectedAssets?: string[];
    impactDirection?: ImpactDirection;
    impactHorizon?: ImpactHorizon;
    whyItMatters?: string;
    watchpoints?: string[];
    sourceTier?: NewsSourceTier;
    confirmationLevel?: NewsConfirmationLevel;
    editorialReason?: string;
    eventStatus?: NewsEventStatus;
    earliestSource?: DailyNewsEventSource;
    latestSource?: DailyNewsEventSource;
    officialSource?: DailyNewsEventSource;
    timeline?: DailyNewsTimelineEntry[];
    coreEntities?: string[];
    summarySections?: DailyNewsSummarySections;
    scoreBreakdown?: DailyNewsScoreBreakdown;
}

export interface DailyNewsCategoryStatus {
    status: CategoryStatus;
    requested: number;
    returned: number;
    dropped: {
        outsideWindow: number;
        irrelevant: number;
        unimportant: number;
        duplicates: number;
        invalidDate: number;
        invalidUrl: number;
    };
    error?: string;
    sourceAttempts?: DailyNewsSourceAttempt[];
    totalCandidates?: number;
    degradedReason?: string;
}

export interface DailyNewsBrief {
    riskBias: NewsRiskBias;
    headline: string;
    driverTags: string[];
    affectedAssets: string[];
    highImpactCount: number;
    latestSignals: string[];
}

export interface DailyNewsTopStory {
    id: string;
    headline: string;
    whyImportant: string;
    category: NewsCategory;
    confirmationLevel?: NewsConfirmationLevel;
    sourceTier?: NewsSourceTier;
    importanceScore: number;
}

export interface DailyNewsDigest {
    generatedAt: string;
    windowStart: string;
    windowEnd: string;
    timezone: string;
    macro: DailyNewsItem[];
    ai: DailyNewsItem[];
    crypto: DailyNewsItem[];
    categoryStatus: Record<NewsCategory, DailyNewsCategoryStatus>;
    brief?: DailyNewsBrief;
    topStories?: DailyNewsTopStory[];
}

export interface CategoryCollectionResult {
    category: NewsCategory;
    ok: boolean;
    candidates: NewsCandidate[];
    error?: string;
    sourceAttempts?: DailyNewsSourceAttempt[];
    degradedReason?: string;
}

export interface DailyNewsApiResponse {
    digest: DailyNewsDigest | null;
    status: 'ok' | 'empty';
    storageMode: 'blob' | 'local-file';
    message?: string;
}

export interface DailyNewsGenerationResult {
    digest: DailyNewsDigest | null;
    generated: boolean;
    reusedExisting: boolean;
    storageMode: 'blob' | 'local-file';
    message?: string;
}
