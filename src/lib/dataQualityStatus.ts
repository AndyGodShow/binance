export type UnifiedDataQuality = 'enriched' | 'partial' | 'lightweight' | 'stale' | 'degraded' | 'unavailable';
export type UnifiedBuildState = 'ready' | 'building' | 'stale' | 'failed' | 'idle';
type UnifiedSourceStatusValue = 'ok' | 'partial' | 'failed' | 'skipped' | 'timeout';
export type UnifiedErrorKind = 'timeout' | 'upstream_error' | 'empty_response' | 'invalid_response' | 'rate_limited' | 'unknown';

interface UnifiedSourceStatus {
    ok: boolean;
    status: UnifiedSourceStatusValue;
    errorKind?: UnifiedErrorKind;
    message?: string;
    updatedAt?: number;
}

export interface QualityMeta {
    dataQuality: UnifiedDataQuality;
    buildState: UnifiedBuildState;
    dataSource: string;
    isStale?: boolean;
    isFallback?: boolean;
    errorKind?: UnifiedErrorKind;
    updatedAt?: number;
    cacheAgeSeconds?: number;
    sourceStatus?: Record<string, UnifiedSourceStatus>;
}

export type OpenInterestAllPayload = Record<string, unknown> & QualityMeta;

const SYMBOL_KEY_PATTERN = /^[A-Z0-9]{1,20}USDT$/;

function normalizeSourceStatus(input: QualityMeta): Record<string, UnifiedSourceStatus> {
    if (input.sourceStatus) {
        return input.sourceStatus;
    }

    const status: UnifiedSourceStatusValue = input.errorKind === 'timeout'
        ? 'timeout'
        : input.dataQuality === 'partial' || input.dataQuality === 'degraded' || input.dataQuality === 'stale'
            ? 'partial'
            : input.dataQuality === 'unavailable'
                ? 'failed'
                : 'ok';

    return {
        openInterest: {
            ok: status === 'ok' || status === 'partial',
            status,
            errorKind: input.errorKind,
            updatedAt: input.updatedAt,
        },
    };
}

export function buildOpenInterestAllPayload(input: {
    data: Record<string, string>;
} & QualityMeta): OpenInterestAllPayload {
    return {
        ...input.data,
        dataQuality: input.dataQuality,
        buildState: input.buildState,
        dataSource: input.dataSource,
        isStale: input.isStale ?? (input.dataQuality === 'stale' || input.buildState === 'stale'),
        isFallback: input.isFallback ?? false,
        errorKind: input.errorKind,
        updatedAt: input.updatedAt,
        cacheAgeSeconds: input.cacheAgeSeconds,
        sourceStatus: normalizeSourceStatus(input),
    };
}

export function extractSymbolValueMap(input: Record<string, unknown> | undefined | null): Record<string, string> {
    if (!input) {
        return {};
    }

    return Object.fromEntries(
        Object.entries(input)
            .filter(([key, value]) => SYMBOL_KEY_PATTERN.test(key) && typeof value === 'string')
    ) as Record<string, string>;
}

export function buildQualityHeaders(input: QualityMeta): Record<string, string> {
    const headers: Record<string, string> = {
        'X-Data-Source': input.dataSource,
        'X-Data-Quality': input.dataQuality,
        'X-Build-State': input.buildState,
    };

    if (input.cacheAgeSeconds !== undefined) {
        headers['X-Cache-Age-Seconds'] = String(input.cacheAgeSeconds);
    }
    if (input.isStale) {
        headers['X-Is-Stale'] = '1';
    }
    if (input.isFallback) {
        headers['X-Is-Fallback'] = '1';
    }
    if (input.errorKind) {
        headers['X-Error-Kind'] = input.errorKind;
    }

    return headers;
}

function normalizeQuality(value: unknown): UnifiedDataQuality | undefined {
    return value === 'enriched' ||
        value === 'partial' ||
        value === 'lightweight' ||
        value === 'stale' ||
        value === 'degraded' ||
        value === 'unavailable'
        ? value
        : undefined;
}

function normalizeBuildState(value: unknown): UnifiedBuildState | undefined {
    return value === 'ready' ||
        value === 'building' ||
        value === 'stale' ||
        value === 'failed' ||
        value === 'idle'
        ? value
        : undefined;
}

function normalizeErrorKind(value: unknown): UnifiedErrorKind | undefined {
    return value === 'timeout' ||
        value === 'upstream_error' ||
        value === 'empty_response' ||
        value === 'invalid_response' ||
        value === 'rate_limited' ||
        value === 'unknown'
        ? value
        : undefined;
}

export function summarizeTimedPayloadQuality(input: {
    dataQuality?: string;
    buildState?: string;
    dataSource?: string;
    isStale?: boolean;
    isFallback?: boolean;
    errorKind?: string;
    body?: Record<string, unknown> | null;
}) {
    const hasExplicitQuality =
        input.dataQuality !== undefined ||
        input.buildState !== undefined ||
        input.isStale !== undefined ||
        input.isFallback !== undefined ||
        input.errorKind !== undefined ||
        input.body?.dataQuality !== undefined ||
        input.body?.buildState !== undefined ||
        input.body?.isStale !== undefined ||
        input.body?.isFallback !== undefined ||
        input.body?.errorKind !== undefined;
    const dataQuality = normalizeQuality(input.dataQuality) ?? normalizeQuality(input.body?.dataQuality) ?? 'unavailable';
    const buildState = normalizeBuildState(input.buildState) ?? normalizeBuildState(input.body?.buildState) ?? 'idle';
    const dataSource = input.dataSource || (typeof input.body?.dataSource === 'string' ? input.body.dataSource : 'unknown');
    const bodyIsStale = typeof input.body?.isStale === 'boolean' ? input.body.isStale : undefined;
    const bodyIsFallback = typeof input.body?.isFallback === 'boolean' ? input.body.isFallback : undefined;
    const isStale = input.isStale ?? bodyIsStale ?? (dataQuality === 'stale' || buildState === 'stale');
    const isFallback = input.isFallback ?? bodyIsFallback ?? dataSource.includes('fallback');
    const errorKind = normalizeErrorKind(input.errorKind) ?? normalizeErrorKind(input.body?.errorKind);
    const isUnavailable = hasExplicitQuality && (dataQuality === 'unavailable' || buildState === 'failed');
    const isDegraded = hasExplicitQuality && (isUnavailable ||
        dataQuality === 'partial' ||
        dataQuality === 'lightweight' ||
        dataQuality === 'stale' ||
        dataQuality === 'degraded' ||
        buildState === 'building' ||
        buildState === 'stale' ||
        Boolean(isStale) ||
        Boolean(isFallback));

    const message = !hasExplicitQuality
        ? undefined
        : dataQuality === 'lightweight'
        ? '市场数据为轻量模式，部分策略字段暂不可用'
        : buildState === 'building'
            ? '正在重建完整市场数据，当前结果可能不完整'
            : Boolean(isStale) || dataQuality === 'stale'
                ? '正在使用旧缓存'
                : dataQuality === 'partial' || dataQuality === 'degraded'
                    ? '部分外部数据源失败，结果已降级'
                    : isUnavailable
                        ? '数据源暂不可用'
                        : undefined;

    return {
        dataQuality,
        buildState,
        dataSource,
        isStale: Boolean(isStale),
        isFallback: Boolean(isFallback),
        isDegraded,
        isUnavailable,
        errorKind,
        message,
    };
}
