import test from 'node:test';
import assert from 'node:assert/strict';

import {
    BTC_LONG_SHORT_RATIO_PERIOD,
    buildEtfFlowSourceStatus,
    buildMacroDashboard,
    classifyMacroFreshness,
    DIGITAL_ASSET_ETF_ASSETS,
    parseBitboBtcEtfFlowApiResponse,
    parseBitboBtcEtfFlowHtml,
    parseBtcEtfFlowText,
    normalizeMacroDashboardData,
    selectFreshestBtcEtfFlow,
    type MacroSourcePayload,
} from './macro.ts';
import { A_SHARE_EQUITY_ASSETS, HK_EQUITY_ASSETS } from './macroAssets.ts';
import {
    MACRO_SOURCE_FRESHNESS_MODE,
    YAHOO_CHART_HOSTS,
    YAHOO_CHART_HOST_TIMEOUT_MS,
} from './macroSourceConfig.ts';

const NOW = Date.parse('2026-04-17T12:00:00.000Z');

function createPayload(overrides: Partial<MacroSourcePayload> = {}): MacroSourcePayload {
    return {
        updatedAt: '2026-04-15T01:00:00.000Z',
        assets: {
            SPY: { symbol: 'SPY', label: 'SPY', market: '美股', price: 694.46, changePercent: 1.22 },
            QQQ: { symbol: 'QQQ', label: 'QQQ', market: '美股', price: 628.6, changePercent: 1.8 },
            NVDA: { symbol: 'NVDA', label: 'NVDA', market: '美股', price: 196.51, changePercent: 3.8 },
            'GC=F': { symbol: 'GC=F', label: 'GOLD', market: '大宗', price: 4843, changePercent: -0.15 },
            'CL=F': { symbol: 'CL=F', label: 'OIL', market: '大宗', price: 90.9, changePercent: -0.42 },
            IBIT: { symbol: 'IBIT', label: 'BTC现货ETF', market: '数字资产 ETF', price: 42.13, changePercent: 1.3 },
            ETHA: { symbol: 'ETHA', label: 'ETH现货ETF', market: '数字资产 ETF', price: 31.68, changePercent: 1.8 },
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
            longShortRatio: 1.42,
        },
        ethBtc: {
            price: 0.03412,
            changePercent: 0.4,
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

test('classifyMacroFreshness separates realtime intraday daily and stale data', () => {
    assert.equal(classifyMacroFreshness('2026-04-17T11:59:10.000Z', NOW, 'realtime'), 'realtime');
    assert.equal(classifyMacroFreshness('2026-04-17T10:30:00.000Z', NOW, 'intraday'), 'intraday');
    assert.equal(classifyMacroFreshness('2026-04-16', NOW, 'daily'), 'daily');
    assert.equal(classifyMacroFreshness('2026-04-10', NOW, 'daily'), 'stale');
    assert.equal(classifyMacroFreshness(undefined, NOW, 'intraday'), 'unknown');
});

test('classifyMacroFreshness keeps last trading day stock observer data valid over weekends', () => {
    const saturdayNightShanghai = Date.parse('2026-05-23T13:30:00.000Z');

    assert.equal(classifyMacroFreshness('2026-05-22T08:30:00.000Z', saturdayNightShanghai, 'daily'), 'daily');
    assert.equal(classifyMacroFreshness('2026-05-22T08:30:00.000Z', saturdayNightShanghai, 'intraday'), 'stale');
});

test('macro equity observer source statuses use daily freshness to avoid weekend stale labels', () => {
    assert.equal(MACRO_SOURCE_FRESHNESS_MODE.market, 'intraday');
    assert.equal(MACRO_SOURCE_FRESHNESS_MODE['us-equities'], 'daily');
    assert.equal(MACRO_SOURCE_FRESHNESS_MODE['hk-equities'], 'daily');
    assert.equal(MACRO_SOURCE_FRESHNESS_MODE['a-share-equities'], 'daily');
});

test('macro route keeps HK and A-share observer pools broad enough for sector scanning', () => {
    const expectedSymbols = [
        '0005.HK',
        '2020.HK',
        '0883.HK',
        '0700.HK',
        '601398.SS',
        '601127.SS',
        '300308.SZ',
        '600900.SS',
    ];

    const configuredSymbols = new Set([...HK_EQUITY_ASSETS, ...A_SHARE_EQUITY_ASSETS].map((asset) => asset.symbol));
    for (const symbol of expectedSymbols) assert.equal(configuredSymbols.has(symbol), true, `${symbol} should be configured`);
});

test('macro route curates HK and A-share observer pools to avoid noisy long tails', () => {
    const hkSymbols = HK_EQUITY_ASSETS.map((asset) => asset.symbol);
    const aShareSymbols = A_SHARE_EQUITY_ASSETS.map((asset) => asset.symbol);
    const removedLongTailSymbols = [
        '1024.HK',
        '9999.HK',
        '9888.HK',
        '3968.HK',
        '2628.HK',
        '0823.HK',
        '0016.HK',
        '1177.HK',
        '000858.SZ',
        '600887.SS',
        '601688.SS',
        '601288.SS',
        '603501.SS',
        '002230.SZ',
        '600050.SS',
    ];

    assert.ok(hkSymbols.length <= 32, `HK observer pool should stay curated, got ${hkSymbols.length}`);
    assert.ok(aShareSymbols.length <= 35, `A-share observer pool should stay curated, got ${aShareSymbols.length}`);
    for (const symbol of removedLongTailSymbols) {
        assert.equal(hkSymbols.includes(symbol) || aShareSymbols.includes(symbol), false, `${symbol} should be removed`);
    }
});

test('macro route includes HK and A-share sector ETFs for board-level observation', () => {
    const expectedSectorEtfs = [
        '3067.HK',
        '3191.HK',
        '2845.HK',
        '3174.HK',
        '512480.SS',
        '512800.SS',
        '512880.SS',
        '512010.SS',
        '515030.SS',
        '515790.SS',
    ];

    const configuredSymbols = new Set([...HK_EQUITY_ASSETS, ...A_SHARE_EQUITY_ASSETS].map((asset) => asset.symbol));
    for (const symbol of expectedSectorEtfs) assert.equal(configuredSymbols.has(symbol), true, `${symbol} should be configured`);
});

test('macro route falls back across Yahoo chart hosts for equity data resilience', () => {
    assert.deepEqual(YAHOO_CHART_HOSTS, [
        'query1.finance.yahoo.com',
        'query2.finance.yahoo.com',
    ]);
    assert.equal(YAHOO_CHART_HOST_TIMEOUT_MS, 4_000);
});

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
            longShortRatio: 2.72,
        },
    }));

    assert.equal(dashboard.regime.code, 'RISK_OFF');
    assert.equal(dashboard.regime.statusLine, '偏防守');
    assert.ok(dashboard.regime.score <= -3);
});

test('buildMacroDashboard exposes localized macro market groups', () => {
    const dashboard = buildMacroDashboard(createPayload({
        assets: {
            '^GSPC': { symbol: '^GSPC', label: '标普500指数', market: '美股', price: 6802, changePercent: 0.6 },
            '^IXIC': { symbol: '^IXIC', label: '纳斯达克综合指数', market: '美股', price: 22900, changePercent: 0.9 },
            '^NDX': { symbol: '^NDX', label: '纳斯达克100', market: '美股', price: 25100, changePercent: 0.8 },
            'XAUUSD=X': { symbol: 'XAUUSD=X', label: '伦敦金', market: '大宗商品', price: 4843, changePercent: -0.15 },
            'XAGUSD=X': { symbol: 'XAGUSD=X', label: '伦敦银', market: '大宗商品', price: 61.2, changePercent: 0.32 },
            'CL=F': { symbol: 'CL=F', label: 'WTI原油', market: '大宗商品', price: 90.9, changePercent: -0.42 },
            '000001.SS': { symbol: '000001.SS', label: '上证指数', market: '中韩日指数', price: 3984, changePercent: 0.28 },
            '^KS11': { symbol: '^KS11', label: '韩国KOSPI', market: '中韩日指数', price: 6106, changePercent: 2.31 },
            '^N225': { symbol: '^N225', label: '日经225', market: '中韩日指数', price: 58157, changePercent: 0.48 },
            IBIT: { symbol: 'IBIT', label: 'BTC现货ETF', market: '数字资产 ETF', price: 42.13, changePercent: 1.3 },
            ETHA: { symbol: 'ETHA', label: 'ETH现货ETF', market: '数字资产 ETF', price: 31.68, changePercent: 1.8 },
            BSOL: { symbol: 'BSOL', label: 'SOL质押ETF', market: '数字资产 ETF', price: 28.4, changePercent: 2.1 },
            XRPC: { symbol: 'XRPC', label: 'XRP现货ETF', market: '数字资产 ETF', price: 24.6, changePercent: -0.8 },
            '^VIX': { symbol: '^VIX', label: 'VIX', market: '监控', price: 18.36, changePercent: 0.1 },
            'DX-Y.NYB': { symbol: 'DX-Y.NYB', label: 'DXY', market: '监控', price: 98.11, changePercent: -0.01 },
            '^TNX': { symbol: '^TNX', label: 'US10Y', market: '监控', price: 4.256, changePercent: -0.95 },
        },
    }));

    assert.deepEqual(
        dashboard.groups.map((group) => [group.title, group.items.map((item) => item.displaySymbol)]),
        [
            ['美股', ['标普500指数', '纳斯达克综合指数', '纳斯达克100']],
            ['大宗商品', ['伦敦金', '伦敦银', 'WTI原油']],
            ['数字资产 ETF', ['BTC现货ETF', 'ETH现货ETF', 'SOL质押ETF', 'XRP现货ETF']],
            ['中韩日指数', ['上证指数', '韩国KOSPI', '日经225']],
        ]
    );
});

test('buildMacroDashboard exposes US equity observer groups and summary', () => {
    const dashboard = buildMacroDashboard(createPayload({
        usEquities: {
            AAPL: {
                symbol: 'AAPL',
                label: '苹果',
                market: '七姐妹',
                price: 212.4,
                changePercent: 1.2,
                performance: { year: 18.4, month: 4.1, week: -0.8, day: 1.2 },
            },
            MSFT: { symbol: 'MSFT', label: '微软', market: '七姐妹', price: 512.8, changePercent: -0.4 },
            MU: { symbol: 'MU', label: '美光科技', market: 'AI半导体', price: 142.5, changePercent: 2.8 },
            SNDK: { symbol: 'SNDK', label: '闪迪', market: 'AI半导体', price: 85.7, changePercent: -1.1 },
            TQQQ: { symbol: 'TQQQ', label: '纳指三倍做多', market: '多空杠杆 ETF/ETN', price: 86.2, changePercent: 3.6 },
            SQQQ: { symbol: 'SQQQ', label: '纳指三倍做空', market: '多空杠杆 ETF/ETN', price: 15.1, changePercent: -3.3 },
            COIN: { symbol: 'COIN', label: 'Coinbase 交易所', market: '加密相关股', price: 287.3, changePercent: 2.1 },
            XLK: { symbol: 'XLK', label: '科技板块', market: '板块总览', price: 251.2, changePercent: 0.8 },
            BABA: { symbol: 'BABA', label: '阿里巴巴', market: '中概观察', price: 124.6, changePercent: 0.9 },
            JD: { symbol: 'JD', label: '京东', market: '中概观察', price: 38.4, changePercent: -0.6 },
        },
    }));

    assert.deepEqual(
        dashboard.usEquities.groups.map((group) => [group.title, group.items.map((item) => item.symbol)]),
        [
            ['七姐妹', ['AAPL', 'MSFT']],
            ['AI半导体', ['MU', 'SNDK']],
            ['多空杠杆 ETF/ETN', ['TQQQ', 'SQQQ']],
            ['加密相关股', ['COIN']],
            ['中概观察', ['BABA', 'JD']],
            ['板块总览', ['XLK']],
        ]
    );
    assert.equal(dashboard.usEquities.summary.totalCount, 10);
    assert.equal(dashboard.usEquities.summary.advancers, 6);
    assert.equal(dashboard.usEquities.summary.decliners, 4);
    assert.equal(dashboard.usEquities.summary.strongest?.symbol, 'TQQQ');
    assert.equal(dashboard.usEquities.summary.weakest?.symbol, 'SQQQ');
    assert.deepEqual(dashboard.usEquities.groups[0].items[0].performance, { year: 18.4, month: 4.1, week: -0.8, day: 1.2 });
});

test('buildMacroDashboard exposes HK and A-share equity observer groups', () => {
    const dashboard = buildMacroDashboard(createPayload({
        hkEquities: {
            '^HSI': { symbol: '^HSI', label: '恒生指数', market: '指数/宽基', price: 25880, changePercent: 0.8 },
            '0700.HK': { symbol: '0700.HK', label: '腾讯控股', market: '科技互联网', price: 388.6, changePercent: 1.6 },
            '3690.HK': { symbol: '3690.HK', label: '美团', market: '科技互联网', price: 122.4, changePercent: -0.7 },
            '1299.HK': { symbol: '1299.HK', label: '友邦保险', market: '金融地产', price: 62.8, changePercent: 0.3 },
            '1211.HK': { symbol: '1211.HK', label: '比亚迪股份', market: '汽车新能源', price: 246.2, changePercent: 2.4 },
            '0981.HK': { symbol: '0981.HK', label: '中芯国际', market: '半导体AI', price: 70.2, changePercent: 3.1 },
            '1347.HK': { symbol: '1347.HK', label: '华虹半导体', market: '半导体AI', price: 55.4, changePercent: 1.9 },
            '7709.HK': { symbol: '7709.HK', label: '南方两倍做多海力士', market: '半导体AI', price: 99.4, changePercent: 2.6 },
            '7747.HK': { symbol: '7747.HK', label: '南方两倍做多三星', market: '半导体AI', price: 102.7, changePercent: -0.5 },
        },
        aShareEquities: {
            '000001.SS': { symbol: '000001.SS', label: '上证指数', market: '指数/宽基', price: 3180, changePercent: -0.2 },
            '600519.SS': { symbol: '600519.SS', label: '贵州茅台', market: '消费医药', price: 1688, changePercent: 1.1 },
            '300750.SZ': { symbol: '300750.SZ', label: '宁德时代', market: '汽车新能源', price: 196.8, changePercent: -1.4 },
            '688981.SS': { symbol: '688981.SS', label: '中芯国际', market: '半导体AI', price: 92.3, changePercent: 2.2 },
        },
    }));

    assert.deepEqual(
        dashboard.hkEquities.groups.map((group) => [group.title, group.items.map((item) => item.symbol)]),
        [
            ['指数/宽基', ['^HSI']],
            ['科技互联网', ['0700.HK', '3690.HK']],
            ['金融地产', ['1299.HK']],
            ['汽车新能源', ['1211.HK']],
            ['半导体AI', ['0981.HK', '1347.HK', '7709.HK', '7747.HK']],
        ]
    );
    assert.equal(dashboard.hkEquities.summary.totalCount, 9);
    assert.equal(dashboard.hkEquities.summary.strongest?.symbol, '0981.HK');

    assert.deepEqual(
        dashboard.aShareEquities.groups.map((group) => [group.title, group.items.map((item) => item.symbol)]),
        [
            ['指数/宽基', ['000001.SS']],
            ['汽车新能源', ['300750.SZ']],
            ['半导体AI', ['688981.SS']],
            ['消费医药', ['600519.SS']],
        ]
    );
    assert.equal(dashboard.aShareEquities.summary.totalCount, 4);
    assert.equal(dashboard.aShareEquities.summary.weakest?.symbol, '300750.SZ');
});

test('US equity observer assets do not affect the global macro regime score', () => {
    const baseDashboard = buildMacroDashboard(createPayload());
    const withWeakStocks = buildMacroDashboard(createPayload({
        usEquities: {
            AAPL: { symbol: 'AAPL', label: '苹果', market: '七姐妹', price: 180, changePercent: -8.5 },
            MSFT: { symbol: 'MSFT', label: '微软', market: '七姐妹', price: 430, changePercent: -7.4 },
            NVDA: { symbol: 'NVDA', label: '英伟达', market: '七姐妹', price: 132, changePercent: -9.1 },
            TQQQ: { symbol: 'TQQQ', label: '纳指三倍做多', market: '多空杠杆 ETF/ETN', price: 68, changePercent: -18.2 },
            COIN: { symbol: 'COIN', label: 'Coinbase 交易所', market: '加密相关股', price: 240, changePercent: -11.6 },
        },
    }));

    assert.equal(withWeakStocks.regime.score, baseDashboard.regime.score);
    assert.equal(withWeakStocks.regime.code, baseDashboard.regime.code);
});

test('HK and A-share observers do not affect the global macro regime score', () => {
    const baseDashboard = buildMacroDashboard(createPayload());
    const withWeakChinaMarkets = buildMacroDashboard(createPayload({
        hkEquities: {
            '^HSI': { symbol: '^HSI', label: '恒生指数', market: '指数/宽基', price: 22000, changePercent: -4.5 },
            '0700.HK': { symbol: '0700.HK', label: '腾讯控股', market: '科技互联网', price: 330, changePercent: -8.2 },
        },
        aShareEquities: {
            '000001.SS': { symbol: '000001.SS', label: '上证指数', market: '指数/宽基', price: 2880, changePercent: -3.2 },
            '300750.SZ': { symbol: '300750.SZ', label: '宁德时代', market: '汽车新能源', price: 160, changePercent: -9.1 },
        },
    }));

    assert.equal(withWeakChinaMarkets.regime.score, baseDashboard.regime.score);
    assert.equal(withWeakChinaMarkets.regime.code, baseDashboard.regime.code);
});

test('buildMacroDashboard keeps partial US equity observer data renderable', () => {
    const dashboard = buildMacroDashboard(createPayload({
        usEquities: {
            MSTR: { symbol: 'MSTR', label: 'Strategy 持币公司', market: '加密相关股', price: 1560, changePercent: -1.5 },
        },
    }));

    assert.deepEqual(
        dashboard.usEquities.groups.map((group) => [group.title, group.items.map((item) => item.displaySymbol)]),
        [['加密相关股', ['Strategy 持币公司']]]
    );
    assert.equal(dashboard.usEquities.summary.totalCount, 1);
    assert.equal(dashboard.usEquities.summary.decliners, 1);
});

test('digital asset ETF defaults include listed single-asset crypto ETFs', () => {
    assert.deepEqual(
        DIGITAL_ASSET_ETF_ASSETS.map((asset) => [asset.symbol, asset.label]),
        [
            ['IBIT', 'BTC现货ETF'],
            ['ETHA', 'ETH现货ETF'],
            ['BSOL', 'SOL质押ETF'],
            ['XRPC', 'XRP现货ETF'],
        ]
    );
});

test('BTC long-short ratio uses a 15 minute period for intraday macro monitoring', () => {
    assert.equal(BTC_LONG_SHORT_RATIO_PERIOD, '15m');
});

test('buildEtfFlowSourceStatus marks preferred ETF data as live', () => {
    const status = buildEtfFlowSourceStatus({
        snapshot: {
            date: '2026-04-17',
            provider: 'Bitbo',
            totalNetInflowUsdMillion: 120,
            rolling7dNetInflowUsdMillion: 300,
            rolling7dPositiveDays: 4,
            rolling7dNegativeDays: 1,
            flows: [],
        },
        primaryAvailable: true,
        secondaryAvailable: true,
    });

    assert.equal(status.status, 'live');
    assert.equal(status.provider, 'Bitbo');
    assert.equal(status.freshness, 'daily');
    assert.equal(status.dataTimestamp, '2026-04-17');
    assert.match(status.detail || '', /备用源已交叉拉取/);
});

test('buildEtfFlowSourceStatus marks fallback-only ETF data as fallback', () => {
    const status = buildEtfFlowSourceStatus({
        snapshot: {
            date: '2026-04-17',
            provider: 'Farside',
            totalNetInflowUsdMillion: 88,
            rolling7dNetInflowUsdMillion: 240,
            rolling7dPositiveDays: 3,
            rolling7dNegativeDays: 2,
            flows: [],
        },
        primaryAvailable: false,
        secondaryAvailable: true,
    });

    assert.equal(status.status, 'fallback');
    assert.equal(status.provider, 'Farside');
    assert.equal(status.freshness, 'daily');
    assert.equal(status.dataTimestamp, '2026-04-17');
    assert.match(status.detail || '', /正在使用备用 ETF 数据源/);
});

test('buildEtfFlowSourceStatus marks missing ETF data as unavailable', () => {
    const status = buildEtfFlowSourceStatus({
        primaryAvailable: false,
        secondaryAvailable: false,
    });

    assert.equal(status.status, 'unavailable');
    assert.equal(status.provider, 'Unavailable');
    assert.equal(status.freshness, 'unknown');
    assert.match(status.detail || '', /ETF flow 当前不可用/);
});

test('selectFreshestBtcEtfFlow prefers newer ETF flow dates over source priority', () => {
    const selected = selectFreshestBtcEtfFlow([
        {
            date: '2026-04-16',
            provider: 'Bitbo API',
            totalNetInflowUsdMillion: 100,
            rolling7dNetInflowUsdMillion: 300,
            rolling7dPositiveDays: 4,
            rolling7dNegativeDays: 2,
            flows: [],
        },
        {
            date: '2026-04-17',
            provider: 'Farside',
            totalNetInflowUsdMillion: 180,
            rolling7dNetInflowUsdMillion: 360,
            rolling7dPositiveDays: 5,
            rolling7dNegativeDays: 1,
            flows: [{ symbol: 'IBIT', netInflowUsdMillion: 100 }],
        },
    ]);

    assert.equal(selected?.provider, 'Farside');
    assert.equal(selected?.date, '2026-04-17');
});

test('selectFreshestBtcEtfFlow prefers structured ETF API data on the same date', () => {
    const selected = selectFreshestBtcEtfFlow([
        {
            date: '2026-04-17',
            provider: 'Farside',
            totalNetInflowUsdMillion: 180,
            rolling7dNetInflowUsdMillion: 360,
            rolling7dPositiveDays: 5,
            rolling7dNegativeDays: 1,
            flows: [{ symbol: 'IBIT', netInflowUsdMillion: 100 }],
        },
        {
            date: '2026-04-17',
            provider: 'Bitbo API',
            totalNetInflowUsdMillion: 175,
            rolling7dNetInflowUsdMillion: 350,
            rolling7dPositiveDays: 4,
            rolling7dNegativeDays: 2,
            flows: [],
        },
    ]);

    assert.equal(selected?.provider, 'Bitbo API');
});

test('selectFreshestBtcEtfFlow prefers Bitbo over Farside on the same date', () => {
    const selected = selectFreshestBtcEtfFlow([
        {
            date: '2026-04-17',
            provider: 'Farside',
            totalNetInflowUsdMillion: 180,
            rolling7dNetInflowUsdMillion: 360,
            rolling7dPositiveDays: 5,
            rolling7dNegativeDays: 1,
            flows: [{ symbol: 'IBIT', netInflowUsdMillion: 100 }],
        },
        {
            date: '2026-04-17',
            provider: 'Bitbo',
            totalNetInflowUsdMillion: 175,
            rolling7dNetInflowUsdMillion: 350,
            rolling7dPositiveDays: 4,
            rolling7dNegativeDays: 2,
            flows: [],
        },
    ]);

    assert.equal(selected?.provider, 'Bitbo');
});

test('buildMacroDashboard does not claim fallback ETF flow data when no ETF flow snapshot exists', () => {
    const dashboard = buildMacroDashboard(createPayload({ etfFlow: undefined }));

    assert.ok(
        dashboard.insights.some((insight) => insight.includes('ETF 资金流暂未拉到'))
    );
    assert.ok(
        dashboard.insights.every((insight) => !insight.includes('读数可用'))
    );
});

test('buildMacroDashboard uses Chinese monitor labels', () => {
    const dashboard = buildMacroDashboard(createPayload());

    assert.equal(dashboard.monitors.fearGreed.label, '恐惧与贪婪指数');
    assert.equal(dashboard.monitors.us10y.label, '美国10年期国债收益率');
    assert.equal(dashboard.monitors.ethBtc.label, 'ETH 相对 BTC 强弱');
});

test('normalizeMacroDashboardData makes legacy persisted arrays safe to render', () => {
    const dashboard = buildMacroDashboard(createPayload());
    const legacyDashboard = {
        ...dashboard,
        groups: undefined,
        insights: undefined,
        sourceStatus: undefined,
        etfFlow: dashboard.etfFlow ? { ...dashboard.etfFlow, flows: undefined } : undefined,
    };

    const normalized = normalizeMacroDashboardData(legacyDashboard);

    assert.deepEqual(normalized.groups, []);
    assert.deepEqual(normalized.insights, []);
    assert.deepEqual(normalized.sourceStatus, []);
    assert.deepEqual(normalized.etfFlow?.flows, []);
});

test('normalizeMacroDashboardData preserves degraded macro data quality metadata', () => {
    const normalized = normalizeMacroDashboardData({
        updatedAt: '2026-04-18T00:00:00.000Z',
        dataQuality: 'partial',
        groups: [],
        insights: [],
        sourceStatus: [
            {
                key: 'btc',
                label: 'BTC 行情与费率',
                provider: 'Binance Futures',
                status: 'unavailable',
                errorKind: 'timeout',
            },
        ],
    });

    assert.equal(normalized.dataQuality, 'partial');
    assert.equal(normalized.sourceStatus[0].status, 'unavailable');
    assert.equal(normalized.sourceStatus[0].errorKind, 'timeout');
});

test('normalizeMacroDashboardData makes legacy US equity observer data safe to render', () => {
    const normalized = normalizeMacroDashboardData({
        updatedAt: '2026-04-18T00:00:00.000Z',
        groups: [],
        insights: [],
        sourceStatus: [],
        usEquities: {
            groups: undefined,
            summary: undefined,
            session: undefined,
        },
    });

    assert.deepEqual(normalized.usEquities.groups, []);
    assert.equal(normalized.usEquities.summary.totalCount, 0);
    assert.equal(normalized.usEquities.session, undefined);
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
                    <td><span>Apr 10, 2026</span></td>
                    <td><span>139.2</span></td>
                    <td><span>78.9</span></td>
                    <td><span>-0.5</span></td>
                    <td><span>217.6</span></td>
                </tr>
                <tr>
                    <td><span>Apr 13, 2026</span></td>
                    <td><span>35.2</span></td>
                    <td><span>-231.7</span></td>
                    <td><span>-1.4</span></td>
                    <td><span>-197.9</span></td>
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

test('parseBitboBtcEtfFlowApiResponse converts aggregate BTC flow rows to USD millions', () => {
    const parsed = parseBitboBtcEtfFlowApiResponse({
        data: [
            ['2026-04-12', '450', '-25.5', '-10.0', '450', '74000'],
            ['2026-04-14', '450', '12.25', '4.0', '450', '76000'],
            ['2026-04-13', '450', '0', '0', '450', '75000'],
        ],
    });

    assert.equal(parsed.date, '2026-04-14');
    assert.ok(Math.abs(parsed.totalNetInflowUsdMillion - 0.931) < 1e-9);
    assert.equal(parsed.btcPrice, 76000);
    assert.deepEqual(parsed.flows, []);
    assert.ok(Math.abs(parsed.rolling7dNetInflowUsdMillion - -0.956) < 1e-9);
    assert.equal(parsed.rolling7dPositiveDays, 1);
    assert.equal(parsed.rolling7dNegativeDays, 1);
});
