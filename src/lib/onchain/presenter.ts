export function buildOnchainStorageKey(query: string) {
    return `persistent-swr:v3:onchain:${query}:default`;
}
