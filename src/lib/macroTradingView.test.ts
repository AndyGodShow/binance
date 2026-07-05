import test from 'node:test';
import assert from 'node:assert/strict';

import {
    buildMacroEquityTradingViewSymbol,
    buildMacroEquityTradingViewUrl,
    canEmbedMacroEquityChart,
} from './macroTradingView.ts';

test('maps US equity symbols to their TradingView primary exchanges', () => {
    assert.equal(buildMacroEquityTradingViewSymbol('AAPL'), 'NASDAQ:AAPL');
    assert.equal(buildMacroEquityTradingViewSymbol('TSM'), 'NYSE:TSM');
    assert.equal(buildMacroEquityTradingViewSymbol('XLK'), 'AMEX:XLK');
});

test('maps Hong Kong equity and index symbols to TradingView', () => {
    assert.equal(buildMacroEquityTradingViewSymbol('0700.HK'), 'HKEX:700');
    assert.equal(buildMacroEquityTradingViewSymbol('^HSI'), 'TVC:HSI');
    assert.equal(buildMacroEquityTradingViewSymbol('^HSCE'), 'HSI:HSCEI');
});

test('maps mainland equity and index symbols to TradingView', () => {
    assert.equal(buildMacroEquityTradingViewSymbol('600519.SS'), 'SSE:600519');
    assert.equal(buildMacroEquityTradingViewSymbol('300750.SZ'), 'SZSE:300750');
    assert.equal(buildMacroEquityTradingViewSymbol('000001.SS'), 'SSE:000001');
});

test('opens restricted Hong Kong symbols on TradingView instead of the widget', () => {
    assert.equal(canEmbedMacroEquityChart('AAPL'), true);
    assert.equal(canEmbedMacroEquityChart('600519.SS'), true);
    assert.equal(canEmbedMacroEquityChart('0700.HK'), false);
    assert.equal(canEmbedMacroEquityChart('^HSI'), false);
    assert.equal(
        buildMacroEquityTradingViewUrl('0700.HK'),
        'https://www.tradingview.com/chart/?symbol=HKEX%3A700'
    );
});
