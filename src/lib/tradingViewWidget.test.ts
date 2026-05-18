import test from 'node:test';
import assert from 'node:assert/strict';

import {
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
