import fs from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import { promisify } from 'util';
import { execFile } from 'child_process';

import type { KlineData } from '../src/app/api/backtest/klines/route.ts';
import {
    type BacktestReadiness,
    writeMergedKlineArchive,
} from '../src/lib/services/klineArchive.ts';
import {
    buildPrimaryArchivePath,
    getArchiveReportDir,
} from '../src/lib/services/archiveRoots.ts';

const execFileAsync = promisify(execFile);
const BINANCE_DATA_BASE_URL = 'https://data.binance.vision/data';
const DEFAULT_SYMBOLS = ['BTCUSDT', 'ETHUSDT'];
const DEFAULT_INTERVALS = ['15m', '1h', '4h', '1d'];
const DEFAULT_START_DATE = '2019-09-01';
const DEFAULT_DAILY_LOOKBACK_DAYS = 45;
const CSV_SUFFIX = '.csv';

type ArchiveBucket = 'monthly' | 'daily';

interface SyncOptions {
    symbols: string[];
    intervals: string[];
    startDate: string;
    dailyLookbackDays: number;
}

interface IntervalAuditReport {
    symbol: string;
    interval: string;
    totalBars: number;
    coverageStart: string | null;
    coverageEnd: string | null;
    gapCount: number;
    missingBars: number;
    maxGapBars: number;
    lagBars: number;
    readiness: BacktestReadiness;
}

interface SyncSummary {
    generatedAt: string;
    market: 'futures/um';
    source: 'data.binance.vision';
    symbols: string[];
    intervals: string[];
    startDate: string;
    dailyLookbackDays: number;
    reports: IntervalAuditReport[];
}

function parseArgs(argv: string[]): SyncOptions {
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
        symbols: (parsed.get('symbols') || DEFAULT_SYMBOLS.join(','))
            .split(',')
            .map((symbol) => symbol.trim().toUpperCase())
            .filter(Boolean),
        intervals: (parsed.get('intervals') || DEFAULT_INTERVALS.join(','))
            .split(',')
            .map((interval) => interval.trim())
            .filter(Boolean),
        startDate: parsed.get('start-date') || DEFAULT_START_DATE,
        dailyLookbackDays: Number.parseInt(parsed.get('daily-lookback-days') || String(DEFAULT_DAILY_LOOKBACK_DAYS), 10),
    };
}

function formatUtcDate(timestamp: number): string {
    const date = new Date(timestamp);
    const year = date.getUTCFullYear();
    const month = String(date.getUTCMonth() + 1).padStart(2, '0');
    const day = String(date.getUTCDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function formatUtcMonth(timestamp: number): string {
    const date = new Date(timestamp);
    const year = date.getUTCFullYear();
    const month = String(date.getUTCMonth() + 1).padStart(2, '0');
    return `${year}-${month}`;
}

function parseUtcDate(date: string): number {
    const match = date.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) {
        throw new Error(`Invalid UTC date: ${date}`);
    }

    return Date.UTC(
        Number.parseInt(match[1], 10),
        Number.parseInt(match[2], 10) - 1,
        Number.parseInt(match[3], 10),
    );
}

function getMonthStart(timestamp: number): number {
    const date = new Date(timestamp);
    return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1);
}

function addUtcMonths(timestamp: number, months: number): number {
    const date = new Date(timestamp);
    return Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, 1);
}

function addUtcDays(timestamp: number, days: number): number {
    return timestamp + (days * 24 * 60 * 60 * 1000);
}

function parseKlineCsv(content: string): KlineData[] {
    return content
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => line.split(','))
        .filter((cols) => cols.length >= 11)
        .map((cols) => ({
            openTime: Number.parseInt(cols[0], 10),
            open: cols[1],
            high: cols[2],
            low: cols[3],
            close: cols[4],
            volume: cols[5],
            closeTime: Number.parseInt(cols[6], 10),
            quoteVolume: cols[7],
            trades: Number.parseInt(cols[8], 10),
            takerBuyVolume: cols[9],
            takerBuyQuoteVolume: cols[10],
        }))
        .filter((kline) => Number.isFinite(kline.openTime) && Number.isFinite(kline.closeTime) && Number.isFinite(kline.trades));
}

function getArchiveDir(symbol: string, interval: string, bucket: ArchiveBucket): string {
    return buildPrimaryArchivePath(symbol, 'klines', interval, 'sources', bucket);
}

function buildRemoteZipPath(params: {
    symbol: string;
    interval: string;
    bucket: ArchiveBucket;
    label: string;
}): string {
    return `${BINANCE_DATA_BASE_URL}/futures/um/${params.bucket}/klines/${params.symbol}/${params.interval}/${params.symbol}-${params.interval}-${params.label}.zip`;
}

async function fetchText(url: string): Promise<string | null> {
    const response = await fetch(url);
    if (response.status === 404) {
        return null;
    }
    if (!response.ok) {
        throw new Error(`Failed to fetch ${url}: HTTP ${response.status}`);
    }

    return response.text();
}

async function fetchBuffer(url: string): Promise<Buffer | null> {
    const response = await fetch(url);
    if (response.status === 404) {
        return null;
    }
    if (!response.ok) {
        throw new Error(`Failed to fetch ${url}: HTTP ${response.status}`);
    }

    return Buffer.from(await response.arrayBuffer());
}

function parseChecksumFile(content: string, fileName: string): string {
    const line = content
        .split('\n')
        .map((value) => value.trim())
        .find((value) => value.includes(fileName));

    if (!line) {
        throw new Error(`Missing checksum entry for ${fileName}`);
    }

    const checksum = line.split(/\s+/)[0];
    if (!checksum) {
        throw new Error(`Invalid checksum file for ${fileName}`);
    }

    return checksum.toLowerCase();
}

function validateChecksum(buffer: Buffer, expectedChecksum: string, label: string) {
    const actual = crypto.createHash('sha256').update(buffer).digest('hex').toLowerCase();
    if (actual !== expectedChecksum) {
        throw new Error(`Checksum mismatch for ${label}: expected ${expectedChecksum}, got ${actual}`);
    }
}

async function unzipSingleCsv(zipPath: string): Promise<string> {
    const tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'binance-kline-archive-'));
    try {
        await execFileAsync('unzip', ['-o', zipPath, '-d', tempDir]);
        const entries = await fs.promises.readdir(tempDir);
        const csvName = entries.find((entry) => entry.endsWith(CSV_SUFFIX));
        if (!csvName) {
            throw new Error(`No CSV extracted from ${zipPath}`);
        }

        return await fs.promises.readFile(path.join(tempDir, csvName), 'utf-8');
    } finally {
        await fs.promises.rm(tempDir, { recursive: true, force: true });
    }
}

async function ensureArchiveCsv(params: {
    symbol: string;
    interval: string;
    bucket: ArchiveBucket;
    label: string;
}) {
    const sourceDir = getArchiveDir(params.symbol, params.interval, params.bucket);
    await fs.promises.mkdir(sourceDir, { recursive: true });

    const csvPath = path.join(sourceDir, `${params.symbol}-${params.interval}-${params.label}.csv`);
    if (fs.existsSync(csvPath)) {
        return;
    }

    const zipUrl = buildRemoteZipPath(params);
    const checksumText = await fetchText(`${zipUrl}.CHECKSUM`);
    if (!checksumText) {
        return;
    }

    const zipBuffer = await fetchBuffer(zipUrl);
    if (!zipBuffer) {
        return;
    }

    const zipFileName = path.basename(zipUrl);
    const checksum = parseChecksumFile(checksumText, zipFileName);
    validateChecksum(zipBuffer, checksum, zipFileName);

    const tempZipPath = path.join(os.tmpdir(), `${zipFileName}-${process.pid}-${Date.now()}`);
    try {
        await fs.promises.writeFile(tempZipPath, zipBuffer);
        const csvContent = await unzipSingleCsv(tempZipPath);
        await fs.promises.writeFile(csvPath, csvContent, 'utf-8');
    } finally {
        await fs.promises.rm(tempZipPath, { force: true });
    }
}

async function loadAllRawKlines(symbol: string, interval: string): Promise<KlineData[]> {
    const rawFiles = [
        ...await fs.promises.readdir(getArchiveDir(symbol, interval, 'monthly')).catch(() => []),
        ...await fs.promises.readdir(getArchiveDir(symbol, interval, 'daily')).catch(() => []),
    ]
        .filter((fileName) => fileName.endsWith(CSV_SUFFIX))
        .map((fileName) => {
            const bucket: ArchiveBucket = fileName.match(/^\w+-\w+-\d{4}-\d{2}\.csv$/) ? 'monthly' : 'daily';
            return path.join(getArchiveDir(symbol, interval, bucket), fileName);
        });

    const allKlines: KlineData[] = [];
    for (const filePath of rawFiles.sort()) {
        const content = await fs.promises.readFile(filePath, 'utf-8');
        allKlines.push(...parseKlineCsv(content));
    }

    return allKlines;
}

function buildMonthlyLabels(startDate: string): string[] {
    const labels: string[] = [];
    let cursor = getMonthStart(parseUtcDate(startDate));
    const now = Date.now();
    const thisMonthStart = getMonthStart(now);
    const lastClosedMonthStart = addUtcMonths(thisMonthStart, -1);

    while (cursor <= lastClosedMonthStart) {
        labels.push(formatUtcMonth(cursor));
        cursor = addUtcMonths(cursor, 1);
    }

    return labels;
}

function buildDailyLabels(dailyLookbackDays: number): string[] {
    const labels: string[] = [];
    const now = Date.now();
    const todayStart = parseUtcDate(formatUtcDate(now));
    const start = addUtcDays(todayStart, -Math.max(1, dailyLookbackDays));
    const end = addUtcDays(todayStart, -1);

    for (let cursor = start; cursor <= end; cursor = addUtcDays(cursor, 1)) {
        labels.push(formatUtcDate(cursor));
    }

    return labels;
}

function summarizeSymbolReadiness(reports: IntervalAuditReport[]): BacktestReadiness {
    if (reports.some((report) => report.readiness === 'not-ready')) {
        return 'not-ready';
    }
    if (reports.some((report) => report.readiness === 'exploratory-only')) {
        return 'exploratory-only';
    }

    return 'ready';
}

async function syncSymbolInterval(symbol: string, interval: string, options: SyncOptions): Promise<IntervalAuditReport> {
    console.log(`\n[SYNC] ${symbol} ${interval}`);
    const monthlyLabels = buildMonthlyLabels(options.startDate);
    const dailyLabels = buildDailyLabels(options.dailyLookbackDays);

    for (const label of monthlyLabels) {
        await ensureArchiveCsv({
            symbol,
            interval,
            bucket: 'monthly',
            label,
        });
    }

    for (const label of dailyLabels) {
        await ensureArchiveCsv({
            symbol,
            interval,
            bucket: 'daily',
            label,
        });
    }

    const mergedBars = await loadAllRawKlines(symbol, interval);
    const audit = writeMergedKlineArchive({
        symbol,
        interval,
        klines: mergedBars,
    });

    return {
        symbol,
        interval,
        totalBars: audit.totalBars,
        coverageStart: audit.coverageStartTime ? new Date(audit.coverageStartTime).toISOString() : null,
        coverageEnd: audit.coverageEndTime ? new Date(audit.coverageEndTime).toISOString() : null,
        gapCount: audit.gapCount,
        missingBars: audit.missingBars,
        maxGapBars: audit.maxGapBars,
        lagBars: audit.lagBars,
        readiness: audit.readiness,
    };
}

async function writeSummaryReport(summary: SyncSummary) {
    const reportDir = getArchiveReportDir();
    await fs.promises.mkdir(reportDir, { recursive: true });
    const fileName = `binance-kline-sync-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
    const filePath = path.join(reportDir, fileName);
    await fs.promises.writeFile(filePath, `${JSON.stringify(summary, null, 2)}\n`, 'utf-8');
    return filePath;
}

async function main() {
    const options = parseArgs(process.argv.slice(2));
    const reports: IntervalAuditReport[] = [];

    console.log(`[SYNC] Binance official archive -> futures/um`);
    console.log(`[SYNC] Symbols: ${options.symbols.join(', ')}`);
    console.log(`[SYNC] Intervals: ${options.intervals.join(', ')}`);
    console.log(`[SYNC] Monthly start: ${options.startDate}`);
    console.log(`[SYNC] Daily lookback: ${options.dailyLookbackDays} days`);

    for (const symbol of options.symbols) {
        for (const interval of options.intervals) {
            reports.push(await syncSymbolInterval(symbol, interval, options));
        }
    }

    const summary: SyncSummary = {
        generatedAt: new Date().toISOString(),
        market: 'futures/um',
        source: 'data.binance.vision',
        symbols: options.symbols,
        intervals: options.intervals,
        startDate: options.startDate,
        dailyLookbackDays: options.dailyLookbackDays,
        reports,
    };

    const reportPath = await writeSummaryReport(summary);
    console.log('\n[AUDIT]');
    options.symbols.forEach((symbol) => {
        const symbolReports = reports.filter((report) => report.symbol === symbol);
        const readiness = summarizeSymbolReadiness(symbolReports);
        console.log(`- ${symbol}: ${readiness}`);
        symbolReports.forEach((report) => {
            console.log(
                `  ${report.interval}: ${report.coverageStart || 'n/a'} -> ${report.coverageEnd || 'n/a'}, ` +
                `bars=${report.totalBars}, gaps=${report.gapCount}, missingBars=${report.missingBars}, readiness=${report.readiness}`,
            );
        });
    });
    console.log(`\n[REPORT] ${reportPath}`);
}

main().catch((error) => {
    console.error('[SYNC] failed:', error);
    process.exitCode = 1;
});
