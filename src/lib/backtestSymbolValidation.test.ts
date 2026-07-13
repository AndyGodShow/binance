import test from 'node:test';
import assert from 'node:assert/strict';

import {
    probeBacktestValidationStage,
    validateBacktestSymbols,
    type BacktestValidationStage,
    type ProbeBacktestValidationResult,
} from './backtestSymbolValidation.ts';

const stage: BacktestValidationStage = {
    name: 'signal-1h',
    interval: '1h',
    startTime: 0,
    endTime: 60 * 60 * 1000,
    minCount: 1,
};

test('probeBacktestValidationStage preserves passed, failed and deferred outcomes', async () => {
    const responses = [
        new Response(JSON.stringify({ data: [[1]] }), { status: 200 }),
        new Response(JSON.stringify({ data: [] }), { status: 200 }),
        new Response(JSON.stringify({ retryable: true }), { status: 503 }),
    ];

    const results = [];
    for (const response of responses) {
        results.push(await probeBacktestValidationStage('BTCUSDT', stage, {
            fetchImpl: async () => response,
            sleep: async () => undefined,
        }));
    }

    assert.deepEqual(results.map((result) => result.status), ['passed', 'failed', 'deferred']);
});

test('validateBacktestSymbols falls back to the next execution interval', async () => {
    const probedIntervals: string[] = [];
    const result = await validateBacktestSymbols(['BTCUSDT'], {
        strategyId: 'macd',
        preset: '1d',
        signalInterval: '1h',
        executionSelection: '1m',
        executionIntervalCandidates: ['1m', '5m'],
        buildStages: ({ executionIntervalOverride }) => [{
            ...stage,
            name: `execution-${executionIntervalOverride}`,
            interval: executionIntervalOverride ?? '1m',
        }],
        probeStage: async (_symbol, candidateStage) => {
            probedIntervals.push(candidateStage.interval);
            return candidateStage.interval === '1m'
                ? { status: 'failed', reason: '1m unavailable' }
                : { status: 'passed' };
        },
        sleep: async () => undefined,
    });

    assert.deepEqual(probedIntervals, ['1m', '5m']);
    assert.deepEqual(result.supportedSymbols, ['BTCUSDT']);
    assert.equal(result.executionIntervalsBySymbol.BTCUSDT, '5m');
});

test('validateBacktestSymbols reports progress after every candidate completes', async () => {
    const progress: Array<{ completed: number; supportedCount: number; skippedCount: number }> = [];
    const outcomes: Record<string, ProbeBacktestValidationResult> = {
        BTCUSDT: { status: 'passed' },
        ETHUSDT: { status: 'failed', reason: 'missing history' },
    };

    await validateBacktestSymbols(['BTCUSDT', 'ETHUSDT'], {
        strategyId: 'macd',
        preset: '1d',
        signalInterval: '1h',
        executionSelection: 'same',
        executionIntervalCandidates: ['1h'],
        buildStages: () => [stage],
        probeStage: async (symbol) => outcomes[symbol],
        sleep: async () => undefined,
        onProgress: ({ completed, supportedCount, skippedCount }) => {
            progress.push({ completed, supportedCount, skippedCount });
        },
    });

    assert.equal(progress.length, 2);
    assert.deepEqual(progress.map((item) => item.completed).sort(), [1, 2]);
    assert.deepEqual(progress.at(-1), { completed: 2, supportedCount: 1, skippedCount: 1 });
});

test('validateBacktestSymbols never exceeds its configured concurrency', async () => {
    let active = 0;
    let peak = 0;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const symbols = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT'];

    const run = validateBacktestSymbols(symbols, {
        strategyId: 'macd',
        preset: '1d',
        signalInterval: '1h',
        executionSelection: 'same',
        concurrency: 2,
        executionIntervalCandidates: ['1h'],
        buildStages: () => [stage],
        probeStage: async () => {
            active += 1;
            peak = Math.max(peak, active);
            await gate;
            active -= 1;
            return { status: 'passed' };
        },
        sleep: async () => undefined,
    });

    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(peak, 2);
    release();
    await run;
    assert.equal(peak, 2);
});
