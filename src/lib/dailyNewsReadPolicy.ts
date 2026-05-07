function isExplicitlyDisabled(value: string | undefined): boolean {
    if (!value) {
        return false;
    }

    return ['0', 'false', 'off', 'no'].includes(value.trim().toLowerCase());
}

const DEFAULT_DAILY_NEWS_MAX_AGE_MS = 2 * 60 * 60 * 1000;

export function getDailyNewsMaxAgeMs(value = process.env.DAILY_NEWS_MAX_AGE_MS): number {
    if (!value) {
        return DEFAULT_DAILY_NEWS_MAX_AGE_MS;
    }

    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) {
        return DEFAULT_DAILY_NEWS_MAX_AGE_MS;
    }

    return parsed;
}

export function isDailyNewsDigestStale(
    generatedAt: string | undefined,
    now = new Date(),
    maxAgeMs = getDailyNewsMaxAgeMs()
): boolean {
    if (!generatedAt) {
        return true;
    }

    const generatedAtMs = new Date(generatedAt).getTime();
    if (!Number.isFinite(generatedAtMs)) {
        return true;
    }

    return now.getTime() - generatedAtMs >= maxAgeMs;
}

export function shouldGenerateDailyNewsOnRead(
    nodeEnv = process.env.NODE_ENV,
    override = process.env.DAILY_NEWS_GENERATE_ON_READ
): boolean {
    void nodeEnv;

    if (isExplicitlyDisabled(override)) {
        return false;
    }

    return true;
}
