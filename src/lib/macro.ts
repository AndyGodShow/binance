export { BTC_LONG_SHORT_RATIO_PERIOD } from './macroTypes.ts';
export type * from './macroTypes.ts';
import type {
    MacroSourceAsset,
    MacroAssetSession,
    BtcEtfFlowSnapshot,
    MacroSourcePayload,
    MacroBoardGroup,
    MacroMonitorCard,
    MacroSourceStatus,
    MacroUsEquityGroupSummary,
    MacroUsEquitiesDashboard,
    MacroEquityObserverDashboard,
    MacroFreshnessTarget,
} from './macroTypes.ts';



export function classifyMacroFreshness(
    dataTimestamp: string | undefined,
    nowMs = Date.now(),
    target: MacroFreshnessTarget = 'intraday'
): MacroSourceStatus['freshness'] {
    if (!dataTimestamp) {
        return 'unknown';
    }

    const parsed = Date.parse(dataTimestamp);
    if (!Number.isFinite(parsed)) {
        return 'unknown';
    }

    const ageMs = Math.max(0, nowMs - parsed);
    if (target === 'realtime') {
        return ageMs <= 5 * 60 * 1000 ? 'realtime' : ageMs <= 24 * 60 * 60 * 1000 ? 'intraday' : 'stale';
    }
    if (target === 'daily') {
        return ageMs <= 3 * 24 * 60 * 60 * 1000 ? 'daily' : 'stale';
    }
    return ageMs <= 24 * 60 * 60 * 1000 ? 'intraday' : 'stale';
}

function getEtfProviderPriority(provider?: string): number {
    if (provider === 'Bitbo API') return 3;
    if (provider === 'Bitbo') return 2;
    if (provider === 'Farside') return 1;
    return 0;
}

export function selectFreshestBtcEtfFlow(snapshots: Array<BtcEtfFlowSnapshot | undefined>): BtcEtfFlowSnapshot | undefined {
    return snapshots
        .filter((snapshot): snapshot is BtcEtfFlowSnapshot => Boolean(snapshot))
        .sort((left, right) => {
            const dateComparison = right.date.localeCompare(left.date);
            if (dateComparison !== 0) {
                return dateComparison;
            }
            return getEtfProviderPriority(right.provider) - getEtfProviderPriority(left.provider);
        })[0];
}

export function buildEtfFlowSourceStatus(input: {
    snapshot?: BtcEtfFlowSnapshot;
    primaryAvailable: boolean;
    secondaryAvailable: boolean;
}): MacroSourceStatus {
    if (!input.snapshot) {
        return {
            key: 'etf',
            label: 'ETF 资金流',
            provider: 'Unavailable',
            status: 'unavailable',
            detail: 'ETF flow 当前不可用',
            freshness: 'unknown',
        };
    }

    const detailParts = [input.snapshot.date];
    if (!input.primaryAvailable && input.secondaryAvailable) {
        detailParts.push('主源不可用，正在使用备用 ETF 数据源');
    } else if (!['Bitbo API', 'Bitbo'].includes(input.snapshot.provider || '') && input.primaryAvailable) {
        detailParts.push('备用源更新更靠前');
    }
    if (input.primaryAvailable && input.secondaryAvailable) {
        detailParts.push('备用源已交叉拉取');
    }

    return {
        key: 'etf',
        label: 'ETF 资金流',
        provider: input.snapshot.provider || 'Unknown',
        status: input.primaryAvailable ? 'live' : 'fallback',
        detail: detailParts.join(' · '),
        dataTimestamp: input.snapshot.date,
        freshness: 'daily',
    };
}

export interface MacroDashboardData {
    updatedAt: string;
    dataQuality?: 'enriched' | 'partial' | 'degraded' | 'unavailable';
    groups: MacroBoardGroup[];
    regime: {
        code: 'RISK_ON' | 'NEUTRAL' | 'RISK_OFF';
        label: string;
        score: number;
        statusLine: string;
        summary: string;
    };
    monitors: {
        fearGreed: MacroMonitorCard;
        vix: MacroMonitorCard;
        dxy: MacroMonitorCard;
        us10y: MacroMonitorCard;
        ethBtc: MacroMonitorCard;
    };
    btc: {
        price: number;
        changePercent: number;
        high24h: number;
        low24h: number;
        funding: MacroMonitorCard;
        lsRatio: MacroMonitorCard;
    };
    etfFlow?: BtcEtfFlowSnapshot;
    usEquities: MacroUsEquitiesDashboard;
    hkEquities: MacroEquityObserverDashboard;
    aShareEquities: MacroEquityObserverDashboard;
    insights: string[];
    sourceStatus: MacroSourceStatus[];
}

type PersistedMacroDashboardData = Omit<Partial<MacroDashboardData>, 'etfFlow' | 'usEquities' | 'hkEquities' | 'aShareEquities'> & {
    etfFlow?: Partial<BtcEtfFlowSnapshot>;
    usEquities?: Partial<MacroUsEquitiesDashboard>;
    hkEquities?: Partial<MacroEquityObserverDashboard>;
    aShareEquities?: Partial<MacroEquityObserverDashboard>;
};


export const DIGITAL_ASSET_ETF_ASSETS = [
    { symbol: 'IBIT', label: 'BTC现货ETF', market: '数字资产 ETF' },
    { symbol: 'ETHA', label: 'ETH现货ETF', market: '数字资产 ETF' },
    { symbol: 'BSOL', label: 'SOL质押ETF', market: '数字资产 ETF' },
    { symbol: 'XRPC', label: 'XRP现货ETF', market: '数字资产 ETF' },
] as const;

const MACRO_GROUPS: Array<{ title: string; markets: string[] }> = [
    { title: '美股', markets: ['美股'] },
    { title: '大宗商品', markets: ['大宗商品', '大宗'] },
    { title: '数字资产 ETF', markets: ['数字资产 ETF', '比特币 ETF'] },
    { title: '中韩日指数', markets: ['中韩日指数', '韩日指数'] },
];

const US_EQUITY_GROUPS: Array<{ title: string; markets: string[] }> = [
    { title: '七姐妹', markets: ['七姐妹'] },
    { title: 'AI半导体', markets: ['AI半导体', 'AI 半导体', '半导体AI', '半导体 AI'] },
    { title: '多空杠杆 ETF/ETN', markets: ['多空杠杆 ETF/ETN', '多空杠杆 ETF'] },
    { title: '加密相关股', markets: ['加密相关股'] },
    { title: '中概观察', markets: ['中概观察'] },
    { title: '板块总览', markets: ['板块总览'] },
];

const CHINA_EQUITY_GROUPS: Array<{ title: string; markets: string[] }> = [
    { title: '指数/宽基', markets: ['指数/宽基', '指数宽基'] },
    { title: '科技互联网', markets: ['科技互联网'] },
    { title: '金融地产', markets: ['金融地产'] },
    { title: '汽车新能源', markets: ['汽车新能源'] },
    { title: '半导体AI', markets: ['半导体AI', '半导体 AI'] },
    { title: '消费医药', markets: ['消费医药'] },
    { title: '资源公用', markets: ['资源公用'] },
];

function clampScore(score: number): number {
    return Math.max(-5, Math.min(5, score));
}

function classifyFearGreed(value: number): Pick<MacroMonitorCard, 'statusLabel' | 'tone' | 'hint'> {
    if (value <= 25) {
        return { statusLabel: '恐惧', tone: 'negative', hint: '0-25 极度恐惧 / 75-100 极度贪婪' };
    }
    if (value >= 75) {
        return { statusLabel: '贪婪', tone: 'positive', hint: '0-25 极度恐惧 / 75-100 极度贪婪' };
    }
    return { statusLabel: '中性', tone: 'neutral', hint: '0-25 极度恐惧 / 75-100 极度贪婪' };
}

function classifyVix(value: number): Pick<MacroMonitorCard, 'statusLabel' | 'tone' | 'hint'> {
    if (value >= 35) {
        return { statusLabel: '极度恐慌', tone: 'negative', hint: '<15 平静 / 19.5-25 偏高 / ≥25 高位 / ≥35 极度恐慌' };
    }
    if (value >= 25) {
        return { statusLabel: '高位', tone: 'negative', hint: '<15 平静 / 19.5-25 偏高 / ≥25 高位 / ≥35 极度恐慌' };
    }
    if (value >= 19.5) {
        return { statusLabel: '偏高', tone: 'negative', hint: '<15 平静 / 19.5-25 偏高 / ≥25 高位 / ≥35 极度恐慌' };
    }
    if (value < 15) {
        return { statusLabel: '平静', tone: 'positive', hint: '<15 平静 / 19.5-25 偏高 / ≥25 高位 / ≥35 极度恐慌' };
    }
    return { statusLabel: '正常', tone: 'neutral', hint: '<15 平静 / 19.5-25 偏高 / ≥25 高位 / ≥35 极度恐慌' };
}

function classifyDxy(value: number): Pick<MacroMonitorCard, 'statusLabel' | 'tone' | 'hint'> {
    if (value > 105) {
        return { statusLabel: '强势', tone: 'negative', hint: '>105 强势压制加密 / <100 弱势利好加密' };
    }
    if (value < 100) {
        return { statusLabel: '弱势', tone: 'positive', hint: '>105 强势压制加密 / <100 弱势利好加密' };
    }
    return { statusLabel: '中性', tone: 'neutral', hint: '>105 强势压制加密 / <100 弱势利好加密' };
}

function classifyUs10y(value: number): Pick<MacroMonitorCard, 'statusLabel' | 'tone' | 'hint'> {
    if (value > 4.2) {
        return { statusLabel: '偏紧', tone: 'negative', hint: '>4.2% 偏紧环境 / <3.5% 宽松环境' };
    }
    if (value < 3.5) {
        return { statusLabel: '宽松', tone: 'positive', hint: '>4.2% 偏紧环境 / <3.5% 宽松环境' };
    }
    return { statusLabel: '中性', tone: 'neutral', hint: '>4.2% 偏紧环境 / <3.5% 宽松环境' };
}

function classifyFunding(value: number): Pick<MacroMonitorCard, 'statusLabel' | 'tone' | 'hint'> {
    if (value > 0.03) {
        return { statusLabel: '多头拥挤', tone: 'negative', hint: '>0.03% 多头拥挤 / <-0.03% 空头拥挤' };
    }
    if (value < -0.03) {
        return { statusLabel: '空头拥挤', tone: 'positive', hint: '>0.03% 多头拥挤 / <-0.03% 空头拥挤' };
    }
    return { statusLabel: '中性', tone: 'neutral', hint: '>0.03% 多头拥挤 / <-0.03% 空头拥挤' };
}

function classifyLsRatio(value: number): Pick<MacroMonitorCard, 'statusLabel' | 'tone' | 'hint'> {
    if (value >= 2.5) {
        return { statusLabel: '散户重多', tone: 'negative', hint: '>2.5 散户极多 / <1.0 大户偏多' };
    }
    if (value <= 1.0) {
        return { statusLabel: '大户偏多', tone: 'positive', hint: '>2.5 散户极多 / <1.0 大户偏多' };
    }
    return { statusLabel: '中性', tone: 'neutral', hint: '>2.5 散户极多 / <1.0 大户偏多' };
}

function classifyEthBtc(changePercent: number): Pick<MacroMonitorCard, 'statusLabel' | 'tone' | 'hint'> {
    if (changePercent >= 1.5) {
        return { statusLabel: '山寨发力', tone: 'positive', hint: '涨幅过大代表风险偏好极强' };
    }
    if (changePercent <= -1.5) {
        return { statusLabel: '资金吸血', tone: 'negative', hint: '跌幅过大代表资金回流 BTC 避险' };
    }
    return { statusLabel: '跟随震荡', tone: 'neutral', hint: '波动平稳，等待方向' };
}

function formatSignedPercent(value: number, fractionDigits = 2): string {
    const sign = value > 0 ? '+' : '';
    return `${sign}${value.toFixed(fractionDigits)}%`;
}

function buildBoardGroups(
    assets: Record<string, MacroSourceAsset>,
    groups: Array<{ title: string; markets: string[] }>
): MacroBoardGroup[] {
    return groups.map((group) => ({
        title: group.title,
        items: Object.values(assets)
            .filter((asset) => group.markets.includes(asset.market))
            .map((asset) => ({
                symbol: asset.symbol,
                displaySymbol: asset.label,
                market: asset.market,
                price: asset.price,
                changePercent: asset.changePercent,
                performance: asset.performance,
                session: asset.session,
            })),
    })).filter((group) => group.items.length > 0);
}

function buildGroups(assets: Record<string, MacroSourceAsset>): MacroBoardGroup[] {
    return buildBoardGroups(assets, MACRO_GROUPS);
}

function summarizeEquityGroup(group: MacroBoardGroup): MacroUsEquityGroupSummary {
    const totalChange = group.items.reduce((sum, item) => sum + item.changePercent, 0);
    return {
        title: group.title,
        averageChangePercent: group.items.length > 0 ? totalChange / group.items.length : 0,
        advancers: group.items.filter((item) => item.changePercent > 0).length,
        decliners: group.items.filter((item) => item.changePercent < 0).length,
        totalCount: group.items.length,
    };
}

function buildEquitiesDashboard(
    assets: Record<string, MacroSourceAsset> = {},
    groupConfig: Array<{ title: string; markets: string[] }> = US_EQUITY_GROUPS
): MacroEquityObserverDashboard {
    const groups = buildBoardGroups(assets, groupConfig);
    const items = groups.flatMap((group) => group.items);
    const averageChangePercent = items.length > 0
        ? items.reduce((sum, item) => sum + item.changePercent, 0) / items.length
        : 0;
    const groupSummaries = groups.map(summarizeEquityGroup);
    const sessionItems = items.filter((item) => item.session);
    const latestSession = sessionItems
        .map((item) => item.session)
        .filter((session): session is MacroAssetSession => Boolean(session))
        .sort((left, right) => Date.parse(right.dataTimestamp || '') - Date.parse(left.dataTimestamp || ''))[0];

    return {
        groups,
        summary: {
            totalCount: items.length,
            advancers: items.filter((item) => item.changePercent > 0).length,
            decliners: items.filter((item) => item.changePercent < 0).length,
            averageChangePercent,
            strongest: [...items].sort((left, right) => right.changePercent - left.changePercent)[0],
            weakest: [...items].sort((left, right) => left.changePercent - right.changePercent)[0],
            strongestGroup: [...groupSummaries].sort((left, right) => right.averageChangePercent - left.averageChangePercent)[0],
            weakestGroup: [...groupSummaries].sort((left, right) => left.averageChangePercent - right.averageChangePercent)[0],
        },
        session: latestSession
            ? {
                label: latestSession.label,
                state: latestSession.state,
                activeCount: sessionItems.length,
                dataTimestamp: latestSession.dataTimestamp,
            }
            : undefined,
    };
}

function buildUsEquitiesDashboard(assets: Record<string, MacroSourceAsset> = {}): MacroUsEquitiesDashboard {
    return buildEquitiesDashboard(assets, US_EQUITY_GROUPS);
}

function buildChinaEquitiesDashboard(assets: Record<string, MacroSourceAsset> = {}): MacroEquityObserverDashboard {
    return buildEquitiesDashboard(assets, CHINA_EQUITY_GROUPS);
}

function computeMomentumScore(payload: MacroSourcePayload): number {
    const tracked = [
        '^GSPC',
        '^IXIC',
        '^NDX',
        'SPY',
        'QQQ',
        ...DIGITAL_ASSET_ETF_ASSETS.map((asset) => asset.symbol),
        '000001.SS',
        '^KS11',
        '^N225',
    ];
    const changes = tracked
        .map((symbol) => payload.assets[symbol]?.changePercent)
        .filter((value): value is number => Number.isFinite(value));

    if (changes.length === 0) {
        return 0;
    }

    const averageChange = (changes.reduce((sum, value) => sum + value, 0) + payload.btc.changePercent) / (changes.length + 1);

    if (averageChange >= 0.8) return 2;
    if (averageChange >= 0.2) return 1;
    if (averageChange <= -0.8) return -2;
    if (averageChange <= -0.2) return -1;
    return 0;
}

function computeRegime(payload: MacroSourcePayload) {
    const vix = payload.assets['^VIX']?.price ?? 0;
    const dxy = payload.assets['DX-Y.NYB']?.price ?? 0;
    const us10y = payload.assets['^TNX']?.price ?? 0;

    let score = computeMomentumScore(payload);

    if (payload.fearGreed.value <= 25) score -= 1;
    else if (payload.fearGreed.value >= 75) score += 1;

    if (vix >= 25) score -= 1;
    else if (vix < 15) score += 1;

    if (dxy > 105) score -= 1;
    else if (dxy < 100) score += 1;

    if (us10y > 4.2) score -= 1;
    else if (us10y < 3.5) score += 1;

    if (payload.btc.fundingRate > 0.03) score -= 1;
    else if (payload.btc.fundingRate < -0.03) score += 1;

    const finalScore = clampScore(score);

    if (finalScore >= 3) {
        return {
            code: 'RISK_ON' as const,
            label: '风险偏好',
            score: finalScore,
            statusLine: '偏进攻',
            summary: '多市场共振偏强，可考虑顺势提升风险敞口。',
        };
    }

    if (finalScore <= -3) {
        return {
            code: 'RISK_OFF' as const,
            label: '风险回避',
            score: finalScore,
            statusLine: '偏防守',
            summary: '避险与流动性压力占优，仓位应偏审慎。',
        };
    }

    return {
        code: 'NEUTRAL' as const,
        label: '中性震荡',
        score: finalScore,
        statusLine: '正常仓位',
        summary: '宏观多空信号交织，维持中性观察与结构性参与。',
    };
}

export function buildMacroDashboard(payload: MacroSourcePayload): MacroDashboardData {
    const fearGreedState = classifyFearGreed(payload.fearGreed.value);
    const vix = payload.assets['^VIX'];
    const dxy = payload.assets['DX-Y.NYB'];
    const us10y = payload.assets['^TNX'];
    const vixState = classifyVix(vix?.price ?? 0);
    const dxyState = classifyDxy(dxy?.price ?? 0);
    const us10yState = classifyUs10y(us10y?.price ?? 0);
    const ethBtcState = classifyEthBtc(payload.ethBtc.changePercent);
    const fundingState = classifyFunding(payload.btc.fundingRate);
    const lsRatioState = classifyLsRatio(payload.btc.longShortRatio);

    const riskAssetSummary = ['^GSPC', '^IXIC', '^NDX']
        .map((symbol) => payload.assets[symbol])
        .filter((asset): asset is MacroSourceAsset => Boolean(asset))
        .map((asset) => `${asset.label} ${formatSignedPercent(asset.changePercent)}`)
        .join(' / ');
    const legacyRiskAssetSummary = ['SPY', 'QQQ']
        .map((symbol) => payload.assets[symbol])
        .filter((asset): asset is MacroSourceAsset => Boolean(asset))
        .map((asset) => `${asset.label} ${formatSignedPercent(asset.changePercent)}`)
        .join(' / ');

    const insights = [
        riskAssetSummary
            ? `美股风险温度：${riskAssetSummary}。`
            : legacyRiskAssetSummary
                ? `美股风险温度：${legacyRiskAssetSummary}。`
                : undefined,
        payload.assets['DX-Y.NYB']
            ? `美元指数 ${payload.assets['DX-Y.NYB'].price.toFixed(2)}，${classifyDxy(payload.assets['DX-Y.NYB'].price).statusLabel}。`
            : undefined,
        payload.assets['^TNX']
            ? `10Y 美债在 ${(payload.assets['^TNX'].price).toFixed(3)}%，${classifyUs10y(payload.assets['^TNX'].price).statusLabel}。`
            : undefined,
        payload.etfFlow
            ? `ETF 最近一个交易日 ${payload.etfFlow.totalNetInflowUsdMillion >= 0 ? '净流入' : '净流出'} ${Math.abs(payload.etfFlow.totalNetInflowUsdMillion).toFixed(1)}M。`
            : 'ETF 资金流暂未拉到，建议以发行方或盘后统计交叉确认。',
    ].filter((item): item is string => Boolean(item));

    return {
        updatedAt: payload.updatedAt,
        groups: buildGroups(payload.assets),
        regime: computeRegime(payload),
        monitors: {
            fearGreed: {
                label: '恐惧与贪婪指数',
                value: payload.fearGreed.value,
                valueText: `${payload.fearGreed.value}`,
                hint: fearGreedState.hint,
                statusLabel: fearGreedState.statusLabel,
                tone: fearGreedState.tone,
            },
            vix: {
                label: 'VIX 恐慌指数',
                value: vix?.price ?? 0,
                valueText: (vix?.price ?? 0).toFixed(2),
                hint: vixState.hint,
                statusLabel: vixState.statusLabel,
                tone: vixState.tone,
            },
            dxy: {
                label: 'DXY 美元指数',
                value: dxy?.price ?? 0,
                valueText: (dxy?.price ?? 0).toFixed(2),
                hint: dxyState.hint,
                statusLabel: dxyState.statusLabel,
                tone: dxyState.tone,
                deltaText: dxy ? formatSignedPercent(dxy.changePercent) : undefined,
            },
            us10y: {
                label: '美国10年期国债收益率',
                value: us10y?.price ?? 0,
                valueText: `${(us10y?.price ?? 0).toFixed(3)}%`,
                hint: us10yState.hint,
                statusLabel: us10yState.statusLabel,
                tone: us10yState.tone,
                deltaText: us10y ? formatSignedPercent(us10y.changePercent) : undefined,
            },
            ethBtc: {
                label: 'ETH 相对 BTC 强弱',
                value: payload.ethBtc.price,
                valueText: payload.ethBtc.price.toFixed(5),
                hint: ethBtcState.hint,
                statusLabel: ethBtcState.statusLabel,
                tone: ethBtcState.tone,
                deltaText: formatSignedPercent(payload.ethBtc.changePercent),
            },
        },
        btc: {
            price: payload.btc.price,
            changePercent: payload.btc.changePercent,
            high24h: payload.btc.high24h,
            low24h: payload.btc.low24h,
            funding: {
                label: 'BTC 资金费率',
                value: payload.btc.fundingRate,
                valueText: `${payload.btc.fundingRate.toFixed(4)}%`,
                hint: fundingState.hint,
                statusLabel: fundingState.statusLabel,
                tone: fundingState.tone,
            },
            lsRatio: {
                label: '全局多空比',
                value: payload.btc.longShortRatio,
                valueText: payload.btc.longShortRatio.toFixed(2),
                hint: lsRatioState.hint,
                statusLabel: lsRatioState.statusLabel,
                tone: lsRatioState.tone,
            },
        },
        etfFlow: payload.etfFlow,
        usEquities: buildUsEquitiesDashboard(payload.usEquities),
        hkEquities: buildChinaEquitiesDashboard(payload.hkEquities),
        aShareEquities: buildChinaEquitiesDashboard(payload.aShareEquities),
        insights,
        sourceStatus: [],
    };
}

function normalizeEquityDashboard(
    dashboard?: Partial<MacroEquityObserverDashboard>,
    defaults: MacroEquityObserverDashboard = buildEquitiesDashboard()
): MacroEquityObserverDashboard {
    return {
        ...defaults,
        ...(dashboard as Partial<MacroEquityObserverDashboard> | undefined),
        groups: Array.isArray(dashboard?.groups) ? dashboard.groups : [],
        summary: {
            ...defaults.summary,
            ...(dashboard?.summary || {}),
        },
    };
}

export function normalizeMacroDashboardData(data: PersistedMacroDashboardData): MacroDashboardData {
    return {
        ...(data as MacroDashboardData),
        groups: Array.isArray(data.groups) ? data.groups : [],
        insights: Array.isArray(data.insights) ? data.insights : [],
        sourceStatus: Array.isArray(data.sourceStatus) ? data.sourceStatus : [],
        usEquities: normalizeEquityDashboard(data.usEquities, buildUsEquitiesDashboard()),
        hkEquities: normalizeEquityDashboard(data.hkEquities, buildChinaEquitiesDashboard()),
        aShareEquities: normalizeEquityDashboard(data.aShareEquities, buildChinaEquitiesDashboard()),
        etfFlow: data.etfFlow
            ? {
                ...(data.etfFlow as BtcEtfFlowSnapshot),
                flows: Array.isArray(data.etfFlow.flows) ? data.etfFlow.flows : [],
            }
            : undefined,
    };
}

export {
    parseBitboBtcEtfFlowApiResponse,
    parseBitboBtcEtfFlowHtml,
    parseBtcEtfFlowText,
} from './macroEtfParsing.ts';
