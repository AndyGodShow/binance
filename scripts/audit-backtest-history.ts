import { HistoricalDataFetcher } from '../src/lib/historicalDataFetcher.ts';
import { runBacktestHistoryPreflight } from '../src/lib/backtestHistoryPreflight.ts';

interface CliOptions {
    baseUrl: string;
    strategyId: string;
    symbols: string[];
    signalInterval: string;
    executionInterval: string;
    startTime: number;
    endTime: number;
}

function parseArgs(argv: string[]): CliOptions {
    const args = new Map<string, string>();
    argv.forEach((arg) => {
        if (!arg.startsWith('--')) {
            return;
        }

        const [key, value] = arg.slice(2).split('=');
        args.set(key, value ?? '');
    });

    const years = Number.parseInt(args.get('years') || '5', 10);
    const endTime = Date.now();
    const startTime = endTime - (years * 365 * 24 * 60 * 60 * 1000);

    return {
        baseUrl: args.get('base-url') || 'http://127.0.0.1:3000/api/backtest/klines',
        strategyId: args.get('strategy-id') || 'wei-shen-ledger',
        symbols: (args.get('symbols') || 'BTCUSDT,ETHUSDT')
            .split(',')
            .map((value) => value.trim().toUpperCase())
            .filter(Boolean),
        signalInterval: args.get('signal-interval') || '1h',
        executionInterval: args.get('execution-interval') || '15m',
        startTime,
        endTime,
    };
}

async function main() {
    const options = parseArgs(process.argv.slice(2));
    const dataFetcher = new HistoricalDataFetcher({ baseUrl: options.baseUrl });

    console.log(JSON.stringify({
        requestedStartTime: new Date(options.startTime).toISOString(),
        requestedEndTime: new Date(options.endTime).toISOString(),
        strategyId: options.strategyId,
        symbols: options.symbols,
    }, null, 2));

    for (const symbol of options.symbols) {
        const report = await runBacktestHistoryPreflight({
            dataFetcher,
            strategyId: options.strategyId,
            symbol,
            startTime: options.startTime,
            endTime: options.endTime,
            signalInterval: options.signalInterval,
            executionInterval: options.executionInterval,
        });

        console.log(`\n[${symbol}] ${report.passed ? 'READY' : 'FAIL'}`);
        report.intervals.forEach((interval) => {
            console.log(JSON.stringify({
                symbol: interval.symbol,
                role: interval.role,
                interval: interval.interval,
                requestedStartTime: new Date(interval.requestedStartTime).toISOString(),
                requestedEndTime: new Date(interval.requestedEndTime).toISOString(),
                actualStartTime: interval.actualStartTime ? new Date(interval.actualStartTime).toISOString() : null,
                actualEndTime: interval.actualEndTime ? new Date(interval.actualEndTime).toISOString() : null,
                actualBars: interval.actualBars,
                expectedBars: interval.expectedBars,
                coveragePercent: Number(interval.coveragePercent.toFixed(4)),
                gapCount: interval.gapCount,
                missingBars: interval.missingBars,
                backtestReady: interval.backtestReady,
                readiness: interval.readiness,
            }, null, 2));
        });

        if (!report.passed) {
            console.log('[REASONS]');
            report.reasons.forEach((reason) => console.log(`- ${reason}`));
        }
    }
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
