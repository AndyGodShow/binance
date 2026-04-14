import type {
    ChipAnalysis,
    HistoricalHoldersPoint,
    TokenHolderMetrics,
    TokenSearchResult,
} from './types';

export function buildOnchainStorageKey(query: string) {
    return `persistent-swr:v2:onchain:${query}:default`;
}

export function buildExecutiveSummary(
    token: TokenSearchResult,
    metrics: TokenHolderMetrics,
    analysis: ChipAnalysis
) {
    const top10 = metrics.holderSupply.top10.supplyPercent < 1
        ? metrics.holderSupply.top10.supplyPercent * 100
        : metrics.holderSupply.top10.supplyPercent;
    const change7d = metrics.holderChange['7d'].changePercent;
    const tailShare = metrics.holderDistribution.shrimps;
    const whaleShare = metrics.holderDistribution.whales + metrics.holderDistribution.sharks;
    const breadthLabel = tailShare > whaleShare * 10 ? '筹码长尾明显' : whaleShare > tailShare ? '头部抱团明显' : '中段承接存在';
    const trendLabel = change7d >= 3 ? '持币人数仍在扩散' : change7d <= -1 ? '持币人数开始回落' : '持币人数趋于稳定';

    return `${token.symbol} 当前属于${analysis.controlLevel}，Top10 占比 ${top10.toFixed(2)}%，${breadthLabel}，${trendLabel}。`;
}

export function buildVisibleHistory(points: HistoricalHoldersPoint[], limit = 7) {
    const sorted = [...points].sort((a, b) => (
        new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
    ));

    return sorted.slice(-limit);
}
