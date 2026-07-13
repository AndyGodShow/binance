import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';

import { fetchBinanceJson } from '../src/lib/binanceApi.ts';
import { getArchiveReportDir } from '../src/lib/services/archiveRoots.ts';
import { dataCollector } from '../src/lib/services/dataCollector.ts';
import {
    buildSymbolChunks,
    selectTopUsdtPerpetualSymbols,
    type MarketUniverseExchangeInfo,
    type MarketUniverseTicker,
} from '../src/lib/services/topSymbolUniverse.ts';

const execFileAsync = promisify(execFile);
const DEFAULT_TOP = 150;
const DEFAULT_KLINE_INTERVALS = ['15m', '1h', '4h', '1d'];
const DEFAULT_KLINE_START_DATE = '2019-09-01';
const DEFAULT_DAILY_LOOKBACK_DAYS = 45;
const DEFAULT_BATCH_SIZE = 25;
const DEFAULT_AUX_START_DATE = '2023-01-01';

interface Options {
    top: number;
    batchSize: number;
    dryRun: boolean;
    includeKlines: boolean;
    includeFundingRate: boolean;
    includeMetrics: boolean;
    klineStartDate: string;
    auxStartDate: string;
    dailyLookbackDays: number;
}

interface SyncTopSummary {
    generatedAt: string;
    top: number;
    batchSize: number;
    symbolCount: number;
    symbols: string[];
    options: {
        includeKlines: boolean;
        includeFundingRate: boolean;
        includeMetrics: boolean;
        dryRun: boolean;
        klineStartDate: string;
        auxStartDate: string;
        dailyLookbackDays: number;
    };
}

function parseBooleanFlag(value: string | undefined, fallback: boolean): boolean {
    if (value === undefined || value.length === 0) {
        return fallback;
    }

    return !['0', 'false', 'no', 'off'].includes(value.toLowerCase());
}

function parseArgs(argv: string[]): Options {
    const parsed = new Map<string, string>();
    argv.forEach((arg) => {
        if (!arg.startsWith('--')) {
            return;
        }

        const [key, value] = arg.slice(2).split('=');
        if (key) {
            parsed.set(key, value ?? '');
        }
    });

    return {
        top: Number.parseInt(parsed.get('top') || String(DEFAULT_TOP), 10),
        batchSize: Number.parseInt(parsed.get('batch-size') || String(DEFAULT_BATCH_SIZE), 10),
        dryRun: parseBooleanFlag(parsed.get('dry-run'), false),
        includeKlines: parseBooleanFlag(parsed.get('include-klines'), true),
        includeFundingRate: parseBooleanFlag(parsed.get('include-funding-rate'), true),
        includeMetrics: parseBooleanFlag(parsed.get('include-metrics'), true),
        klineStartDate: parsed.get('kline-start-date') || DEFAULT_KLINE_START_DATE,
        auxStartDate: parsed.get('aux-start-date') || DEFAULT_AUX_START_DATE,
        dailyLookbackDays: Number.parseInt(parsed.get('daily-lookback-days') || String(DEFAULT_DAILY_LOOKBACK_DAYS), 10),
    };
}

function getTodayUtcDate(): string {
    return new Date().toISOString().slice(0, 10);
}

async function fetchTopUsdtPerpetualSymbols(limit: number): Promise<string[]> {
    const [tickers, exchangeInfo] = await Promise.all([
        fetchBinanceJson<MarketUniverseTicker[]>('/fapi/v1/ticker/24hr', { revalidate: 5 }),
        fetchBinanceJson<MarketUniverseExchangeInfo>('/fapi/v1/exchangeInfo?v=2', { revalidate: 3600 }),
    ]);

    return selectTopUsdtPerpetualSymbols(tickers, exchangeInfo, limit);
}

async function writeSummaryReport(summary: SyncTopSummary): Promise<string> {
    const reportDir = getArchiveReportDir();
    await fs.promises.mkdir(reportDir, { recursive: true });
    const fileName = `top-market-archive-${summary.symbolCount}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
    const filePath = path.join(reportDir, fileName);
    await fs.promises.writeFile(filePath, `${JSON.stringify(summary, null, 2)}\n`, 'utf-8');
    return filePath;
}

async function syncKlineBatch(symbols: string[], options: Options): Promise<void> {
    const args = [
        '--experimental-strip-types',
        './scripts/sync-binance-kline-archive.ts',
        `--symbols=${symbols.join(',')}`,
        `--intervals=${DEFAULT_KLINE_INTERVALS.join(',')}`,
        `--start-date=${options.klineStartDate}`,
        `--daily-lookback-days=${options.dailyLookbackDays}`,
    ];

    await execFileAsync('node', args, {
        cwd: process.cwd(),
        env: process.env,
    });
}

async function syncAuxiliaryData(symbols: string[], options: Options): Promise<void> {
    const endDate = getTodayUtcDate();
    const incomplete: string[] = [];

    for (const symbol of symbols) {
        if (options.includeFundingRate) {
            const result = await dataCollector.downloadData(symbol, 'fundingRate', options.auxStartDate, endDate);
            if (result.status !== 'success') incomplete.push(`${symbol}:fundingRate:${result.status}`);
        }
        if (options.includeMetrics) {
            const result = await dataCollector.downloadData(symbol, 'metrics', options.auxStartDate, endDate);
            if (result.status !== 'success') incomplete.push(`${symbol}:metrics:${result.status}`);
        }
    }

    if (incomplete.length > 0) {
        throw new Error(`Auxiliary data sync incomplete: ${incomplete.join(', ')}`);
    }
}

async function main() {
    const options = parseArgs(process.argv.slice(2));
    const symbols = await fetchTopUsdtPerpetualSymbols(options.top);
    const chunks = buildSymbolChunks(symbols, options.batchSize);

    const summary: SyncTopSummary = {
        generatedAt: new Date().toISOString(),
        top: options.top,
        batchSize: options.batchSize,
        symbolCount: symbols.length,
        symbols,
        options: {
            includeKlines: options.includeKlines,
            includeFundingRate: options.includeFundingRate,
            includeMetrics: options.includeMetrics,
            dryRun: options.dryRun,
            klineStartDate: options.klineStartDate,
            auxStartDate: options.auxStartDate,
            dailyLookbackDays: options.dailyLookbackDays,
        },
    };

    const reportPath = await writeSummaryReport(summary);

    console.log(`[TOP] selected ${symbols.length} symbols`);
    console.log(`[TOP] report: ${reportPath}`);
    console.log(`[TOP] first 20: ${symbols.slice(0, 20).join(', ')}`);

    if (options.dryRun) {
        console.log('[TOP] dry-run enabled, skipping downloads');
        return;
    }

    for (const [index, chunk] of chunks.entries()) {
        console.log(`\n[BATCH ${index + 1}/${chunks.length}] ${chunk.join(', ')}`);

        if (options.includeKlines) {
            await syncKlineBatch(chunk, options);
        }

        if (options.includeFundingRate || options.includeMetrics) {
            await syncAuxiliaryData(chunk, options);
        }
    }
}

main().catch((error) => {
    console.error('[TOP] sync failed:', error);
    process.exitCode = 1;
});
