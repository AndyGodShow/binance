import fs from 'fs';
import path from 'path';
import { execFile } from 'child_process';
import util from 'util';

const execFilePromise = util.promisify(execFile);
const DAY_MS = 24 * 60 * 60 * 1000;

// 检测是否在 Serverless 环境（Vercel 等）
const isServerless = !!(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME || process.env.SERVERLESS);

export type DataType = 'metrics' | 'fundingRate';

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

export class DataCollector {
    private dataDir: string;
    private baseUrl = 'https://data.binance.vision/data/futures/um/daily';

    constructor() {
        this.dataDir = path.join(process.cwd(), 'data', 'historical');
        if (!isServerless) {
            if (!fs.existsSync(this.dataDir)) {
                fs.mkdirSync(this.dataDir, { recursive: true });
            }
        }
    }

    /**
     * Download data for a specific date range
     */
    async downloadData(symbol: string, type: DataType, startDate: string, endDate: string) {
        if (isServerless) {
            console.warn('[DataCollector] Serverless 环境不支持本地数据下载');
            return;
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
        const symbolDir = path.join(this.dataDir, symbol.toUpperCase(), type);

        if (!fs.existsSync(symbolDir)) {
            fs.mkdirSync(symbolDir, { recursive: true });
        }

        console.log(`Starting download for ${symbol} ${type} from ${startDate} to ${endDate}...`);

        for (let currentDay = start; currentDay <= end; currentDay += DAY_MS) {
            const dateStr = formatUtcDateString(currentDay);
            const fileName = `${symbol.toUpperCase()}-${type}-${dateStr}`;
            const zipName = `${fileName}.zip`;
            const localZipPath = path.join(symbolDir, zipName);
            const localCsvPath = path.join(symbolDir, `${fileName}.csv`);

            // If CSV already exists, skip
            if (fs.existsSync(localCsvPath)) {
                console.log(`Using cached: ${fileName}`);
                continue;
            }

            const url = `${this.baseUrl}/${type}/${symbol.toUpperCase()}/${zipName}`;

            try {
                // Download
                console.log(`Downloading ${url}...`);
                await execFilePromise('curl', ['-s', '-o', localZipPath, url]);

                // Check if file is valid (not empty and is a zip)
                const stats = fs.statSync(localZipPath);
                if (stats.size < 1000) {
                    console.warn(`File too small, possibly missing data: ${zipName}`);
                    fs.unlinkSync(localZipPath); // Delete invalid file
                    continue;
                }

                // Unzip
                console.log(`Unzipping ${zipName}...`);
                await execFilePromise('unzip', ['-o', localZipPath, '-d', symbolDir]);

                // Clean up zip
                fs.unlinkSync(localZipPath);

            } catch (error) {
                console.error(`Failed to process ${dateStr}:`, error);
            }
        }

        console.log(`Download completed for ${symbol} ${type}`);
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
        const symbolDir = path.join(this.dataDir, symbol.toUpperCase(), type);

        const totalDays = Math.floor((end - start) / DAY_MS) + 1;
        let availableDays = 0;
        const missingDates: string[] = [];

        // Check if directory exists
        if (!fs.existsSync(symbolDir)) {
            // No data at all
            for (let currentDay = start; currentDay <= end; currentDay += DAY_MS) {
                missingDates.push(formatUtcDateString(currentDay));
            }
            return {
                coveragePercent: 0,
                totalDays,
                availableDays: 0,
                missingDates
            };
        }

        // Check each day
        for (let currentDay = start; currentDay <= end; currentDay += DAY_MS) {
            const dateStr = formatUtcDateString(currentDay);
            const fileName = `${symbol.toUpperCase()}-${type}-${dateStr}.csv`;
            const filePath = path.join(symbolDir, fileName);

            if (fs.existsSync(filePath)) {
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
    async getFormattedData(symbol: string, type: DataType, startTime: number, endTime: number): Promise<any[]> {
        if (isServerless) return [];
        const symbolDir = path.join(this.dataDir, symbol.toUpperCase(), type);
        if (!fs.existsSync(symbolDir)) return [];

        const files = fs.readdirSync(symbolDir).filter(f => f.endsWith('.csv'));
        let allData: any[] = [];

        for (const file of files) {
            // Check if file date is within range (optimization)
            // Filename format: SYMBOL-type-YYYY-MM-DD.csv
            const dateMatch = file.match(/\d{4}-\d{2}-\d{2}/);
            if (!dateMatch) continue;

            const fileDate = parseUtcDateString(dateMatch[0]);
            // Simple bound check: file covers the whole day. 
            // If fileDate is strictly after endTime (day start > requested end), skip.
            // If fileDate + 24h is strictly before startTime (day end < requested start), skip.
            if (!Number.isFinite(fileDate) || fileDate > endTime || fileDate + DAY_MS < startTime) continue;

            const filePath = path.join(symbolDir, file);
            const content = fs.readFileSync(filePath, 'utf-8');
            const lines = content.trim().split('\n');

            // Skip header if present (Binance CSVs usually start with header or just data? Check later. Usually Headers)
            // Metrics CSV: create_time, ...
            // Funding CSV: calc_time, ...
            const startIndex = lines[0].startsWith('create_time') || lines[0].startsWith('calc_time') ? 1 : 0;

            for (let i = startIndex; i < lines.length; i++) {
                const line = lines[i].trim();
                if (!line) continue; // Skip empty lines

                const cols = line.split(',');
                if (cols.length < 2) continue; // Skip invalid lines

                if (type === 'metrics') {
                    // create_time, symbol, sum_open_interest, sum_open_interest_value, ...
                    if (cols.length < 4) continue; // Need at least 4 columns
                    const timestamp = new Date(cols[0]).getTime();
                    if (isNaN(timestamp)) continue; // Invalid timestamp

                    if (timestamp >= startTime && timestamp <= endTime) {
                        allData.push({
                            timestamp,
                            openInterest: cols[2],
                            openInterestValue: cols[3]
                        });
                    }
                } else if (type === 'fundingRate') {
                    // calc_time, funding_rate, symbol
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
        }

        return allData.sort((a, b) => (a.timestamp || a.fundingTime) - (b.timestamp || b.fundingTime));
    }
}

export const dataCollector = new DataCollector();
