import { KlineData } from '@/app/api/backtest/klines/route';

interface BacktestExecutionProviderOptions {
    interval: string;
    startTime: number;
    endTime: number;
    baseKlines?: KlineData[];
    fetchRangeData?: (startTime: number, endTime: number) => Promise<KlineData[]>;
}

function getIntervalMs(interval: string): number {
    const match = interval.match(/^(\d+)(m|h|d|w|M)$/);
    if (!match) {
        throw new Error(`不支持的执行周期: ${interval}`);
    }

    const value = Number.parseInt(match[1], 10);
    const unit = match[2];

    switch (unit) {
        case 'm':
            return value * 60 * 1000;
        case 'h':
            return value * 60 * 60 * 1000;
        case 'd':
            return value * 24 * 60 * 60 * 1000;
        case 'w':
            return value * 7 * 24 * 60 * 60 * 1000;
        case 'M':
            return value * 30 * 24 * 60 * 60 * 1000;
        default:
            throw new Error(`不支持的执行周期: ${interval}`);
    }
}

function upperBoundByCloseTime(klines: KlineData[], timestamp: number): number {
    let left = 0;
    let right = klines.length;

    while (left < right) {
        const mid = Math.floor((left + right) / 2);
        if (klines[mid].closeTime <= timestamp) {
            left = mid + 1;
        } else {
            right = mid;
        }
    }

    return left;
}

export class BacktestExecutionProvider {
    private readonly intervalMs: number;
    private readonly chunkMs: number;
    private readonly endTime: number;
    private readonly baseKlines?: KlineData[];
    private readonly fetchRangeData?: (startTime: number, endTime: number) => Promise<KlineData[]>;

    private readonly loadedKlines: KlineData[] = [];
    private nextFetchStartTime: number;

    constructor(options: BacktestExecutionProviderOptions) {
        this.intervalMs = getIntervalMs(options.interval);
        this.chunkMs = this.intervalMs * 1200;
        this.endTime = options.endTime;
        this.baseKlines = options.baseKlines;
        this.fetchRangeData = options.fetchRangeData;
        this.nextFetchStartTime = options.startTime;

        if (!this.baseKlines && !this.fetchRangeData) {
            throw new Error('缺少执行层 K 线数据源');
        }
    }

    async getBarsBetween(startExclusive: number, endInclusive: number): Promise<KlineData[]> {
        const cappedEnd = Math.min(endInclusive, this.endTime);
        if (cappedEnd <= startExclusive) {
            return [];
        }

        const source = this.baseKlines ?? await this.loadUntil(cappedEnd);
        const startIndex = upperBoundByCloseTime(source, startExclusive);
        const endIndexExclusive = upperBoundByCloseTime(source, cappedEnd);

        return source.slice(startIndex, endIndexExclusive);
    }

    private async loadUntil(targetTime: number): Promise<KlineData[]> {
        if (this.baseKlines) {
            return this.baseKlines;
        }

        while (
            this.loadedKlines.length === 0 ||
            this.loadedKlines[this.loadedKlines.length - 1].closeTime < targetTime
        ) {
            if (!this.fetchRangeData || this.nextFetchStartTime > this.endTime) {
                break;
            }

            const chunkEnd = Math.min(this.endTime, this.nextFetchStartTime + this.chunkMs);
            const fetched = await this.fetchRangeData(this.nextFetchStartTime, chunkEnd);

            if (fetched.length > 0) {
                const existingLastCloseTime = this.loadedKlines[this.loadedKlines.length - 1]?.closeTime ?? -1;
                fetched
                    .filter((kline) => kline.closeTime > existingLastCloseTime)
                    .forEach((kline) => this.loadedKlines.push(kline));

                const fetchedEnd = fetched[fetched.length - 1].closeTime;
                this.nextFetchStartTime = Math.max(chunkEnd + 1, fetchedEnd + 1);
            } else {
                this.nextFetchStartTime = chunkEnd + 1;
            }
        }

        return this.loadedKlines;
    }
}
