export async function withTimeout<T>(
    promise: Promise<T>,
    timeoutMs: number,
    label: string
): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;

    const timeoutPromise = new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
            reject(new Error(`${label} timed out after ${timeoutMs}ms`));
        }, timeoutMs);
    });

    try {
        return await Promise.race([promise, timeoutPromise]);
    } finally {
        if (timer) {
            clearTimeout(timer);
        }
    }
}
