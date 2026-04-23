import fs from 'fs';
import path from 'path';

import type { KlineData } from '../../app/api/backtest/klines/route.ts';
import { getKlineIntervalMs } from '../binanceKlineFetcher.ts';
import { detectKlineGaps } from '../klineRangeUtils.ts';
import {
    buildPrimaryArchivePath,
    resolveReadableArchivePath,
} from './archiveRoots.ts';

export type BacktestReadiness = 'ready' | 'exploratory-only' | 'not-ready';

export interface LocalKlineArchiveAudit {
    symbol: string;
    interval: string;
    intervalMs: number;
    totalBars: number;
    coverageStartTime: number | null;
    coverageEndTime: number | null;
    gapCount: number;
    missingBars: number;
    maxGapBars: number;
    lagBars: number;
    readiness: BacktestReadiness;
    lastUpdatedAt: number | null;
}

interface CachedArchive {
    mtimeMs: number;
    klines: KlineData[];
    audit: LocalKlineArchiveAudit;
}

const archiveCache = new Map<string, CachedArchive>();
const CSV_HEADER = 'openTime,open,high,low,close,volume,closeTime,quoteVolume,trades,takerBuyVolume,takerBuyQuoteVolume';

function archiveKey(symbol: string, interval: string): string {
    return `${symbol.toUpperCase()}:${interval}`;
}

function buildArchiveDir(symbol: string, interval: string): string {
    return buildPrimaryArchivePath(symbol, 'klines', interval);
}

export function getArchiveMergedCsvPath(symbol: string, interval: string): string {
    return path.join(buildArchiveDir(symbol, interval), 'merged.csv');
}

export function getArchiveAuditPath(symbol: string, interval: string): string {
    return path.join(buildArchiveDir(symbol, interval), 'audit.json');
}

function parseCsvLine(line: string): KlineData | null {
    const cols = line.split(',');
    if (cols.length < 11) {
        return null;
    }

    const openTime = Number.parseInt(cols[0], 10);
    const closeTime = Number.parseInt(cols[6], 10);
    const trades = Number.parseInt(cols[8], 10);

    if (!Number.isFinite(openTime) || !Number.isFinite(closeTime) || !Number.isFinite(trades)) {
        return null;
    }

    return {
        openTime,
        open: cols[1],
        high: cols[2],
        low: cols[3],
        close: cols[4],
        volume: cols[5],
        closeTime,
        quoteVolume: cols[7],
        trades,
        takerBuyVolume: cols[9],
        takerBuyQuoteVolume: cols[10],
    };
}

export function mergeKlineDatasets(...datasets: KlineData[][]): KlineData[] {
    const deduped = new Map<number, KlineData>();

    datasets.forEach((dataset) => {
        dataset.forEach((kline) => {
            if (Number.isFinite(kline.closeTime)) {
                deduped.set(kline.closeTime, kline);
            }
        });
    });

    return Array.from(deduped.values()).sort((left, right) => left.closeTime - right.closeTime);
}

function getLatestClosedBarCloseTime(now: number, intervalMs: number): number {
    const lastClosedOpenTime = Math.floor((Math.max(0, now - 1)) / intervalMs) * intervalMs;
    return lastClosedOpenTime + intervalMs - 1;
}

export function assessKlineReadiness(params: {
    symbol: string;
    interval: string;
    intervalMs: number;
    klines: KlineData[];
    now?: number;
}): LocalKlineArchiveAudit {
    const { symbol, interval, intervalMs, klines } = params;
    const now = params.now ?? Date.now();
    const totalBars = klines.length;
    const coverageStartTime = totalBars > 0 ? klines[0].openTime : null;
    const coverageEndTime = totalBars > 0 ? klines[totalBars - 1].closeTime : null;
    const { gapCount, missingBars, maxGapBars } = detectKlineGaps(klines, intervalMs);
    const latestClosedBarCloseTime = getLatestClosedBarCloseTime(now, intervalMs);
    const lagBars = coverageEndTime !== null && coverageEndTime < latestClosedBarCloseTime
        ? Math.max(0, Math.round((latestClosedBarCloseTime - coverageEndTime) / intervalMs))
        : 0;

    let readiness: BacktestReadiness = 'not-ready';
    if (totalBars === 0) {
        readiness = 'not-ready';
    } else if (gapCount === 0 && lagBars <= 1) {
        readiness = 'ready';
    } else if ((gapCount <= 3 && missingBars <= 24) || lagBars <= 7) {
        readiness = 'exploratory-only';
    }

    return {
        symbol: symbol.toUpperCase(),
        interval,
        intervalMs,
        totalBars,
        coverageStartTime,
        coverageEndTime,
        gapCount,
        missingBars,
        maxGapBars,
        lagBars,
        readiness,
        lastUpdatedAt: coverageEndTime,
    };
}

export function loadLocalKlineArchive(symbol: string, interval: string): CachedArchive | null {
    const mergedPath = resolveReadableArchivePath(symbol, 'klines', interval, 'merged.csv');
    if (!mergedPath || !fs.existsSync(mergedPath)) {
        return null;
    }

    const stats = fs.statSync(mergedPath);
    const cacheKey = archiveKey(symbol, interval);
    const cached = archiveCache.get(cacheKey);
    if (cached && cached.mtimeMs === stats.mtimeMs) {
        return cached;
    }

    const raw = fs.readFileSync(mergedPath, 'utf-8');
    const klines = raw
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
        .filter((line) => line !== CSV_HEADER)
        .map(parseCsvLine)
        .filter((kline): kline is KlineData => Boolean(kline));
    const intervalMs = getKlineIntervalMs(interval);
    if (!intervalMs) {
        return null;
    }

    const archive = {
        mtimeMs: stats.mtimeMs,
        klines,
        audit: assessKlineReadiness({
            symbol,
            interval,
            intervalMs,
            klines,
        }),
    };
    archiveCache.set(cacheKey, archive);
    return archive;
}

export function getLocalKlinesInRange(params: {
    symbol: string;
    interval: string;
    startTime: number;
    endTime: number;
    limit?: number;
}): {
    klines: KlineData[];
    audit: LocalKlineArchiveAudit | null;
    fullyCovered: boolean;
} {
    const archive = loadLocalKlineArchive(params.symbol, params.interval);
    if (!archive) {
        return {
            klines: [],
            audit: null,
            fullyCovered: false,
        };
    }

    const klines = archive.klines
        .filter((kline) => kline.openTime >= params.startTime && kline.closeTime <= params.endTime)
        .slice(0, params.limit ?? Number.MAX_SAFE_INTEGER);
    const fullyCovered = archive.audit.readiness === 'ready'
        && archive.audit.coverageStartTime !== null
        && archive.audit.coverageEndTime !== null
        && archive.audit.coverageStartTime <= params.startTime
        && archive.audit.coverageEndTime >= params.endTime;

    return {
        klines,
        audit: archive.audit,
        fullyCovered,
    };
}

export function writeMergedKlineArchive(params: {
    symbol: string;
    interval: string;
    klines: KlineData[];
}): LocalKlineArchiveAudit {
    const archiveDir = buildArchiveDir(params.symbol, params.interval);
    fs.mkdirSync(archiveDir, { recursive: true });

    const mergedPath = getArchiveMergedCsvPath(params.symbol, params.interval);
    const intervalMs = getKlineIntervalMs(params.interval);
    if (!intervalMs) {
        throw new Error(`Unsupported interval: ${params.interval}`);
    }

    const dedupedSorted = mergeKlineDatasets(params.klines);
    const lines = [
        CSV_HEADER,
        ...dedupedSorted.map((kline) => [
            kline.openTime,
            kline.open,
            kline.high,
            kline.low,
            kline.close,
            kline.volume,
            kline.closeTime,
            kline.quoteVolume,
            kline.trades,
            kline.takerBuyVolume,
            kline.takerBuyQuoteVolume,
        ].join(',')),
    ];
    fs.writeFileSync(mergedPath, `${lines.join('\n')}\n`, 'utf-8');

    const audit = assessKlineReadiness({
        symbol: params.symbol,
        interval: params.interval,
        intervalMs,
        klines: dedupedSorted,
    });
    fs.writeFileSync(getArchiveAuditPath(params.symbol, params.interval), `${JSON.stringify(audit, null, 2)}\n`, 'utf-8');
    archiveCache.delete(archiveKey(params.symbol, params.interval));
    return audit;
}
