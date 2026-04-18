import { writeFile } from 'node:fs/promises';

import { runStrategyOptimization } from '../src/lib/strategyOptimizationRunner.ts';

const BASE_URL = process.env.BASE_URL || 'http://127.0.0.1:3000';
const SYMBOL_LIMIT = Number.parseInt(process.env.SYMBOL_LIMIT || '30', 10);
const SIGNAL_INTERVAL = process.env.SIGNAL_INTERVAL || '1h';
const EXECUTION_INTERVAL = process.env.EXECUTION_INTERVAL || '1m';
const INITIAL_CAPITAL = Number.parseFloat(process.env.INITIAL_CAPITAL || '10000');
const COMMISSION = Number.parseFloat(process.env.COMMISSION || '0.04');
const MAX_CONCURRENT_POSITIONS = Number.parseInt(process.env.MAX_CONCURRENT_POSITIONS || '3', 10);
const POSITION_SIZE_PERCENT = Number.parseFloat(process.env.POSITION_SIZE_PERCENT || '30');
const WINDOWS = (process.env.WINDOWS || '30d,90d,180d')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
const STRATEGY_IDS = (process.env.STRATEGY_IDS || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
const OUTPUT_FILE = process.env.OUTPUT_FILE;

function formatMetric(metric) {
    if (!metric) {
        return '无结果';
    }

    return `收益 ${metric.totalProfit.toFixed(2)}% | 胜率 ${metric.winRate.toFixed(2)}% | 回撤 ${metric.maxDrawdown.toFixed(2)}% | PF ${metric.profitFactor.toFixed(2)} | 交易 ${metric.totalTrades} | 可信度 ${metric.diagnosticsConfidence}`;
}

function safeJsonReplacer(_key, value) {
    if (typeof value === 'number' && !Number.isFinite(value)) {
        return value > 0 ? 'Infinity' : value < 0 ? '-Infinity' : 'NaN';
    }

    return value;
}

async function main() {
    console.log(`策略优化开始: ${new Date().toISOString()}`);
    console.log(`Base URL: ${BASE_URL}`);
    console.log(`币池数量: ${SYMBOL_LIMIT}`);
    console.log(`信号/执行周期: ${SIGNAL_INTERVAL} / ${EXECUTION_INTERVAL}`);
    console.log(`窗口: ${WINDOWS.join(', ')}`);

    const results = await runStrategyOptimization({
        baseUrl: BASE_URL,
        symbolLimit: SYMBOL_LIMIT,
        strategyIds: STRATEGY_IDS.length > 0 ? STRATEGY_IDS : undefined,
        windows: WINDOWS,
        signalInterval: SIGNAL_INTERVAL,
        executionInterval: EXECUTION_INTERVAL,
        initialCapital: INITIAL_CAPITAL,
        commission: COMMISSION,
        maxConcurrentPositions: MAX_CONCURRENT_POSITIONS,
        positionSizePercent: POSITION_SIZE_PERCENT,
        onProgress: (message) => console.log(`[progress] ${message}`),
    });

    results.forEach((result) => {
        console.log(`\n=== ${result.strategyId} ===`);
        console.log(`币池: ${result.symbols.length} 个`);
        console.log('Baseline:');
        Object.entries(result.baselineMetrics).forEach(([window, metric]) => {
            console.log(`  ${window}: ${formatMetric(metric)}`);
        });

        result.candidates.forEach((candidate) => {
            console.log(`- 候选 ${candidate.candidate.label} (${candidate.candidate.id})`);
            Object.entries(candidate.metrics).forEach(([window, metric]) => {
                console.log(`    ${window}: ${formatMetric(metric)}`);
            });
            console.log(`    审核结论: ${candidate.report.approved ? '通过' : '拒绝'}`);
            if (candidate.report.rejectedReasons.length > 0) {
                candidate.report.rejectedReasons.forEach((reason) => {
                    console.log(`      - ${reason}`);
                });
            }
        });

        if (result.approvedCandidate) {
            console.log(`最终保留候选: ${result.approvedCandidate.candidate.label}`);
        } else {
            console.log('最终保留结果: baseline');
        }
    });

    if (OUTPUT_FILE) {
        await writeFile(OUTPUT_FILE, JSON.stringify(results, safeJsonReplacer, 2), 'utf8');
        console.log(`\n已写出报告: ${OUTPUT_FILE}`);
    }
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
