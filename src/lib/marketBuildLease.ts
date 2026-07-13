export class MarketBuildLeaseUnavailableError extends Error {}

export interface RenewableLease {
    acquire(key: string, ttlMs: number): Promise<string | null>;
    renew(key: string, owner: string, ttlMs: number): Promise<boolean>;
    isOwner(key: string, owner: string): Promise<boolean>;
    release(key: string, owner: string): Promise<void>;
}

export async function runFencedMarketBuild<T>(options: {
    lease: RenewableLease;
    key: string;
    ttlMs: number;
    renewIntervalMs: number;
    build: () => Promise<T>;
    onRenewError?: (error: unknown) => void;
    onReleaseError?: (error: unknown) => void;
}): Promise<T> {
    const owner = await options.lease.acquire(options.key, options.ttlMs);
    if (!owner) throw new MarketBuildLeaseUnavailableError('Full market build lease is held by another instance');

    let ownershipLost = false;
    const renewal = setInterval(() => {
        void options.lease.renew(options.key, owner, options.ttlMs)
            .then((renewed) => {
                if (!renewed) ownershipLost = true;
            })
            .catch((error) => {
                ownershipLost = true;
                options.onRenewError?.(error);
            });
    }, options.renewIntervalMs);
    renewal.unref?.();

    try {
        const snapshot = await options.build();
        if (ownershipLost || !await options.lease.isOwner(options.key, owner)) {
            throw new Error('Market build lease ownership was lost before shared snapshot commit');
        }
        return snapshot;
    } finally {
        clearInterval(renewal);
        await options.lease.release(options.key, owner).catch((error) => {
            options.onReleaseError?.(error);
        });
    }
}
