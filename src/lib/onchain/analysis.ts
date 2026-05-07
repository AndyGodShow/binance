import type {
    StructureObservation,
    OnchainDataQuality,
    HistoricalHoldersPoint,
    HolderConcentrationAnalysis,
    TokenHolderMetrics,
    TopHolderItem,
} from './types';

function pct(value: number) {
    return value < 1 ? value * 100 : value;
}

function percentValue(value: number) {
    if (!Number.isFinite(value)) {
        return 0;
    }

    return pct(value);
}

function formatPct(value: number) {
    return `${percentValue(value).toFixed(2)}%`;
}

function latestOrNull(points: HistoricalHoldersPoint[]) {
    return points.length > 0 ? points[points.length - 1] : null;
}

function isKnownNonUserHolder(holder: TopHolderItem) {
    const address = holder.address.toLowerCase();
    const descriptor = `${holder.label ?? ''} ${holder.entity ?? ''}`.toLowerCase();

    if (holder.isContract) {
        return true;
    }

    if (/^0x0{20,}$/.test(address) || address.includes('000000000000000000000000000000000000dead')) {
        return true;
    }

    return [
        'burn',
        'dead',
        'null address',
        'black hole',
        'uniswap',
        'pancake',
        'sushiswap',
        'pair',
        'pool',
        'liquidity',
        'router',
        'bridge',
        'binance',
        'coinbase',
        'okx',
        'bybit',
        'kraken',
        'kucoin',
        'gate.io',
        'mexc',
        'exchange',
    ].some((keyword) => descriptor.includes(keyword));
}

export function buildOnchainDataQuality(
    metrics: TokenHolderMetrics | null,
    historical: HistoricalHoldersPoint[],
    topHolders: TopHolderItem[]
): OnchainDataQuality {
    const warnings: string[] = [];
    const topHolderCoveragePercent = topHolders.length > 0
        ? topHolders.reduce((sum, holder) => sum + holder.percentage, 0)
        : null;
    const flaggedTopHolderSharePercent = topHolders
        .filter(isKnownNonUserHolder)
        .reduce((sum, holder) => sum + holder.percentage, 0);
    const invalidTopHolderPercentages = topHolders.filter((holder) => (
        !Number.isFinite(holder.percentage) || holder.percentage < 0 || holder.percentage > 100
    ));
    const top5HolderCoveragePercent = topHolders
        .slice(0, 5)
        .reduce((sum, holder) => sum + holder.percentage, 0);
    const supplyPercents = [
        metrics?.holderSupply.top10.supplyPercent,
        metrics?.holderSupply.top25.supplyPercent,
        metrics?.holderSupply.top50.supplyPercent,
        metrics?.holderSupply.top100.supplyPercent,
        metrics?.holderSupply.top250.supplyPercent,
        metrics?.holderSupply.top500.supplyPercent,
    ].filter((value): value is number => value !== undefined).map(percentValue);
    const hasInvalidSupplyBucket = supplyPercents.some((value) => value < 0 || value > 100);
    const hasNonMonotonicSupplyBucket = supplyPercents.some((value, index) => (
        index > 0 && value + 0.000001 < supplyPercents[index - 1]
    ));

    if (!metrics || metrics.totalHolders <= 0) {
        warnings.push('没有拿到有效 holder metrics，当前不能生成可靠筹码分布。');
    }

    if (topHolders.length === 0) {
        warnings.push('数据源没有返回 Top holders 明细，无法校验头部地址是否包含交易所、LP、销毁或合约地址。');
    } else if (topHolders.length < 5) {
        warnings.push('Top holders 明细少于 5 个，头部筹码覆盖不完整。');
    }

    if (flaggedTopHolderSharePercent >= 5) {
        warnings.push(`Top holders 中约 ${flaggedTopHolderSharePercent.toFixed(2)}% 属于合约、LP、交易所、销毁等非普通持仓地址，原始地址集中度可能被高估。`);
    }

    if (invalidTopHolderPercentages.length > 0 || (topHolderCoveragePercent !== null && topHolderCoveragePercent > 100.000001)) {
        warnings.push(`Top holders 明细占比合计约 ${topHolderCoveragePercent?.toFixed(2) ?? '--'}%，超过 100%，说明上游 holder 明细与总供应量口径不一致或返回了异常读数。`);
    } else if (top5HolderCoveragePercent > 100.000001) {
        warnings.push(`Top5 地址占比合计约 ${top5HolderCoveragePercent.toFixed(2)}%，超过 100%，这组头部地址明细不能生成链上结构观察。`);
    }

    if (hasInvalidSupplyBucket || hasNonMonotonicSupplyBucket) {
        warnings.push('holderSupply 聚合桶出现越界或顺序异常，Top10/Top50/Top100 指标需要等待数据源刷新后再复核。');
    }

    if (historical.length > 0 && historical.length < 7) {
        warnings.push('历史持币序列少于 7 天，只能观察快照，趋势判断可信度较低。');
    }

    let confidence: OnchainDataQuality['confidence'] = '高';
    if (!metrics || metrics.totalHolders <= 0 || topHolders.length === 0) {
        confidence = '低';
    } else if (
        invalidTopHolderPercentages.length > 0
        || (topHolderCoveragePercent !== null && topHolderCoveragePercent > 100.000001)
        || top5HolderCoveragePercent > 100.000001
        || hasInvalidSupplyBucket
        || hasNonMonotonicSupplyBucket
    ) {
        confidence = '低';
    } else if (topHolders.length < 5 || historical.length < 7 || flaggedTopHolderSharePercent >= 5) {
        confidence = '中';
    }

    const summary = confidence === '高'
        ? 'holder metrics、Top holders 与历史序列都较完整，可以作为较可靠的筹码结构参考。'
        : confidence === '中'
            ? '链上主数据可用，但存在地址污染或历史覆盖不足，只能结合 Top holders 明细做原始观察。'
            : '关键校验数据缺失，当前只能作为粗略市场快照，不能当作准确筹码分布。';

    return {
        confidence,
        summary,
        topHoldersCount: topHolders.length,
        historicalDays: historical.length,
        topHolderCoveragePercent,
        flaggedTopHolderSharePercent,
        warnings,
    };
}

export function buildStructureObservation(
    metrics: TokenHolderMetrics,
    historical: HistoricalHoldersPoint[],
    holderConcentration?: HolderConcentrationAnalysis
): StructureObservation {
    const top10 = holderConcentration?.floatTop10 ?? percentValue(metrics.holderSupply.top10.supplyPercent);
    const top5 = holderConcentration?.floatTop5 ?? null;
    const whales = metrics.holderDistribution.whales;
    const sharks = metrics.holderDistribution.sharks;
    const shrimps = metrics.holderDistribution.shrimps;
    const latest = latestOrNull(historical);
    const change7d = metrics.holderChange['7d'].changePercent;
    const change30d = metrics.holderChange['30d'].changePercent;
    const acquisitionSwap = metrics.holdersByAcquisition.swap;

    const concentrationLevel = top10 >= 60
        ? '原始地址高度集中'
        : top10 >= 25
            ? '原始地址中度集中'
            : '原始地址相对分散';
    const distributionLevel = (whales + sharks) > shrimps ? '头部集中' : shrimps > whales * 6 ? '长尾分散' : '中段扎实';
    const trendLevel = change30d >= 12 || change7d >= 3
        ? '地址数量扩张'
        : latest && latest.netHolderChange < -80
            ? '地址数量回落'
            : '地址数量稳定';

    return {
        concentrationLevel,
        distributionLevel,
        trendLevel,
        summaryCards: [
            {
                title: holderConcentration ? '净化后集中度' : '原始地址集中度',
                value: concentrationLevel,
                description: holderConcentration
                    ? `净化后 Top5 ${top5 === null ? '--' : `${top5.toFixed(2)}%`}，Top10 ${top10 === null ? '--' : `${top10.toFixed(2)}%`}。`
                    : `原始 Top10 ${formatPct(metrics.holderSupply.top10.supplyPercent)}。`,
            },
            {
                title: '地址分层',
                value: distributionLevel,
                description: `Whales ${whales} / Sharks ${sharks} / Shrimps ${shrimps}。`,
            },
            {
                title: '地址数量变化',
                value: trendLevel,
                description: `7d ${change7d.toFixed(2)}%，30d ${change30d.toFixed(2)}%。`,
            },
        ],
        insights: [
            holderConcentration
                ? `净化后集中度已剔除疑似非流通/基础设施地址；未知地址占比约 ${holderConcentration.unknownSharePercent.toFixed(2)}%，该结果依赖标签质量。`
                : `${concentrationLevel}：该读数仍包含未净化的交易所、LP、销毁、合约或项目方地址，需要结合 Top holders 标签复核。`,
            acquisitionSwap >= 45
                ? '新增地址来源中 swap 占比较高，只能说明 DEX 交互更活跃，不能推导价格方向。'
                : '新增地址来源没有明显偏向 swap，当前只作为地址行为来源参考。',
            latest && latest.netHolderChange < 0
                ? '最近一期持币地址数回落，只能说明地址数量减少，不能直接解释为筹码迁移。'
                : '最近一期持币地址数没有明显回落，仍需结合地址标签和交易流复核。',
        ],
    };
}
