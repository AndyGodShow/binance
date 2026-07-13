import fs from 'fs';
import path from 'path';
import { execFile } from 'child_process';
import util from 'util';
import { readRuntimeEnv } from '../env.ts';
import {
    buildPrimaryArchivePath,
    getArchiveReadRoots,
    getArchiveWriteRoot,
} from './archiveRoots.ts';

const execFilePromise = util.promisify(execFile);
const DAY_MS = 24 * 60 * 60 * 1000;

// 检测是否在 Serverless 环境（Vercel 等）
const isServerless = readRuntimeEnv().isServerless;

type DataType = 'metrics' | 'fundingRate';
type FormattedMetricData = {
    timestamp: number;
    openInterest: string;
    openInterestValue: string;
};

type FormattedFundingRateData = {
    fundingTime: number;
    fundingRate: string;
};

type FormattedData = FormattedMetricData | FormattedFundingRateData;

export type DataDownloadDayResult =
    | { date: string; status: 'downloaded' | 'cached' }
    | { date: string; status: 'failed'; stage: 'download' | 'validate' | 'extract'; error: string };

export interface DataDownloadResult {
    status: 'success' | 'partial' | 'failed' | 'unsupported';
    totalDays: number;
    completedDays: number;
    failedDays: number;
    days: DataDownloadDayResult[];
}

export function summarizeDataDownloadDays(days: DataDownloadDayResult[]): DataDownloadResult {
    const completedDays = days.filter((day) => day.status !== 'failed').length;
    const failedDays = days.length - completedDays;
    return {
        status: failedDays === 0 ? 'success' : completedDays === 0 ? 'failed' : 'partial',
        totalDays: days.length,
        completedDays,
        failedDays,
        days,
    };
}

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

function runtimeExistsSync(targetPath: string): boolean {
    return fs.existsSync(/* turbopackIgnore: true */ targetPath);
}

function parseUtcDateString(date: string): number {
    const match = date.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) {
        return NaN;
    }

    const year = Number.parseInt(match[1], 10);
    const month = Number.parseInt(match[2], 10);
    const day = Number.parseInt(match[3], 10);
    return Date.UTC(year, month - 1, day);
}

function formatUtcDateString(timestamp: number): string {
    const date = new Date(timestamp);
    const year = date.getUTCFullYear();
    const month = String(date.getUTCMonth() + 1).padStart(2, '0');
    const day = String(date.getUTCDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

class DataCollector {
    private baseUrl = 'https://data.binance.vision/data/futures/um/daily';

    constructor() {
        const archiveRoot = getArchiveWriteRoot();
        if (!isServerless) {
            if (!runtimeExistsSync(archiveRoot)) {
                fs.mkdirSync(archiveRoot, { recursive: true });
            }
        }
    }

    /**
     * Download data for a specific date range
     */
    async downloadData(symbol: string, type: DataType, startDate: string, endDate: string): Promise<DataDownloadResult> {
        if (isServerless) {
            console.warn('[DataCollector] Serverless 环境不支持本地数据下载');
            return {
                status: 'unsupported',
                totalDays: 0,
                completedDays: 0,
                failedDays: 0,
                days: [],
            };
        }
        // Validate symbol to prevent path traversal or injection
        if (!/^[A-Z0-9]+$/i.test(symbol)) {
            throw new Error(`Invalid symbol: ${symbol}`);
        }
        const start = parseUtcDateString(startDate);
        const end = parseUtcDateString(endDate);
        if (!Number.isFinite(start) || !Number.isFinite(end) || start > end) {
            throw new Error(`Invalid date range: ${startDate} - ${endDate}`);
        }
        const symbolDir = buildPrimaryArchivePath(symbol, type);

        if (!runtimeExistsSync(symbolDir)) {
            fs.mkdirSync(symbolDir, { recursive: true });
        }

        console.log(`Starting download for ${symbol} ${type} from ${startDate} to ${endDate}...`);
        const dayResults: DataDownloadDayResult[] = [];

        for (let currentDay = start; currentDay <= end; currentDay += DAY_MS) {
            const dateStr = formatUtcDateString(currentDay);
            const fileName = `${symbol.toUpperCase()}-${type}-${dateStr}`;
            const zipName = `${fileName}.zip`;
            const localZipPath = path.join(/* turbopackIgnore: true */ symbolDir, zipName);
            const localCsvPath = path.join(/* turbopackIgnore: true */ symbolDir, `${fileName}.csv`);

            // If CSV already exists, skip
            if (runtimeExistsSync(localCsvPath)) {
                console.log(`Using cached: ${fileName}`);
                dayResults.push({ date: dateStr, status: 'cached' });
                continue;
            }

            const url = `${this.baseUrl}/${type}/${symbol.toUpperCase()}/${zipName}`;

            try {
                console.log(`Downloading ${url}...`);
                await execFilePromise('curl', [
                    '--fail', '--silent', '--show-error', '--remove-on-error',
                    '--connect-timeout', '10', '--max-time', '90',
                    '--retry', '2', '--retry-delay', '1', '--retry-connrefused',
                    '-o', localZipPath, url,
                ]);
            } catch (error) {
                if (runtimeExistsSync(localZipPath)) {
                    fs.unlinkSync(localZipPath);
                }
                dayResults.push({ date: dateStr, status: 'failed', stage: 'download', error: errorMessage(error) });
                console.error(`Failed to download ${dateStr}:`, error);
                continue;
            }

            try {
                const stats = fs.statSync(localZipPath);
                if (stats.size < 1000) {
                    fs.unlinkSync(localZipPath);
                    dayResults.push({
                        date: dateStr,
                        status: 'failed',
                        stage: 'validate',
                        error: `Archive is too small (${stats.size} bytes)`,
                    });
                    continue;
                }
            } catch (error) {
                dayResults.push({ date: dateStr, status: 'failed', stage: 'validate', error: errorMessage(error) });
                continue;
            }

            try {
                console.log(`Unzipping ${zipName}...`);
                await execFilePromise('unzip', ['-o', localZipPath, '-d', symbolDir]);
                fs.unlinkSync(localZipPath);
                if (!runtimeExistsSync(localCsvPath) || fs.statSync(localCsvPath).size === 0) {
                    dayResults.push({
                        date: dateStr,
                        status: 'failed',
                        stage: 'extract',
                        error: 'Extracted CSV is missing or empty',
                    });
                    continue;
                }
                dayResults.push({ date: dateStr, status: 'downloaded' });
            } catch (error) {
                if (runtimeExistsSync(localZipPath)) {
                    fs.unlinkSync(localZipPath);
                }
                dayResults.push({ date: dateStr, status: 'failed', stage: 'extract', error: errorMessage(error) });
                console.error(`Failed to process ${dateStr}:`, error);
            }
        }

        const result = summarizeDataDownloadDays(dayResults);
        console.log(`Download ${result.status} for ${symbol} ${type}: ${result.completedDays}/${result.totalDays} days available`);
        return result;
    }

    /**
     * Check data coverage for a given time range
     * Returns percentage of days that have local data
     */
    checkDataCoverage(symbol: string, type: DataType, startDate: string, endDate: string): {
        coveragePercent: number;
        totalDays: number;
        availableDays: number;
        missingDates: string[];
    } {
        if (isServerless) {
            return { coveragePercent: 0, totalDays: 0, availableDays: 0, missingDates: [] };
        }
        const start = parseUtcDateString(startDate);
        const end = parseUtcDateString(endDate);
        if (!Number.isFinite(start) || !Number.isFinite(end) || start > end) {
            return { coveragePercent: 0, totalDays: 0, availableDays: 0, missingDates: [] };
        }
        const totalDays = Math.floor((end - start) / DAY_MS) + 1;
        let availableDays = 0;
        const missingDates: string[] = [];

        // Check each day
        for (let currentDay = start; currentDay <= end; currentDay += DAY_MS) {
            const dateStr = formatUtcDateString(currentDay);
            const fileName = `${symbol.toUpperCase()}-${type}-${dateStr}.csv`;
            const exists = getArchiveReadRoots().some((root) => {
                const candidate = path.join(/* turbopackIgnore: true */ root, symbol.toUpperCase(), type, fileName);
                return runtimeExistsSync(candidate);
            });

            if (exists) {
                availableDays++;
            } else {
                missingDates.push(dateStr);
            }
        }

        return {
            coveragePercent: (availableDays / totalDays) * 100,
            totalDays,
            availableDays,
            missingDates: missingDates.slice(0, 10) // Return first 10 missing dates
        };
    }



    /**
     * Read parsed data from local storage
     */
    async getFormattedData(symbol: string, type: 'metrics', startTime: number, endTime: number): Promise<FormattedMetricData[]>;
    async getFormattedData(symbol: string, type: 'fundingRate', startTime: number, endTime: number): Promise<FormattedFundingRateData[]>;
    async getFormattedData(symbol: string, type: DataType, startTime: number, endTime: number): Promise<FormattedData[]> {
        if (isServerless) return [];
        const allData: FormattedData[] = [];
        const processedFiles = new Set<string>();

        for (const root of getArchiveReadRoots()) {
            const symbolDir = path.join(/* turbopackIgnore: true */ root, symbol.toUpperCase(), type);
            if (!runtimeExistsSync(symbolDir)) {
                continue;
            }

            const files = fs.readdirSync(symbolDir).filter((file) => file.endsWith('.csv'));

            for (const file of files) {
                if (processedFiles.has(file)) {
                    continue;
                }

                const dateMatch = file.match(/\d{4}-\d{2}-\d{2}/);
                if (!dateMatch) continue;

                const fileDate = parseUtcDateString(dateMatch[0]);
                if (!Number.isFinite(fileDate) || fileDate > endTime || fileDate + DAY_MS < startTime) continue;

                const filePath = path.join(/* turbopackIgnore: true */ symbolDir, file);
                const content = fs.readFileSync(filePath, 'utf-8');
                const lines = content.trim().split('\n');
                const startIndex = lines[0].startsWith('create_time') || lines[0].startsWith('calc_time') ? 1 : 0;

                for (let i = startIndex; i < lines.length; i++) {
                    const line = lines[i].trim();
                    if (!line) continue;

                    const cols = line.split(',');
                    if (cols.length < 2) continue;

                    if (type === 'metrics') {
                        if (cols.length < 4) continue;
                        const timestamp = new Date(cols[0]).getTime();
                        if (isNaN(timestamp)) continue;

                        if (timestamp >= startTime && timestamp <= endTime) {
                            allData.push({
                                timestamp,
                                openInterest: cols[2],
                                openInterestValue: cols[3]
                            });
                        }
                    } else if (type === 'fundingRate') {
                        let ts = 0;
                        if (cols[0].match(/^\d+$/)) {
                            ts = parseInt(cols[0]);
                        } else {
                            ts = new Date(cols[0]).getTime();
                        }

                        if (!isNaN(ts) && ts >= startTime && ts <= endTime) {
                            allData.push({
                                fundingTime: ts,
                                fundingRate: cols[1]
                            });
                        }
                    }
                }

                processedFiles.add(file);
            }
        }

        return allData.sort((a, b) => {
            const leftTime = 'timestamp' in a ? a.timestamp : a.fundingTime;
            const rightTime = 'timestamp' in b ? b.timestamp : b.fundingTime;
            return leftTime - rightTime;
        });
    }
}

export const dataCollector = new DataCollector();
