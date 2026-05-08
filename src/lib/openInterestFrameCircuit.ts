export function createOpenInterestFrameCircuitBreaker(failureThreshold: number, cooldownMs: number) {
    let consecutiveFailures = 0;
    let pausedUntil = 0;

    return {
        canRequest(now = Date.now()): boolean {
            return now >= pausedUntil;
        },
        recordSuccess(): void {
            consecutiveFailures = 0;
            pausedUntil = 0;
        },
        recordFailure(now = Date.now()): void {
            consecutiveFailures += 1;
            if (consecutiveFailures >= failureThreshold) {
                pausedUntil = now + cooldownMs;
            }
        },
        getState() {
            return { consecutiveFailures, pausedUntil };
        },
    };
}
