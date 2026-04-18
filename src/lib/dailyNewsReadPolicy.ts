export function shouldGenerateDailyNewsOnRead(nodeEnv = process.env.NODE_ENV): boolean {
    return nodeEnv !== 'production';
}
