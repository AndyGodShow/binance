export type WorkspaceMarketTab = 'dashboard' | 'leaderboard' | 'macro' | 'watchlists'
    | 'longshort' | 'onchain' | 'strategies' | 'trading';

export interface WorkspaceMarketPolicy {
    runLiveMarketRequests: boolean;
    runHeavyMarketRequests: boolean;
    runDeferredIndicatorRequests: boolean;
    runLeaderboardRequests: boolean;
    heavyMarketEndpoint: '/api/market' | '/api/market/strategy';
}

export function resolveWorkspaceMarketPolicy(activeTab: WorkspaceMarketTab): WorkspaceMarketPolicy {
    const runLiveMarketRequests = activeTab !== 'trading';

    return {
        runLiveMarketRequests,
        runHeavyMarketRequests: runLiveMarketRequests,
        runDeferredIndicatorRequests: runLiveMarketRequests && activeTab !== 'strategies',
        runLeaderboardRequests: activeTab === 'dashboard' || activeTab === 'leaderboard',
        heavyMarketEndpoint: activeTab === 'strategies' ? '/api/market/strategy' : '/api/market',
    };
}
