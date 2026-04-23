import assert from 'node:assert/strict';
import test from 'node:test';

import { buildWeiShenSymbolContext } from './weiShenEngine.ts';
import type { OHLC } from './types.ts';

function createSeries(params: {
    length: number;
    start: number;
    step: number;
    quoteVolume: number;
    finalJump?: number;
    finalVolumeMultiplier?: number;
    intervalMs: number;
}): OHLC[] {
    return Array.from({ length: params.length }, (_, index) => {
        const baseClose = params.start + (params.step * index);
        const close = index === params.length - 1
            ? baseClose + (params.finalJump ?? 0)
            : baseClose;
        const open = index === 0 ? params.start : params.start + (params.step * (index - 1));
        const quoteVolume = params.quoteVolume * (index === params.length - 1 ? (params.finalVolumeMultiplier ?? 1) : 1);

        return {
            time: (index + 1) * params.intervalMs,
            open,
            high: close * 1.006,
            low: open * 0.994,
            close,
            volume: quoteVolume / Math.max(close, 1),
            quoteVolume,
            takerBuyQuoteVolume: quoteVolume * 0.52,
        };
    });
}

test('wei-shen relative strength gate blocks low-liquidity alt breakouts before entry execution', () => {
    const btc1h = createSeries({
        length: 80,
        start: 100,
        step: 0.4,
        quoteVolume: 300_000_000,
        finalJump: 1,
        finalVolumeMultiplier: 1.2,
        intervalMs: 60 * 60 * 1000,
    });
    const btc4h = createSeries({
        length: 60,
        start: 100,
        step: 1.2,
        quoteVolume: 500_000_000,
        intervalMs: 4 * 60 * 60 * 1000,
    });
    const btc1d = createSeries({
        length: 40,
        start: 100,
        step: 2.2,
        quoteVolume: 1_000_000_000,
        intervalMs: 24 * 60 * 60 * 1000,
    });
    const eth1h = createSeries({
        length: 80,
        start: 200,
        step: 1.0,
        quoteVolume: 20_000_000,
        finalJump: 8,
        finalVolumeMultiplier: 2,
        intervalMs: 60 * 60 * 1000,
    });
    const eth4h = createSeries({
        length: 60,
        start: 200,
        step: 3.2,
        quoteVolume: 40_000_000,
        intervalMs: 4 * 60 * 60 * 1000,
    });
    const eth1d = createSeries({
        length: 40,
        start: 200,
        step: 6.4,
        quoteVolume: 60_000_000,
        intervalMs: 24 * 60 * 60 * 1000,
    });

    const context = buildWeiShenSymbolContext({
        symbol: 'ETHUSDT',
        signal1h: eth1h,
        confirm4h: eth4h,
        daily1d: eth1d,
        btc1h,
        btc4h,
        btc1d,
        fallbackQuoteVolume24hUsd: 500_000_000,
    });

    assert.ok(context);
    assert.equal(context?.relativeStrength.passed, false);
    assert.match(context?.relativeStrength.failedReasons.join(' | ') || '', /24h 成交额不足/);
    assert.equal(context?.entries.breakout.long.eligible, false);
    assert.match(context?.entries.breakout.long.failed.join(' | ') || '', /相对强弱未通过/);
});
