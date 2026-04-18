function isExplicitlyDisabled(value: string | undefined): boolean {
    if (!value) {
        return false;
    }

    return ['0', 'false', 'off', 'no'].includes(value.trim().toLowerCase());
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
