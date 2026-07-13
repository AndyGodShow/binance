import type { TickerData } from './types.ts';
import type { Trade } from './backtestEngine.ts';
import { selectBacktestSymbolsByVolume } from './backtestSymbolSelection.ts';
import {
    type ExecutionIntervalOption,
} from './backtestSymbolValidation.ts';
import { resolveStrategyIntervalsWithOverrides } from './weiShenStrategy.ts';
import { filterWeiShenUniverseSymbols, getDefaultUniverseForStrategy } from './weiShenUniverse.ts';
import type { DeepPartial, StrategyParameterConfigMap } from './strategyParameters.ts';

const TRADE_PAGE_SIZE = 20;

export interface DownloadRequestResult {
    ok: boolean;
    status: number;
    message: string;
    unsupported: boolean;
}

export interface CoverageResult {
    coveragePercent: number;
    totalDays: number;
    availableDays: number;
    missingDates: string[];
}

export type BacktestSymbolSource = 'top' | 'range' | 'custom';

export async function resolveBacktestSymbols({
    selectedStrategy,
    symbolSource,
    customSymbols,
    rangeStart,
    rangeEnd,
    topN,
}: {
    selectedStrategy: string;
    symbolSource: BacktestSymbolSource;
    customSymbols: string;
    rangeStart: number;
    rangeEnd: number;
    topN: number;
}): Promise<string[]> {
    const strategyUniverse = getDefaultUniverseForStrategy(selectedStrategy);
    if (strategyUniverse) {
        if (symbolSource === 'custom') {
            const filtered = filterWeiShenUniverseSymbols(parseCustomSymbols(customSymbols));
            if (filtered.length === 0) {
                throw new Error('魏神策略只允许 BTCUSDT / ETHUSDT / SOLUSDT / XRPUSDT / DOGEUSDT');
            }
            return filtered;
        }
        return [...strategyUniverse];
    }

    if (symbolSource === 'range') {
        const start = Math.max(1, Math.floor(rangeStart));
        const end = Math.max(start, Math.floor(rangeEnd));
        const symbols = await fetchSymbolsByVolume();
        const sliced = symbols.slice(start - 1, end);
        if (sliced.length === 0) throw new Error('成交额区间没有可回测币种');
        return sliced;
    }

    if (symbolSource === 'custom') {
        const symbols = parseCustomSymbols(customSymbols);
        if (symbols.length === 0) throw new Error('请至少输入一个自定义币种');
        return symbols;
    }

    const candidateLimit = Math.max(topN * 3, topN + 20);
    const topCandidates = (await fetchSymbolsByVolume()).slice(0, candidateLimit);
    if (topCandidates.length === 0) throw new Error('未获取到可回测币种');
    return topCandidates;
}

export function getTargetSupportedSymbolCount(
    symbolSource: BacktestSymbolSource,
    topN: number,
    candidateCount: number,
): number {
    return symbolSource === 'top' ? Math.min(topN, candidateCount) : candidateCount;
}

export const formatDuration = (ms: number) => {
        const hours = Math.floor(ms / (1000 * 60 * 60));
        const minutes = Math.floor((ms % (1000 * 60 * 60)) / (1000 * 60));
        if (hours > 0) return `${hours}小时${minutes}分钟`;
        return `${minutes}分钟`;
    };

export const formatSignedPercent = (value: number) => `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`;
export const formatSignedUsdt = (value: number) => `${value >= 0 ? '+' : ''}${value.toFixed(2)} USDT`;
export const formatProfitFactor = (value: number, totalTrades: number) => {
        if (totalTrades === 0) {
            return '--';
        }
        if (!Number.isFinite(value)) {
            return '∞';
        }
        return value.toFixed(2);
    };
export const paginateTrades = (trades: Trade[], page: number) => {
        const orderedTrades = [...trades].reverse();
        const totalPages = Math.max(1, Math.ceil(orderedTrades.length / TRADE_PAGE_SIZE));
        const currentPage = Math.min(page, totalPages);
        const startIndex = (currentPage - 1) * TRADE_PAGE_SIZE;

        return {
            currentPage,
            totalPages,
            visibleTrades: orderedTrades.slice(startIndex, startIndex + TRADE_PAGE_SIZE),
        };
    };

export async function requestHistoricalDataDownload(
    symbol: string,
    type: 'metrics' | 'fundingRate',
    startDate: string,
    endDate: string
): Promise<DownloadRequestResult> {
    try {
        const response = await fetch('/api/data/download', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ symbol, type, startDate, endDate }),
        });

        const payload = await response.json().catch(() => null);
        const message = typeof payload?.error === 'string'
            ? payload.error
            : typeof payload?.message === 'string'
                ? payload.message
                : `HTTP ${response.status}`;

        return {
            ok: response.ok,
            status: response.status,
            message,
            unsupported: payload?.status === 'unsupported',
        };
    } catch (error) {
        return {
            ok: false,
            status: 0,
            message: error instanceof Error ? error.message : '下载请求失败',
            unsupported: false,
        };
    }
}

export async function fetchCoverage(
    symbol: string,
    type: 'metrics' | 'fundingRate',
    startDate: string,
    endDate: string
): Promise<CoverageResult> {
    try {
        const params = new URLSearchParams({
            symbol,
            type,
            startDate,
            endDate,
        });
        const response = await fetch(`/api/data/download?${params.toString()}`);
        const payload = await response.json().catch(() => null);

        if (!response.ok || !payload) {
            return {
                coveragePercent: 0,
                totalDays: 0,
                availableDays: 0,
                missingDates: [],
            };
        }

        return {
            coveragePercent: typeof payload.coveragePercent === 'number' ? payload.coveragePercent : 0,
            totalDays: typeof payload.totalDays === 'number' ? payload.totalDays : 0,
            availableDays: typeof payload.availableDays === 'number' ? payload.availableDays : 0,
            missingDates: Array.isArray(payload.missingDates) ? payload.missingDates : [],
        };
    } catch {
        return {
            coveragePercent: 0,
            totalDays: 0,
            availableDays: 0,
            missingDates: [],
        };
    }
}

export function buildRiskCalculationParams(
    ticker: TickerData,
    direction: 'long' | 'short',
    confidence: number,
    accountBalance: number
) {
    return {
        entryPrice: parseFloat(ticker.lastPrice),
        direction,
        confidence,
        atr: ticker.atr,
        keltnerMid: ticker.keltnerMid,
        keltnerUpper: ticker.keltnerUpper,
        keltnerLower: ticker.keltnerLower,
        vah: ticker.vah,
        val: ticker.val,
        poc: ticker.poc,
        bollingerLower: ticker.bollingerLower,
        bollingerMid: ticker.bollingerMid,
        bollingerUpper: ticker.bollingerUpper,
        momentumColor: ticker.momentumColor,
        cvdSlope: ticker.cvdSlope,
        fundingRateTrend: ticker.fundingRateTrend,
        rsrsZScore: ticker.rsrsZScore,
        squeezeDuration: ticker.squeezeDuration,
        bandwidthPercentile: ticker.bandwidthPercentile,
        adx: ticker.adx,
        oiChangePercent: ticker.oiChangePercent,
        volumeChangePercent: ticker.volumeChangePercent,
        betaToBTC: ticker.betaToBTC,
        rsrsR2: ticker.rsrsR2,
        accountBalance,
        riskPercentage: 1,
    };
}

export function parseCustomSymbols(input: string): string[] {
    return Array.from(
        new Set(
            input
                .split(/[\s,]+/)
                .map((item) => item.trim().toUpperCase())
                .filter(Boolean)
        )
    );
}

export function resolveStrategyBacktestIntervalsWithOverrides(
    strategyId: string,
    signalInterval: string,
    executionSelection: ExecutionIntervalOption,
    parameterOverrides?: DeepPartial<StrategyParameterConfigMap>,
) {
    return resolveStrategyIntervalsWithOverrides({
        strategyId,
        signalInterval,
        executionInterval: resolveExecutionInterval(executionSelection, signalInterval),
        parameterOverrides,
    });
}

export function intervalToMs(interval: string): number {
    const match = interval.match(/^(\d+)(m|h|d|w|M)$/);
    if (!match) {
        return 0;
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
            return 0;
    }
}

export function toUtcDateString(timestamp: number): string {
    const date = new Date(timestamp);
    const year = date.getUTCFullYear();
    const month = String(date.getUTCMonth() + 1).padStart(2, '0');
    const day = String(date.getUTCDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

export function getUtcDayStart(timestamp: number): number {
    const date = new Date(timestamp);
    return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

export function getArchiveDateRange(startTime: number, endTime: number): { startDate: string; endDate: string } | null {
    const currentUtcDayStart = getUtcDayStart(Date.now());
    const archiveEndTime = endTime >= currentUtcDayStart
        ? currentUtcDayStart - 1
        : endTime;

    if (archiveEndTime < startTime) {
        return null;
    }

    return {
        startDate: toUtcDateString(startTime),
        endDate: toUtcDateString(archiveEndTime),
    };
}

export function resolveExecutionInterval(selection: ExecutionIntervalOption, signalInterval: string): string {
    if (selection === 'same') {
        return signalInterval;
    }

    return intervalToMs(selection) <= intervalToMs(signalInterval)
        ? selection
        : signalInterval;
}

export function getExecutionOptions(signalInterval: string): ExecutionIntervalOption[] {
    return (['same', '1m', '5m', '15m'] as ExecutionIntervalOption[]).filter((option) =>
        option === 'same' || intervalToMs(option) <= intervalToMs(signalInterval)
    );
}

export async function fetchSymbolsByVolume(): Promise<string[]> {
    const response = await fetch('/api/market');
    if (!response.ok) {
        throw new Error(`获取市场数据失败: HTTP ${response.status}`);
    }

    const payload = await response.json();
    if (!Array.isArray(payload)) {
        throw new Error('市场数据格式异常');
    }

    return selectBacktestSymbolsByVolume(
        payload.filter((ticker): ticker is TickerData =>
            ticker &&
            typeof ticker.symbol === 'string' &&
            typeof ticker.quoteVolume === 'string'
        )
    );
}

export async function runWithConcurrency<T, R>(
    items: T[],
    concurrency: number,
    worker: (item: T, index: number) => Promise<R>
): Promise<R[]> {
    if (items.length === 0) {
        return [];
    }

    const results: R[] = new Array(items.length);
    let nextIndex = 0;
    const runWorker = async () => {
        while (nextIndex < items.length) {
            const currentIndex = nextIndex;
            nextIndex += 1;
            results[currentIndex] = await worker(items[currentIndex], currentIndex);
        }
    };
    await Promise.all(Array.from(
        { length: Math.min(concurrency, items.length) },
        () => runWorker(),
    ));
    return results;
}
