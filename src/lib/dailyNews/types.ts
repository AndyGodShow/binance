export type NewsCategory = 'macro' | 'ai' | 'crypto';
export type ImportanceLevel = 'high' | 'medium' | 'low';
export type CategoryStatus = 'ok' | 'partial' | 'failed';
export type ImpactDirection = 'risk_on' | 'risk_off' | 'mixed' | 'neutral';
export type ImpactHorizon = 'intraday' | '1-3d' | '1-4w';
export type NewsRiskBias = ImpactDirection;

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
}

export interface DailyNewsCategoryStatus {
    status: CategoryStatus;
    requested: number;
    returned: number;
    dropped: {
        outsideWindow: number;
        irrelevant: number;
        duplicates: number;
        invalidDate: number;
        invalidUrl: number;
    };
    error?: string;
}

export interface DailyNewsBrief {
    riskBias: NewsRiskBias;
    headline: string;
    driverTags: string[];
    affectedAssets: string[];
    highImpactCount: number;
    latestSignals: string[];
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
}

export interface CategoryCollectionResult {
    category: NewsCategory;
    ok: boolean;
    candidates: NewsCandidate[];
    error?: string;
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
