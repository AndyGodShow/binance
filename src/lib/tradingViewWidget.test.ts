import test from 'node:test';
import assert from 'node:assert/strict';

import {
    buildTradingViewAdvancedChartEmbedUrl,
    buildTradingViewAdvancedChartConfig,
    resetTradingViewWidgetContainer,
} from './tradingViewWidget.ts';

test('builds Binance USDT perpetual chart config for the official TradingView advanced chart widget', () => {
    const config = buildTradingViewAdvancedChartConfig('btcusdt');

    assert.equal(config.symbol, 'BINANCE:BTCUSDT.P');
    assert.equal(config.interval, '15');
    assert.equal(config.theme, 'dark');
    assert.equal(config.locale, 'zh_CN');
    assert.equal(config.allow_symbol_change, false);
    assert.equal(config.withdateranges, true);
    assert.equal(config.support_host, 'https://www.tradingview.com');
});

test('builds TradingView advanced chart embed url on the main TradingView host', () => {
    const url = new URL(buildTradingViewAdvancedChartEmbedUrl('blurusdt', 'binance-psi-eosin.vercel.app/'));
    const config = JSON.parse(decodeURIComponent(url.hash.slice(1)));

    assert.equal(url.origin, 'https://www.tradingview.com');
    assert.equal(url.pathname, '/embed-widget/advanced-chart/');
    assert.equal(url.searchParams.get('locale'), 'zh_CN');
    assert.equal(config.symbol, 'BINANCE:BLURUSDT.P');
    assert.equal(config.width, '100%');
    assert.equal(config.height, '100%');
    assert.equal(config['page-uri'], 'binance-psi-eosin.vercel.app/');
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
