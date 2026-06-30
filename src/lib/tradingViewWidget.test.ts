import test from 'node:test';
import assert from 'node:assert/strict';

import {
    buildTradingViewPerpetualSymbol,
    buildTradingViewWidgetEmbedUrl,
    rewriteTradingViewWidgetHtml,
} from './tradingViewWidget.ts';

test('builds the Binance perpetual TradingView symbol', () => {
    assert.equal(buildTradingViewPerpetualSymbol('btcusdt'), 'BINANCE:BTCUSDT.P');
});

test('builds the TradingView advanced chart params on the local loader route', () => {
    const url = new URL(buildTradingViewWidgetEmbedUrl('blurusdt'), 'http://localhost');
    const config = JSON.parse(decodeURIComponent(url.hash.slice(1)));

    assert.equal(url.origin, 'http://localhost');
    assert.equal(url.pathname, '/embed-widget/advanced-chart');
    assert.equal(url.searchParams.get('locale'), 'zh_CN');
    assert.equal(config.symbol, 'BINANCE:BLURUSDT.P');
    assert.equal(config.interval, '15');
    assert.equal(config.theme, 'dark');
    assert.equal(config.hide_side_toolbar, true);
    assert.equal(config.allow_symbol_change, false);
});

test('rewrites only TradingView hosts that are unavailable in the current network', () => {
    const html = [
        'https://www.tradingview-widget.com/static/bundles/embed/chart.js',
        '"^embed-widget/([0-9a-zA-Z-]+)/(([0-9a-zA-Z-]+)/)?$"',
        'window.WEBSOCKET_HOST = "widgetdata.tradingview.com";',
        'window.WEBSOCKET_HOST_FOR_RECONNECT = "widgetdata-backup.tradingview.com";',
    ].join('\n');

    const rewritten = rewriteTradingViewWidgetHtml(html);

    assert.match(rewritten, /https:\/\/www\.tradingview\.com\/static\/bundles\/embed\/chart\.js/);
    assert.equal(rewritten.includes('"^embed-widget/([0-9a-zA-Z-]+)$"'), true);
    assert.match(rewritten, /window\.WEBSOCKET_HOST = "data\.tradingview\.com";/);
    assert.match(rewritten, /window\.WEBSOCKET_HOST_FOR_RECONNECT = "prodata\.tradingview\.com";/);
    assert.doesNotMatch(rewritten, /tradingview-widget\.com/);
});
