import test from 'node:test';
import assert from 'node:assert/strict';

import {
    buildMacroDashboard,
    parseBitboBtcEtfFlowHtml,
    parseBtcEtfFlowText,
    type MacroSourcePayload,
} from './macro';

function createPayload(overrides: Partial<MacroSourcePayload> = {}): MacroSourcePayload {
    return {
        updatedAt: '2026-04-15T01:00:00.000Z',
        assets: {
            SPY: { symbol: 'SPY', label: 'SPY', market: '美股', price: 694.46, changePercent: 1.22 },
            QQQ: { symbol: 'QQQ', label: 'QQQ', market: '美股', price: 628.6, changePercent: 1.8 },
            NVDA: { symbol: 'NVDA', label: 'NVDA', market: '美股', price: 196.51, changePercent: 3.8 },
            'GC=F': { symbol: 'GC=F', label: 'GOLD', market: '大宗', price: 4843, changePercent: -0.15 },
            'CL=F': { symbol: 'CL=F', label: 'OIL', market: '大宗', price: 90.9, changePercent: -0.42 },
            IBIT: { symbol: 'IBIT', label: 'IBIT', market: '比特币 ETF', price: 42.13, changePercent: 1.3 },
            '^KS11': { symbol: '^KS11', label: 'KOSPI', market: '韩日指数', price: 6106, changePercent: 2.31 },
            '^N225': { symbol: '^N225', label: '日经', market: '韩日指数', price: 58157, changePercent: 0.48 },
            '^VIX': { symbol: '^VIX', label: 'VIX', market: '监控', price: 18.36, changePercent: 0.1 },
            'DX-Y.NYB': { symbol: 'DX-Y.NYB', label: 'DXY', market: '监控', price: 98.11, changePercent: -0.01 },
            '^TNX': { symbol: '^TNX', label: 'US10Y', market: '监控', price: 4.256, changePercent: -0.95 },
        },
        fearGreed: {
            value: 23,
            valueText: 'Extreme Fear',
            timestamp: '2026-04-15T00:00:00.000Z',
        },
        btc: {
            price: 73921,
            changePercent: -0.63,
            high24h: 76009,
            low24h: 73767,
            fundingRate: -0.0082,
        },
        etfFlow: {
            date: '2026-04-14',
            totalNetInflowUsdMillion: 395.9,
            btcPrice: 74385,
            flows: [
                { symbol: 'IBIT', netInflowUsdMillion: 213.8 },
                { symbol: 'FBTC', netInflowUsdMillion: 81.7 },
                { symbol: 'BITB', netInflowUsdMillion: 18.6 },
            ],
            rolling7dNetInflowUsdMillion: 870,
            rolling7dPositiveDays: 4,
            rolling7dNegativeDays: 3,
        },
        ...overrides,
    };
}

test('buildMacroDashboard produces neutral regime when risk assets offset macro pressure', () => {
    const dashboard = buildMacroDashboard(createPayload());

    assert.equal(dashboard.regime.code, 'NEUTRAL');
    assert.equal(dashboard.regime.label, '中性震荡');
    assert.equal(dashboard.regime.score, 1);
    assert.equal(dashboard.groups[0].items[0].displaySymbol, 'SPY');
    assert.equal(dashboard.monitors.fearGreed.statusLabel, '恐惧');
    assert.equal(dashboard.monitors.dxy.statusLabel, '弱势');
    assert.equal(dashboard.btc.funding.statusLabel, '中性');
});

test('buildMacroDashboard can classify risk-off regime', () => {
    const dashboard = buildMacroDashboard(createPayload({
        assets: {
            SPY: { symbol: 'SPY', label: 'SPY', market: '美股', price: 680, changePercent: -2.3 },
            QQQ: { symbol: 'QQQ', label: 'QQQ', market: '美股', price: 610, changePercent: -2.8 },
            NVDA: { symbol: 'NVDA', label: 'NVDA', market: '美股', price: 180, changePercent: -5.1 },
            'GC=F': { symbol: 'GC=F', label: 'GOLD', market: '大宗', price: 4880, changePercent: 1.2 },
            'CL=F': { symbol: 'CL=F', label: 'OIL', market: '大宗', price: 87.2, changePercent: -1.7 },
            IBIT: { symbol: 'IBIT', label: 'IBIT', market: '比特币 ETF', price: 38.5, changePercent: -4.4 },
            '^KS11': { symbol: '^KS11', label: 'KOSPI', market: '韩日指数', price: 5800, changePercent: -1.8 },
            '^N225': { symbol: '^N225', label: '日经', market: '韩日指数', price: 54800, changePercent: -1.1 },
            '^VIX': { symbol: '^VIX', label: 'VIX', market: '监控', price: 31.2, changePercent: 7.8 },
            'DX-Y.NYB': { symbol: 'DX-Y.NYB', label: 'DXY', market: '监控', price: 105.8, changePercent: 0.7 },
            '^TNX': { symbol: '^TNX', label: 'US10Y', market: '监控', price: 4.68, changePercent: 1.2 },
        },
        fearGreed: {
            value: 18,
            valueText: 'Extreme Fear',
            timestamp: '2026-04-15T00:00:00.000Z',
        },
        btc: {
            price: 70210,
            changePercent: -3.7,
            high24h: 73500,
            low24h: 69920,
            fundingRate: 0.041,
        },
    }));

    assert.equal(dashboard.regime.code, 'RISK_OFF');
    assert.equal(dashboard.regime.statusLine, '偏防守');
    assert.ok(dashboard.regime.score <= -3);
});

test('parseBtcEtfFlowText extracts latest day and rolling 7d totals', () => {
    const parsed = parseBtcEtfFlowText(`
Bitcoin ETF Flow (US$m)
13 Apr 2026
34.7
(229.2)
11.9
(62.9)
0.0
0.0
0.0
(2.6)
0.0
6.3
(38.2)
(11.0)
(291.0)
14 Apr 2026
-
-
12.5
113.1
-
-
-
-
0.0
15.5
0.0
4.9
146.0
`);

    assert.equal(parsed.date, '2026-04-14');
    assert.equal(parsed.totalNetInflowUsdMillion, 146);
    assert.equal(parsed.flows[0].symbol, 'ARKB');
    assert.equal(parsed.flows[0].netInflowUsdMillion, 113.1);
    assert.equal(parsed.flows[1].symbol, 'GBTC');
    assert.equal(parsed.rolling7dNetInflowUsdMillion, -145);
    assert.equal(parsed.rolling7dPositiveDays, 1);
    assert.equal(parsed.rolling7dNegativeDays, 1);
});

test('parseBitboBtcEtfFlowHtml extracts latest row and rolling totals from table html', () => {
    const parsed = parseBitboBtcEtfFlowHtml(`
        <table class="stats-table larger-table">
            <tbody>
                <tr>
                    <th><span>Date</span></th>
                    <th><span>IBIT</span></th>
                    <th><span>FBTC</span></th>
                    <th><span>GBTC</span></th>
                    <th><span>Totals</span></th>
                </tr>
                <tr>
                    <td><span>Apr 13, 2026</span></td>
                    <td><span>35.2</span></td>
                    <td><span>-231.7</span></td>
                    <td><span>-1.4</span></td>
                    <td><span>-197.9</span></td>
                </tr>
                <tr>
                    <td><span>Apr 10, 2026</span></td>
                    <td><span>139.2</span></td>
                    <td><span>78.9</span></td>
                    <td><span>-0.5</span></td>
                    <td><span>217.6</span></td>
                </tr>
            </tbody>
        </table>
    `);

    assert.equal(parsed.date, '2026-04-13');
    assert.equal(parsed.totalNetInflowUsdMillion, -197.9);
    assert.equal(parsed.flows[0].symbol, 'IBIT');
    assert.equal(parsed.flows[0].netInflowUsdMillion, 35.2);
    assert.equal(parsed.flows[2].symbol, 'FBTC');
    assert.ok(Math.abs(parsed.rolling7dNetInflowUsdMillion - 19.7) < 1e-9);
    assert.equal(parsed.rolling7dPositiveDays, 1);
    assert.equal(parsed.rolling7dNegativeDays, 1);
});
