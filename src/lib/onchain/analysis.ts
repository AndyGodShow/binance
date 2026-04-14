import type {
    ChipAnalysis,
    ChipScoreBreakdownItem,
    HistoricalHoldersPoint,
    TokenHolderMetrics,
} from './types';

function clamp(value: number, min: number, max: number) {
    return Math.min(max, Math.max(min, value));
}

function pct(value: number) {
    return value < 1 ? value * 100 : value;
}

function formatPct(value: number) {
    return `${pct(value).toFixed(2)}%`;
}

function latestOrNull(points: HistoricalHoldersPoint[]) {
    return points.length > 0 ? points[points.length - 1] : null;
}

export function buildChipAnalysis(
    metrics: TokenHolderMetrics,
    historical: HistoricalHoldersPoint[]
): ChipAnalysis {
    const top10 = pct(metrics.holderSupply.top10.supplyPercent);
    const top50 = pct(metrics.holderSupply.top50.supplyPercent);
    const top100 = pct(metrics.holderSupply.top100.supplyPercent);
    const whales = metrics.holderDistribution.whales;
    const sharks = metrics.holderDistribution.sharks;
    const shrimps = metrics.holderDistribution.shrimps;
    const latest = latestOrNull(historical);
    const change7d = metrics.holderChange['7d'].changePercent;
    const change30d = metrics.holderChange['30d'].changePercent;
    const acquisitionSwap = metrics.holdersByAcquisition.swap;

    const breakdown: ChipScoreBreakdownItem[] = [
        {
            id: 'top10',
            label: 'Top10 占比',
            score: Math.round(Math.sqrt(top10) * 2.2),
            value: formatPct(metrics.holderSupply.top10.supplyPercent),
            rationale: '前十大地址占比越高，控筹强度越高。',
            tone: 'positive',
        },
        {
            id: 'top50',
            label: 'Top50 占比',
            score: Math.round(Math.sqrt(top50) * 1.4),
            value: formatPct(metrics.holderSupply.top50.supplyPercent),
            rationale: 'Top50 能看出头部筹码是否在更大范围内继续集中。',
            tone: 'positive',
        },
        {
            id: 'top100',
            label: 'Top100 占比',
            score: Math.round(Math.sqrt(top100) * 0.9),
            value: formatPct(metrics.holderSupply.top100.supplyPercent),
            rationale: 'Top100 反映中大户层面的持仓集中程度。',
            tone: 'positive',
        },
        {
            id: 'whales',
            label: '鲸鱼数量',
            score: Math.round(Math.min(Math.sqrt(whales) * 3, 18)),
            value: `${whales}`,
            rationale: '鲸鱼越多，越需要观察是否形成抱团和一致性行为。',
            tone: 'positive',
        },
        {
            id: 'holderChange',
            label: '7d 持币地址变化',
            score: Math.round(clamp(change7d * 0.8, -12, 12)),
            value: `${change7d.toFixed(2)}%`,
            rationale: '持币地址持续扩张通常说明筹码在向外扩散。',
            tone: change7d >= 0 ? 'negative' : 'positive',
        },
        {
            id: 'swapAcquisition',
            label: 'Swap 获取占比',
            score: -Math.round(clamp(acquisitionSwap * 0.15, 0, 10)),
            value: `${acquisitionSwap.toFixed(2)}%`,
            rationale: '大量通过 swap 新增的持仓，往往意味着更活跃的流动筹码。',
            tone: acquisitionSwap >= 45 ? 'negative' : 'neutral',
        },
    ];

    const chipScore = Math.round(clamp(
        breakdown.reduce((sum, item) => sum + item.score, 10),
        0,
        100
    ));

    const controlLevel = chipScore >= 68 ? '高度控筹' : chipScore >= 45 ? '中度集中' : '相对分散';
    const distributionLevel = (whales + sharks) > shrimps ? '头部集中' : shrimps > whales * 6 ? '长尾分散' : '中段扎实';
    const trendLevel = change30d >= 12 ? '持续扩散' : change7d >= 3 ? '温和扩散' : latest && latest.netHolderChange < -80 ? '可能派发' : '趋于稳定';

    return {
        chipScore,
        controlLevel,
        distributionLevel,
        trendLevel,
        breakdown,
        summaryCards: [
            {
                title: '控筹强度',
                value: controlLevel,
                description: `Top10 ${formatPct(metrics.holderSupply.top10.supplyPercent)}，Top50 ${formatPct(metrics.holderSupply.top50.supplyPercent)}。`,
            },
            {
                title: '筹码分层',
                value: distributionLevel,
                description: `Whales ${whales} / Sharks ${sharks} / Shrimps ${shrimps}。`,
            },
            {
                title: '持币趋势',
                value: trendLevel,
                description: `7d ${change7d.toFixed(2)}%，30d ${change30d.toFixed(2)}%。`,
            },
        ],
        insights: [
            chipScore >= 72
                ? '前排地址占比很高，这类币更像由少数地址主导，弹性和抛压都更强。'
                : '头部地址占比还没有到极端，筹码集中度处于更可观察的中段。',
            acquisitionSwap >= 45
                ? '新增筹码更多来自 swap，说明流动交易盘偏多，短线波动可能更大。'
                : '新增筹码来源没有过度偏向 swap，更像自然扩散。',
            latest && latest.netHolderChange < 0
                ? '最近一期净持币地址在回落，需要警惕派发或热度降温。'
                : '最近一期持币地址没有明显恶化，结构相对稳定。',
        ],
    };
}
