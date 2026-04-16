export interface MacroSourceAsset {
    symbol: string;
    label: string;
    market: string;
    price: number;
    changePercent: number;
}

export interface FearGreedSnapshot {
    value: number;
    valueText?: string;
    timestamp?: string;
}

export interface BtcSnapshot {
    price: number;
    changePercent: number;
    high24h: number;
    low24h: number;
    fundingRate: number;
    longShortRatio: number;
}

export interface EthBtcSnapshot {
    price: number;
    changePercent: number;
}

export interface BtcEtfFlowEntry {
    symbol: string;
    netInflowUsdMillion: number;
}

export interface BtcEtfFlowSnapshot {
    date: string;
    totalNetInflowUsdMillion: number;
    btcPrice?: number;
    provider?: string;
    flows: BtcEtfFlowEntry[];
    rolling7dNetInflowUsdMillion: number;
    rolling7dPositiveDays: number;
    rolling7dNegativeDays: number;
}

export interface MacroSourcePayload {
    updatedAt: string;
    assets: Record<string, MacroSourceAsset>;
    fearGreed: FearGreedSnapshot;
    btc: BtcSnapshot;
    ethBtc: EthBtcSnapshot;
    etfFlow?: BtcEtfFlowSnapshot;
}

export interface MacroBoardItem {
    symbol: string;
    displaySymbol: string;
    market: string;
    price: number;
    changePercent: number;
}

export interface MacroBoardGroup {
    title: string;
    items: MacroBoardItem[];
}

export interface MacroMonitorCard {
    label: string;
    value: number;
    valueText: string;
    hint: string;
    statusLabel: string;
    tone: 'positive' | 'negative' | 'neutral';
    deltaText?: string;
}

export interface MacroSourceStatus {
    key: string;
    label: string;
    provider: string;
    status: 'live' | 'fallback' | 'unavailable';
    detail?: string;
}

export interface MacroDashboardData {
    updatedAt: string;
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
    insights: string[];
    sourceStatus: MacroSourceStatus[];
}

const ETF_COLUMN_SYMBOLS = ['IBIT', 'FBTC', 'BITB', 'ARKB', 'BTCO', 'EZBC', 'BRRR', 'HODL', 'BTCW', 'GBTC', 'BTC', 'DEFI'];

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
        return { statusLabel: '主力偏多', tone: 'positive', hint: '>2.5 散户极多 / <1.0 大户偏多' };
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

function buildGroups(assets: Record<string, MacroSourceAsset>): MacroBoardGroup[] {
    const bucketOrder = ['美股', '大宗', '比特币 ETF', '韩日指数'];

    return bucketOrder.map((title) => ({
        title,
        items: Object.values(assets)
            .filter((asset) => asset.market === title || (title === '韩日指数' && asset.market === '韩日指数'))
            .map((asset) => ({
                symbol: asset.symbol,
                displaySymbol: asset.label,
                market: asset.market,
                price: asset.price,
                changePercent: asset.changePercent,
            })),
    })).filter((group) => group.items.length > 0);
}

function computeMomentumScore(payload: MacroSourcePayload): number {
    const tracked = ['SPY', 'QQQ', 'NVDA', 'IBIT', '^KS11', '^N225'];
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

    const insights = [
        payload.assets.SPY && payload.assets.QQQ
            ? `风险资产温度仍在：SPY ${formatSignedPercent(payload.assets.SPY.changePercent)} / QQQ ${formatSignedPercent(payload.assets.QQQ.changePercent)}。`
            : undefined,
        payload.assets['DX-Y.NYB']
            ? `美元指数 ${payload.assets['DX-Y.NYB'].price.toFixed(2)}，${classifyDxy(payload.assets['DX-Y.NYB'].price).statusLabel}。`
            : undefined,
        payload.assets['^TNX']
            ? `10Y 美债在 ${(payload.assets['^TNX'].price).toFixed(3)}%，${classifyUs10y(payload.assets['^TNX'].price).statusLabel}。`
            : undefined,
        payload.etfFlow
            ? `ETF 最近一个交易日 ${payload.etfFlow.totalNetInflowUsdMillion >= 0 ? '净流入' : '净流出'} ${Math.abs(payload.etfFlow.totalNetInflowUsdMillion).toFixed(1)}M。`
            : 'ETF 资金流改为回退源抓取，读数可用但建议与盘后统计交叉确认。',
    ].filter((item): item is string => Boolean(item));

    return {
        updatedAt: payload.updatedAt,
        groups: buildGroups(payload.assets),
        regime: computeRegime(payload),
        monitors: {
            fearGreed: {
                label: 'Fear & Greed Index',
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
                label: 'US10Y 美债收益率',
                value: us10y?.price ?? 0,
                valueText: `${(us10y?.price ?? 0).toFixed(3)}%`,
                hint: us10yState.hint,
                statusLabel: us10yState.statusLabel,
                tone: us10yState.tone,
                deltaText: us10y ? formatSignedPercent(us10y.changePercent) : undefined,
            },
            ethBtc: {
                label: 'ETH/BTC 汇率 (近24h)',
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
        insights,
        sourceStatus: [],
    };
}

function sanitizeFlowNumber(raw: string): number {
    const trimmed = raw.trim();
    if (!trimmed || trimmed === '-') {
        return 0;
    }

    const normalized = trimmed.replace(/,/g, '');
    const negativeWrapped = normalized.startsWith('(') && normalized.endsWith(')');
    const numeric = Number.parseFloat(normalized.replace(/[()]/g, ''));
    if (!Number.isFinite(numeric)) {
        return 0;
    }

    return negativeWrapped ? -numeric : numeric;
}

function parseFlowDate(raw: string): string | null {
    const match = raw.match(/^(\d{1,2})\s+([A-Za-z]{3})\s+(\d{4})$/);
    if (!match) {
        return null;
    }

    const [, day, month, year] = match;
    const parsed = Date.parse(`${month} ${day}, ${year} 00:00:00 UTC`);
    if (!Number.isFinite(parsed)) {
        return null;
    }

    return new Date(parsed).toISOString().slice(0, 10);
}

export function parseBtcEtfFlowText(text: string): BtcEtfFlowSnapshot {
    const lines = text
        .split(/\r?\n/)
        .map((line) => line.replace(/\s+/g, ' ').trim())
        .filter(Boolean);

    const dayRows: Array<{ date: string; flows: BtcEtfFlowEntry[]; total: number }> = [];

    for (let index = 0; index < lines.length; index += 1) {
        const isoDate = parseFlowDate(lines[index]);
        if (!isoDate) {
            continue;
        }

        const values = lines.slice(index + 1, index + 1 + ETF_COLUMN_SYMBOLS.length + 1);
        if (values.length < ETF_COLUMN_SYMBOLS.length + 1) {
            continue;
        }

        const flows = ETF_COLUMN_SYMBOLS.map((symbol, offset) => ({
            symbol,
            netInflowUsdMillion: sanitizeFlowNumber(values[offset]),
        })).filter((entry) => entry.netInflowUsdMillion !== 0);

        dayRows.push({
            date: isoDate,
            flows: flows.sort((left, right) => right.netInflowUsdMillion - left.netInflowUsdMillion),
            total: sanitizeFlowNumber(values[ETF_COLUMN_SYMBOLS.length]),
        });
    }

    if (dayRows.length === 0) {
        throw new Error('Unable to parse BTC ETF flow data');
    }

    const latest = dayRows[dayRows.length - 1];
    const rolling = dayRows.slice(-7);

    return {
        date: latest.date,
        totalNetInflowUsdMillion: latest.total,
        flows: latest.flows,
        rolling7dNetInflowUsdMillion: rolling.reduce((sum, row) => sum + row.total, 0),
        rolling7dPositiveDays: rolling.filter((row) => row.total > 0).length,
        rolling7dNegativeDays: rolling.filter((row) => row.total < 0).length,
    };
}

function decodeHtmlEntities(value: string): string {
    return value
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&#39;/g, "'")
        .replace(/&quot;/g, '"');
}

export function parseBitboBtcEtfFlowHtml(html: string): BtcEtfFlowSnapshot {
    const tableMatch = html.match(/<table class="stats-table larger-table">([\s\S]*?)<\/table>/i);
    if (!tableMatch) {
        throw new Error('Unable to locate Bitbo ETF flow table');
    }

    const rowMatches = [...tableMatch[1].matchAll(/<tr>([\s\S]*?)<\/tr>/gi)];
    if (rowMatches.length < 2) {
        throw new Error('Bitbo ETF flow table has no data rows');
    }

    const extractCells = (rowHtml: string) =>
        [...rowHtml.matchAll(/<span>([\s\S]*?)<\/span>/gi)].map((match) =>
            decodeHtmlEntities(match[1]).replace(/\s+/g, ' ').trim()
        );

    const headers = extractCells(rowMatches[0][1]);
    const dateIndex = headers.findIndex((header) => header === 'Date');
    const totalIndex = headers.findIndex((header) => header === 'Totals');
    if (dateIndex !== 0 || totalIndex === -1) {
        throw new Error('Bitbo ETF flow headers are missing expected columns');
    }

    const rows = rowMatches
        .slice(1)
        .map((match) => extractCells(match[1]))
        .filter((cells) => cells.length === headers.length)
        .map((cells) => {
            const date = Date.parse(`${cells[0]} UTC`);
            return {
                cells,
                date: Number.isFinite(date) ? new Date(date).toISOString().slice(0, 10) : null,
            };
        })
        .filter((row): row is { cells: string[]; date: string } => row.date !== null);

    if (rows.length === 0) {
        throw new Error('Bitbo ETF flow rows could not be parsed');
    }

    const latest = rows[0];
    const latestFlows = headers
        .slice(1, totalIndex)
        .map((symbol, index) => ({
            symbol,
            netInflowUsdMillion: sanitizeFlowNumber(latest.cells[index + 1]),
        }))
        .filter((entry) => entry.netInflowUsdMillion !== 0)
        .sort((left, right) => right.netInflowUsdMillion - left.netInflowUsdMillion);

    const rolling = rows.slice(0, 7);

    return {
        date: latest.date,
        totalNetInflowUsdMillion: sanitizeFlowNumber(latest.cells[totalIndex]),
        flows: latestFlows,
        rolling7dNetInflowUsdMillion: rolling.reduce((sum, row) => sum + sanitizeFlowNumber(row.cells[totalIndex]), 0),
        rolling7dPositiveDays: rolling.filter((row) => sanitizeFlowNumber(row.cells[totalIndex]) > 0).length,
        rolling7dNegativeDays: rolling.filter((row) => sanitizeFlowNumber(row.cells[totalIndex]) < 0).length,
    };
}
