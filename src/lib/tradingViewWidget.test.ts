import test from 'node:test';
import assert from 'node:assert/strict';

import {
    buildTradingViewAdvancedChartEmbedUrl,
    buildTradingViewAdvancedChartConfig,
    buildTradingViewWidgetPageUri,
    normalizeTradingViewWidgetHost,
    resetTradingViewWidgetContainer,
} from './tradingViewWidget.ts';

test('builds Binance USDT perpetual chart config for the official TradingView advanced chart widget', () => {
    const config = buildTradingViewAdvancedChartConfig('btcusdt');

    assert.equal(config.symbol, 'BINANCE:BTCUSDT.P');
    assert.equal(config.interval, '15');
    assert.equal(config.theme, 'dark');
    assert.equal(config.locale, 'zh_CN');
    assert.equal(config.hide_side_toolbar, true);
    assert.equal(config.allow_symbol_change, false);
    assert.equal(config.withdateranges, true);
    assert.equal(config.support_host, 'https://www.tradingview.com');
});

test('builds TradingView advanced chart embed url on the widget-shaped local proxy path', () => {
    const embedUrl = buildTradingViewAdvancedChartEmbedUrl('blurusdt', 'localhost:3000/');
    const url = new URL(embedUrl, 'http://localhost');
    const config = JSON.parse(decodeURIComponent(url.hash.slice(1)));

    assert.equal(url.pathname, '/embed-widget/advanced-chart');
    assert.equal(url.searchParams.get('locale'), 'zh_CN');
    assert.equal(config.symbol, 'BINANCE:BLURUSDT.P');
    assert.equal(config.width, '100%');
    assert.equal(config.height, '100%');
    assert.equal(config['page-uri'], 'localhost:3000/');
});

test('normalizes local 127 host to localhost for TradingView widget compatibility', () => {
    assert.equal(normalizeTradingViewWidgetHost('127.0.0.1:3000'), 'localhost:3000');
    assert.equal(buildTradingViewWidgetPageUri('127.0.0.1:3000', '/'), 'localhost:3000/');
    assert.equal(buildTradingViewWidgetPageUri('example.com', '/dashboard'), 'example.com/dashboard');
});

test('can build an absolute local widget url when the app is opened through 127', () => {
    const embedUrl = buildTradingViewAdvancedChartEmbedUrl(
        'btcusdt',
        'localhost:3000/',
        'http://localhost:3000'
    );
    const url = new URL(embedUrl);

    assert.equal(url.origin, 'http://localhost:3000');
    assert.equal(url.pathname, '/embed-widget/advanced-chart');
});

test('resets TradingView widget container before remounting a symbol', () => {
    let replaceCallCount = 0;
    const container = {
        replaceChildren(...children: unknown[]) {
            replaceCallCount += 1;
            assert.equal(children.length, 0);
        },
    };

    resetTradingViewWidgetContainer(container as unknown as HTMLElement);

    assert.equal(replaceCallCount, 1);
});
