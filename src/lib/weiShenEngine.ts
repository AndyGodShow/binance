import { calculateADX, calculateATR, calculateEMA } from './indicators.ts';
import { getStrategyParameterConfig, type WeiShenLedgerParameters } from './strategyParameters.ts';
import type { RiskManagement } from './risk/types.ts';
import type { OHLC } from './types.ts';
import type { StrategyPortfolioState } from './strategyTypes.ts';
import {
    WEI_SHEN_CORE_CLUSTER,
    WEI_SHEN_SPEC_CLUSTER,
    isWeiShenUniverseSymbol,
} from './weiShenUniverse.ts';
import type {
    WeiShenDirectionalCandidate,
    WeiShenEntryType,
    WeiShenExecutionMode,
    WeiShenMarketRegimeContext,
    WeiShenSignalGrade,
    WeiShenSymbolContext,
} from './weiShenTypes.ts';

type Direction = 'long' | 'short';

export interface WeiShenContextBuildInput {
    symbol: string;
    signal1h: OHLC[];
    confirm4h: OHLC[];
    daily1d: OHLC[];
    btc1h: OHLC[];
    btc4h: OHLC[];
    btc1d: OHLC[];
    fallbackQuoteVolume24hUsd?: number;
    params?: WeiShenLedgerParameters;
}

export interface WeiShenSelectedCandidate {
    direction: Direction;
    entryType: WeiShenEntryType;
    grade: WeiShenSignalGrade;
    executionMode: WeiShenExecutionMode;
    confidence: number;
    passed: string[];
    failed: string[];
    blockedReasons: string[];
    suggestedRiskPct: number;
    stopLossPrice: number;
    invalidationPrice: number;
}

function getLastValue(values: number[]): number | null {
    if (values.length === 0) {
        return null;
    }

    const lastValue = values[values.length - 1];
    return Number.isFinite(lastValue) ? lastValue : null;
}

function getBar(klines: OHLC[], offsetFromEnd = 0): OHLC | null {
    const index = klines.length - 1 - offsetFromEnd;
    if (index < 0 || index >= klines.length) {
        return null;
    }

    return klines[index] ?? null;
}

function average(values: number[]): number {
    if (values.length === 0) {
        return 0;
    }

    return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function clamp(value: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, value));
}

function round(value: number, digits = 4): number {
    if (!Number.isFinite(value)) {
        return 0;
    }

    const factor = Math.pow(10, digits);
    return Math.round(value * factor) / factor;
}

function gradeWeight(grade: WeiShenSignalGrade): number {
    switch (grade) {
        case 'A':
            return 3;
        case 'B':
            return 2;
        default:
            return 1;
    }
}

function lastClose(klines: OHLC[]): number {
    return getBar(klines)?.close ?? 0;
}

function closes(klines: OHLC[]): number[] {
    return klines.map((kline) => kline.close).filter(Number.isFinite);
}

function quoteVolumes(klines: OHLC[]): number[] {
    return klines
        .map((kline) => kline.quoteVolume ?? (kline.close * kline.volume))
        .filter(Number.isFinite);
}

function latestEma(klines: OHLC[], period: number): number | null {
    const series = calculateEMA(closes(klines), period);
    return getLastValue(series);
}

function emaLookbackSlopePct(klines: OHLC[], period: number, lookback: number): number {
    const series = calculateEMA(closes(klines), period);
    if (series.length <= lookback) {
        return 0;
    }

    const current = series[series.length - 1];
    const previous = series[series.length - 1 - lookback];
    if (!Number.isFinite(current) || !Number.isFinite(previous) || previous === 0) {
        return 0;
    }

    return ((current - previous) / previous) * 100;
}

function percentageChangeByBars(klines: OHLC[], lookback: number): number {
    if (klines.length <= lookback) {
        return 0;
    }

    const current = lastClose(klines);
    const previous = klines[klines.length - 1 - lookback]?.close ?? 0;
    if (!Number.isFinite(current) || !Number.isFinite(previous) || previous === 0) {
        return 0;
    }

    return ((current - previous) / previous) * 100;
}

function donchianHigh(klines: OHLC[], lookback: number): number {
    const window = klines.slice(Math.max(0, klines.length - 1 - lookback), Math.max(0, klines.length - 1));
    if (window.length === 0) {
        return 0;
    }

    return Math.max(...window.map((kline) => kline.high));
}

function donchianLow(klines: OHLC[], lookback: number): number {
    const window = klines.slice(Math.max(0, klines.length - 1 - lookback), Math.max(0, klines.length - 1));
    if (window.length === 0) {
        return 0;
    }

    return Math.min(...window.map((kline) => kline.low));
}

function averagePriorVolumeRatio(klines: OHLC[], lookback: number): number {
    const volumeSeries = quoteVolumes(klines);
    if (volumeSeries.length < 2) {
        return 0;
    }

    const current = volumeSeries[volumeSeries.length - 1];
    const history = volumeSeries.slice(Math.max(0, volumeSeries.length - 1 - lookback), volumeSeries.length - 1);
    const volumeAverage = average(history);
    if (!Number.isFinite(current) || !Number.isFinite(volumeAverage) || volumeAverage <= 0) {
        return 0;
    }

    return current / volumeAverage;
}

function sumVolume(klines: OHLC[], barCount: number): number {
    return quoteVolumes(klines)
        .slice(Math.max(0, klines.length - barCount))
        .reduce((sum, value) => sum + value, 0);
}

function latestAtr(klines: OHLC[], period: number): number {
    const atrSeries = calculateATR(klines, period);
    return getLastValue(atrSeries) ?? 0;
}

function atrExpansionRatio(klines: OHLC[], period: number): number {
    const atrSeries = calculateATR(klines, period);
    if (atrSeries.length < 4) {
        return 0;
    }

    const current = atrSeries[atrSeries.length - 1];
    const baseline = average(atrSeries.slice(Math.max(0, atrSeries.length - 6), atrSeries.length - 1));
    if (!Number.isFinite(current) || !Number.isFinite(baseline) || baseline <= 0) {
        return 0;
    }

    return current / baseline;
}

function getAdx(klines: OHLC[]): { adx: number; plusDI: number; minusDI: number } {
    const computed = calculateADX(klines, 14);
    return {
        adx: getLastValue(computed.adx) ?? 0,
        plusDI: getLastValue(computed.plusDI) ?? 0,
        minusDI: getLastValue(computed.minusDI) ?? 0,
    };
}

function directionalTrendReady(
    klines: OHLC[],
    direction: Direction,
    fastPeriod: number,
    midPeriod: number,
): { ready: boolean; emaFast: number; emaMid: number; currentPrice: number } {
    const emaFast = latestEma(klines, fastPeriod) ?? 0;
    const emaMid = latestEma(klines, midPeriod) ?? 0;
    const currentPrice = lastClose(klines);

    const ready = direction === 'long'
        ? currentPrice > emaFast && emaFast > emaMid
        : currentPrice < emaFast && emaFast < emaMid;

    return { ready, emaFast, emaMid, currentPrice };
}

function buildEmptyCandidate(reason: string): WeiShenDirectionalCandidate {
    return {
        eligible: false,
        grade: 'C',
        confidenceScore: 70,
        passed: [],
        failed: [reason],
        blockedReasons: [],
        stopLossPrice: 0,
        invalidationPrice: 0,
        suggestedRiskPct: 0,
    };
}

function buildMarketRegime(
    btc4h: OHLC[],
    btc1d: OHLC[],
    params: WeiShenLedgerParameters,
): WeiShenMarketRegimeContext {
    const fast = latestEma(btc4h, params.marketRegime.emaPeriods.fast) ?? 0;
    const mid = latestEma(btc4h, params.marketRegime.emaPeriods.mid) ?? 0;
    const slow = latestEma(btc4h, params.marketRegime.emaPeriods.slow) ?? 0;
    const close4h = lastClose(btc4h);
    const dailySlopePct = emaLookbackSlopePct(
        btc1d,
        params.marketRegime.dailyEmaPeriod,
        params.marketRegime.dailySlopeLookback,
    );
    const adx4h = getAdx(btc4h).adx;
    const compressionPct = mid > 0 ? (Math.abs(fast - mid) / mid) * 100 : 100;
    const nearFast = fast > 0 ? (Math.abs(close4h - fast) / fast) * 100 : 100;
    const dayWindow = btc4h.slice(Math.max(0, btc4h.length - 6));
    const dayHigh = dayWindow.length > 0 ? Math.max(...dayWindow.map((bar) => bar.high)) : close4h;
    const dayLow = dayWindow.length > 0 ? Math.min(...dayWindow.map((bar) => bar.low)) : close4h;
    const shockPct = dayLow > 0 ? ((dayHigh - dayLow) / dayLow) * 100 : 0;
    const closeLocation = dayHigh > dayLow ? (close4h - dayLow) / (dayHigh - dayLow) : 0.5;

    const bullStack = close4h > fast && fast > mid && mid > slow;
    const bearStack = close4h < fast && fast < mid && mid < slow;
    const riskOffLong = shockPct >= params.marketRegime.shock24hPct && closeLocation <= params.marketRegime.weakCloseLocationMax;
    const riskOffShort = shockPct >= params.marketRegime.shock24hPct && closeLocation >= (1 - params.marketRegime.weakCloseLocationMax);
    const range = adx4h < params.marketRegime.rangeAdxMax
        && compressionPct <= params.marketRegime.rangeCompressionPct
        && nearFast <= params.marketRegime.rangeCompressionPct;

    const passed = [
        `BTC 4h EMA结构 ${round(fast, 2)} / ${round(mid, 2)} / ${round(slow, 2)}`,
        `BTC 1d EMA${params.marketRegime.dailyEmaPeriod} 斜率 ${round(dailySlopePct, 3)}%`,
    ];
    const failed: string[] = [];

    if (riskOffLong || riskOffShort) {
        failed.push(`BTC 24h 振幅 ${round(shockPct, 2)}%，收盘位置 ${round(closeLocation * 100, 1)}%，触发全局降风险`);
        return {
            state: 'risk-off',
            allowLong: false,
            allowShort: false,
            onlyAGrade: false,
            summary: 'BTC 出现高振幅弱收盘或关键均线失守，关闭新仓风险',
            passed,
            failed,
        };
    }

    if (range) {
        if (!bullStack && !bearStack) {
            failed.push('BTC 4h 均线压缩但方向不清，只保留观察');
        }

        return {
            state: 'range',
            allowLong: bullStack || dailySlopePct > 0,
            allowShort: bearStack || dailySlopePct < 0,
            onlyAGrade: true,
            summary: 'BTC 进入 4h 压缩震荡，仅放行最强 A 级顺势信号',
            passed,
            failed,
        };
    }

    if (bullStack && dailySlopePct > params.marketRegime.dailySlopeMinPct) {
        return {
            state: 'bull-trend',
            allowLong: true,
            allowShort: false,
            onlyAGrade: false,
            summary: 'BTC 4h 多头趋势与日线斜率共振，允许顺势做多',
            passed,
            failed,
        };
    }

    if (bearStack && dailySlopePct < -params.marketRegime.dailySlopeMinPct) {
        return {
            state: 'bear-trend',
            allowLong: false,
            allowShort: true,
            onlyAGrade: false,
            summary: 'BTC 4h 空头趋势与日线斜率共振，允许顺势做空',
            passed,
            failed,
        };
    }

    failed.push('BTC 趋势未完成排序或日线斜率不足，关闭新仓');
    return {
        state: 'risk-off',
        allowLong: false,
        allowShort: false,
        onlyAGrade: false,
        summary: 'BTC 趋势不清或斜率不足，暂不开放风险',
        passed,
        failed,
    };
}

function buildRelativeStrength(
    symbol: string,
    signal1h: OHLC[],
    confirm4h: OHLC[],
    btc1h: OHLC[],
    btc4h: OHLC[],
    fallbackQuoteVolume24hUsd: number,
    params: WeiShenLedgerParameters,
) {
    const volume24hUsd = sumVolume(signal1h, 24) || fallbackQuoteVolume24hUsd;

    if (symbol === 'BTCUSDT') {
        return {
            passed: true,
            reasons: ['BTC 免相对强弱过滤'],
            slope1h: 0,
            excessReturn4h: 0,
            volume24hUsd,
            minVolume24hUsd: 0,
            minExcessReturn4h: 0,
            summary: 'BTC 作为市场锚定资产，不做相对强弱过滤',
            passedReasons: ['BTC 免相对强弱过滤'],
            failedReasons: [] as string[],
            directional: {
                long: {
                    passed: true,
                    reasons: ['BTC 免相对强弱过滤'],
                    failedReasons: [],
                },
                short: {
                    passed: true,
                    reasons: ['BTC 免相对强弱过滤'],
                    failedReasons: [],
                },
            },
        };
    }

    const assetNow = lastClose(signal1h);
    const assetPast = signal1h.length > params.relativeStrength.rsWindow1h
        ? signal1h[signal1h.length - 1 - params.relativeStrength.rsWindow1h]?.close ?? 0
        : 0;
    const btcNow = lastClose(btc1h);
    const btcPast = btc1h.length > params.relativeStrength.rsWindow1h
        ? btc1h[btc1h.length - 1 - params.relativeStrength.rsWindow1h]?.close ?? 0
        : 0;

    const ratioNow = btcNow > 0 ? assetNow / btcNow : 0;
    const ratioPast = btcPast > 0 ? assetPast / btcPast : 0;
    const slope1h = ratioPast > 0 ? ((ratioNow - ratioPast) / ratioPast) * 100 : 0;
    const assetChange4h = percentageChangeByBars(confirm4h, params.relativeStrength.rsWindow4h);
    const btcChange4h = percentageChangeByBars(btc4h, params.relativeStrength.rsWindow4h);
    const excessReturn4h = assetChange4h - btcChange4h;
    const minVolume24hUsd = params.relativeStrength.minVolume24hUsd[symbol] ?? 0;
    const minExcessReturn4h = params.relativeStrength.excessReturn4hMin[symbol] ?? 0;

    const sharedReasons: string[] = [];
    const sharedFailedReasons: string[] = [];

    if (volume24hUsd >= minVolume24hUsd) {
        sharedReasons.push(`24h 成交额 ${(volume24hUsd / 1_000_000_000).toFixed(2)}B 美元`);
    } else {
        sharedFailedReasons.push(`24h 成交额不足 ${(volume24hUsd / 1_000_000_000).toFixed(2)}B < ${(minVolume24hUsd / 1_000_000_000).toFixed(2)}B`);
    }

    const longReasons = [...sharedReasons];
    const longFailedReasons = [...sharedFailedReasons];
    if (slope1h >= 0) {
        longReasons.push(`相对 BTC 的 1h 比值斜率 ${round(slope1h, 3)}%`);
    } else {
        longFailedReasons.push(`相对 BTC 的 1h 比值走弱 ${round(slope1h, 3)}%`);
    }

    if (excessReturn4h >= minExcessReturn4h) {
        longReasons.push(`4h 超额收益 ${round(excessReturn4h, 3)}%`);
    } else {
        longFailedReasons.push(`4h 超额收益不足 ${round(excessReturn4h, 3)}% < ${minExcessReturn4h}%`);
    }

    const shortReasons = [...sharedReasons];
    const shortFailedReasons = [...sharedFailedReasons];
    if (slope1h <= 0) {
        shortReasons.push(`相对 BTC 的 1h 比值偏弱 ${round(slope1h, 3)}%`);
    } else {
        shortFailedReasons.push(`相对 BTC 的 1h 比值未转弱 ${round(slope1h, 3)}%`);
    }

    if (excessReturn4h <= -minExcessReturn4h) {
        shortReasons.push(`4h 相对 BTC 弱于基准 ${round(excessReturn4h, 3)}%`);
    } else {
        shortFailedReasons.push(`4h 相对 BTC 偏弱不足 ${round(excessReturn4h, 3)}% > -${minExcessReturn4h}%`);
    }

    const longPassed = longFailedReasons.length === 0;
    const shortPassed = shortFailedReasons.length === 0;
    const reasons = longPassed ? longReasons : shortPassed ? shortReasons : sharedReasons;
    const failedReasons = longPassed || shortPassed
        ? sharedFailedReasons
        : longFailedReasons;

    return {
        passed: longPassed || shortPassed,
        reasons,
        slope1h: round(slope1h, 4),
        excessReturn4h: round(excessReturn4h, 4),
        volume24hUsd: round(volume24hUsd, 2),
        minVolume24hUsd,
        minExcessReturn4h,
        summary: longPassed || shortPassed
            ? '相对 BTC 方向强弱与流动性过滤通过'
            : '相对 BTC 强弱或流动性过滤未通过',
        passedReasons: reasons,
        failedReasons,
        directional: {
            long: {
                passed: longPassed,
                reasons: longReasons,
                failedReasons: longFailedReasons,
            },
            short: {
                passed: shortPassed,
                reasons: shortReasons,
                failedReasons: shortFailedReasons,
            },
        },
    };
}

function getDirectionalRelativeStrengthGate(
    relativeStrength: ReturnType<typeof buildRelativeStrength>,
    direction: Direction,
) {
    return relativeStrength.directional[direction];
}

function buildBreakoutCandidate(
    symbol: string,
    direction: Direction,
    signal1h: OHLC[],
    confirm4h: OHLC[],
    relativeStrength: ReturnType<typeof buildRelativeStrength>,
    params: WeiShenLedgerParameters,
): WeiShenDirectionalCandidate {
    if (signal1h.length < 40 || confirm4h.length < 40) {
        return buildEmptyCandidate('突破结构所需历史K线不足');
    }

    const passed: string[] = [];
    const failed: string[] = [];
    const breakoutLookback = params.entry.donchianLookback[symbol] ?? 20;
    const volumeRatioMin = params.entry.breakoutVolumeRatioMin[symbol] ?? 1.2;
    const overheatMax = params.entry.overheatThresholdPct[symbol] ?? 2.5;
    const fastPeriod = params.marketRegime.emaPeriods.fast;
    const midPeriod = params.marketRegime.emaPeriods.mid;
    const signalTrend = directionalTrendReady(signal1h, direction, fastPeriod, midPeriod);
    const confirmTrend = directionalTrendReady(confirm4h, direction, fastPeriod, midPeriod);
    const currentPrice = signalTrend.currentPrice;
    const breakoutLevel = direction === 'long'
        ? donchianHigh(signal1h, breakoutLookback)
        : donchianLow(signal1h, breakoutLookback);
    const breakoutOk = direction === 'long'
        ? currentPrice > breakoutLevel
        : currentPrice < breakoutLevel;
    const volumeRatio = averagePriorVolumeRatio(signal1h, params.relativeStrength.relativeVolumeMa);
    const volumeOk = volumeRatio >= volumeRatioMin;
    const ema20 = signalTrend.emaFast;
    const overheatPct = ema20 > 0 ? (Math.abs(currentPrice - ema20) / ema20) * 100 : 0;
    const overheatOk = overheatPct <= overheatMax;
    const atrRatio = atrExpansionRatio(signal1h, params.entry.atrPeriod);
    const atrOk = atrRatio >= params.entry.atrExpansionMin
        && atrRatio <= (params.entry.atrExpansionMin * params.entry.atrExpansionMaxMultiplier);
    const rsGate = getDirectionalRelativeStrengthGate(relativeStrength, direction);

    if (signalTrend.ready && confirmTrend.ready) {
        passed.push('1h 与 4h 趋势同向');
    } else {
        failed.push('1h 与 4h 趋势未同向排列');
    }

    if (breakoutOk) {
        passed.push(`价格突破 ${breakoutLookback} 根区间${direction === 'long' ? '高点' : '低点'}`);
    } else {
        failed.push(`价格尚未突破 ${breakoutLookback} 根区间${direction === 'long' ? '高点' : '低点'}`);
    }

    if (volumeOk) {
        passed.push(`突破量比 ${round(volumeRatio, 3)}x`);
    } else {
        failed.push(`突破量比不足 ${round(volumeRatio, 3)}x < ${volumeRatioMin}x`);
    }

    if (overheatOk) {
        passed.push(`距 1h EMA20 偏离 ${round(overheatPct, 3)}%`);
    } else {
        failed.push(`距 1h EMA20 偏离过大 ${round(overheatPct, 3)}% > ${overheatMax}%`);
    }

    if (atrOk) {
        passed.push(`ATR 扩张比 ${round(atrRatio, 3)}x`);
    } else {
        failed.push(`ATR 扩张不匹配 ${round(atrRatio, 3)}x`);
    }

    if (rsGate.passed) {
        passed.push(symbol === 'BTCUSDT' ? 'BTC 不需要相对强弱过滤' : `相对强弱通过：${rsGate.reasons.join('，')}`);
    } else {
        failed.push(symbol === 'BTCUSDT' ? 'BTC 不需要相对强弱过滤' : `相对强弱未通过：${rsGate.failedReasons.join('，')}`);
    }

    const eligible = failed.length === 0;
    const strongVolume = volumeRatio >= (volumeRatioMin * params.entry.breakoutStrongVolumeRatioMultiplier);
    const strongRs = symbol === 'BTCUSDT'
        || Math.abs(relativeStrength.excessReturn4h) >= (
            relativeStrength.minExcessReturn4h
            + (params.entry.breakoutStrongExcessReturnBonusPct[symbol] ?? 0)
        );
    const grade: WeiShenSignalGrade = eligible
        ? (strongVolume && strongRs ? 'A' : 'B')
        : 'C';
    const atrValue = latestAtr(signal1h, params.entry.atrPeriod);
    const swingWindow = signal1h.slice(
        Math.max(0, signal1h.length - params.entry.breakoutSwingLookback),
        signal1h.length - 1,
    );
    const swingLow = swingWindow.length > 0 ? Math.min(...swingWindow.map((bar) => bar.low)) : currentPrice;
    const swingHigh = swingWindow.length > 0 ? Math.max(...swingWindow.map((bar) => bar.high)) : currentPrice;
    const stopLossPrice = direction === 'long'
        ? Math.min(swingLow, currentPrice - (atrValue * params.entry.breakoutStopAtrMultiplier))
        : Math.max(swingHigh, currentPrice + (atrValue * params.entry.breakoutStopAtrMultiplier));
    const invalidationPrice = direction === 'long'
        ? Math.min(breakoutLevel, ema20)
        : Math.max(breakoutLevel, ema20);
    const suggestedRiskPct = params.risk.baseRiskPct[grade] * (params.risk.symbolRiskMultiplier[symbol] ?? 0);

    return {
        eligible,
        grade,
        confidenceScore: grade === 'A' ? 92 : grade === 'B' ? 84 : 70,
        passed,
        failed,
        blockedReasons: [],
        stopLossPrice: round(stopLossPrice, 6),
        invalidationPrice: round(invalidationPrice, 6),
        suggestedRiskPct: round(suggestedRiskPct, 4),
    };
}

function buildPullbackCandidate(
    symbol: string,
    direction: Direction,
    signal1h: OHLC[],
    confirm4h: OHLC[],
    relativeStrength: ReturnType<typeof buildRelativeStrength>,
    params: WeiShenLedgerParameters,
): WeiShenDirectionalCandidate {
    if (!params.entry.allowPullbackSymbols.includes(symbol)) {
        return {
            ...buildEmptyCandidate('该币种默认禁用回踩买点'),
            failed: ['该币种默认禁用回踩买点'],
            blockedReasons: ['回踩逻辑仅对 BTC / ETH / SOL / 部分 XRP 开放'],
        };
    }

    if (signal1h.length < 40 || confirm4h.length < 40) {
        return buildEmptyCandidate('回踩结构所需历史K线不足');
    }

    const passed: string[] = [];
    const failed: string[] = [];
    const blockedReasons: string[] = [];
    const [pullbackFastPeriod, pullbackSlowPeriod] = params.entry.pullbackEmaPeriods;
    const emaFast = latestEma(signal1h, pullbackFastPeriod) ?? 0;
    const emaSlow = latestEma(signal1h, pullbackSlowPeriod) ?? 0;
    const emaMid = latestEma(signal1h, params.marketRegime.emaPeriods.mid) ?? 0;
    const currentBar = getBar(signal1h);
    const previousBar = getBar(signal1h, 1);
    const currentPrice = currentBar?.close ?? 0;
    const trendLegReturn = percentageChangeByBars(signal1h, params.entry.trendLegLookback);
    const confirmTrend = directionalTrendReady(confirm4h, direction, params.marketRegime.emaPeriods.fast, params.marketRegime.emaPeriods.mid);
    const minTrendLegReturnPct = params.entry.trendLegMinReturnPct[symbol] ?? 1.2;
    const trendReady = direction === 'long'
        ? trendLegReturn > minTrendLegReturnPct && confirmTrend.ready
        : trendLegReturn < -minTrendLegReturnPct && confirmTrend.ready;
    const recentPullbackWindow = signal1h.slice(Math.max(0, signal1h.length - params.entry.pullbackRecentBars));
    const recentLow = recentPullbackWindow.length > 0 ? Math.min(...recentPullbackWindow.map((bar) => bar.low)) : currentPrice;
    const recentHigh = recentPullbackWindow.length > 0 ? Math.max(...recentPullbackWindow.map((bar) => bar.high)) : currentPrice;
    const zoneHigh = Math.max(emaFast, emaSlow);
    const zoneLow = Math.min(emaFast, emaSlow);
    const zoneBufferFactor = params.entry.pullbackZoneBufferPct / 100;
    const structureBufferFactor = params.entry.pullbackStructureBufferPct / 100;
    const touchedZone = direction === 'long'
        ? recentLow <= (zoneHigh * (1 + zoneBufferFactor)) && currentPrice >= zoneLow
        : recentHigh >= (zoneLow * (1 - zoneBufferFactor)) && currentPrice <= zoneHigh;
    const structureHeld = direction === 'long'
        ? recentLow >= (emaMid * (1 - structureBufferFactor))
        : recentHigh <= (emaMid * (1 + structureBufferFactor));
    const pullbackVolumes = quoteVolumes(signal1h);
    const currentPullbackVolume = average(pullbackVolumes.slice(Math.max(0, pullbackVolumes.length - 3)));
    const priorTrendVolume = average(pullbackVolumes.slice(Math.max(0, pullbackVolumes.length - 9), Math.max(0, pullbackVolumes.length - 3)));
    const pullbackCompression = priorTrendVolume > 0 ? currentPullbackVolume / priorTrendVolume : 0;
    const volumeCompressed = pullbackCompression > 0 && pullbackCompression <= params.entry.pullbackVolumeCompressionMax;
    const reclaimWindow = signal1h.slice(
        Math.max(0, signal1h.length - 1 - params.entry.reclaimConfirmBars),
        signal1h.length - 1,
    );
    const reclaimReference = direction === 'long'
        ? (reclaimWindow.length > 0 ? Math.max(...reclaimWindow.map((bar) => bar.high)) : (previousBar?.high ?? currentPrice))
        : (reclaimWindow.length > 0 ? Math.min(...reclaimWindow.map((bar) => bar.low)) : (previousBar?.low ?? currentPrice));
    const reclaimVolumeHistory = pullbackVolumes.slice(
        Math.max(0, pullbackVolumes.length - 1 - params.entry.reclaimConfirmBars),
        pullbackVolumes.length - 1,
    );
    const reclaimVolumeRatio = average(reclaimVolumeHistory) > 0
        ? (pullbackVolumes[pullbackVolumes.length - 1] ?? 0) / average(reclaimVolumeHistory)
        : 0;
    const reclaimConfirmed = direction === 'long'
        ? currentPrice > reclaimReference
        : currentPrice < reclaimReference;
    const reclaimVolumeOk = reclaimVolumeRatio >= params.entry.reclaimVolumeRatioMin;
    const rsGate = getDirectionalRelativeStrengthGate(relativeStrength, direction);

    if (trendReady) {
        passed.push('回踩前存在明确趋势腿');
    } else {
        failed.push('回踩前趋势腿不清或仍处于逆势第一次反弹');
    }

    if (touchedZone) {
        passed.push(`价格回踩 EMA${pullbackFastPeriod}/EMA${pullbackSlowPeriod} 区域`);
    } else {
        failed.push(`价格未回踩 EMA${pullbackFastPeriod}/EMA${pullbackSlowPeriod} 区域`);
    }

    if (structureHeld) {
        passed.push('结构低点未破坏');
    } else {
        failed.push('回踩过程中结构已经失效');
    }

    if (volumeCompressed) {
        passed.push(`回踩量能压缩到 ${round(pullbackCompression, 3)}x`);
    } else {
        failed.push(`回踩量能未明显收缩 ${round(pullbackCompression, 3)}x`);
    }

    if (reclaimConfirmed && reclaimVolumeOk) {
        passed.push(`重新放量反包确认 ${round(reclaimVolumeRatio, 3)}x`);
    } else {
        failed.push(`尚未完成 ${params.entry.reclaimConfirmBars} 根反包重夺或放量确认 ${round(reclaimVolumeRatio, 3)}x`);
    }

    if (rsGate.passed) {
        passed.push(symbol === 'BTCUSDT' ? 'BTC 不需要相对强弱过滤' : `相对强弱通过：${rsGate.reasons.join('，')}`);
    } else {
        failed.push(symbol === 'BTCUSDT' ? 'BTC 不需要相对强弱过滤' : `相对强弱未通过：${rsGate.failedReasons.join('，')}`);
    }

    if (symbol === 'DOGEUSDT') {
        failed.push('DOGE 默认禁用宽松回踩');
        blockedReasons.push('DOGE 只接受最强动量突破，不参与回踩抄返场');
    }

    const eligible = failed.length === 0;
    let grade: WeiShenSignalGrade = eligible ? 'B' : 'C';

    if (eligible) {
        const strongRs = symbol === 'BTCUSDT'
            || Math.abs(relativeStrength.excessReturn4h) >= (
                relativeStrength.minExcessReturn4h
                + (params.entry.pullbackStrongExcessReturnBonusPct[symbol] ?? 0)
            );
        grade = strongRs ? 'A' : 'B';
    }

    if (symbol === 'XRPUSDT' && grade !== 'A') {
        grade = 'C';
        blockedReasons.push('XRP 回踩只保留最完整的 A 级结构');
    }

    const atrValue = latestAtr(signal1h, params.entry.atrPeriod);
    const stopAtrMultiplier = params.entry.pullbackStopAtrMultiplier[symbol] ?? 0.8;
    const stopLossPrice = direction === 'long'
        ? Math.min(recentLow, zoneLow - (atrValue * stopAtrMultiplier))
        : Math.max(recentHigh, zoneHigh + (atrValue * stopAtrMultiplier));
    const invalidationPrice = direction === 'long'
        ? Math.min(recentLow, zoneLow)
        : Math.max(recentHigh, zoneHigh);
    const suggestedRiskPct = params.risk.baseRiskPct[grade] * (params.risk.symbolRiskMultiplier[symbol] ?? 0);

    return {
        eligible,
        grade,
        confidenceScore: grade === 'A' ? 90 : grade === 'B' ? 84 : 70,
        passed,
        failed,
        blockedReasons,
        stopLossPrice: round(stopLossPrice, 6),
        invalidationPrice: round(invalidationPrice, 6),
        suggestedRiskPct: round(suggestedRiskPct, 4),
    };
}

export function buildWeiShenSymbolContext(input: WeiShenContextBuildInput): WeiShenSymbolContext | null {
    const params = input.params ?? getStrategyParameterConfig('wei-shen-ledger');
    if (!isWeiShenUniverseSymbol(input.symbol)) {
        return null;
    }

    if (
        input.signal1h.length < 30 ||
        input.confirm4h.length < 30 ||
        input.daily1d.length < 24 ||
        input.btc1h.length < 30 ||
        input.btc4h.length < 30 ||
        input.btc1d.length < 24
    ) {
        const insufficientCandidate = buildEmptyCandidate('魏神策略上下文历史数据不足');
        return {
            universeAllowed: true,
            symbol: input.symbol,
            regime: {
                state: 'risk-off',
                allowLong: false,
                allowShort: false,
                onlyAGrade: false,
                summary: '多周期上下文不足，魏神策略暂停出手',
                passed: [],
                failed: ['1h / 4h / 1d 历史数据不足，无法建立 BTC 主导上下文'],
            },
            relativeStrength: {
                passed: false,
                reasons: [],
                slope1h: 0,
                excessReturn4h: 0,
                volume24hUsd: input.fallbackQuoteVolume24hUsd ?? 0,
                minVolume24hUsd: 0,
                minExcessReturn4h: 0,
                summary: '历史数据不足',
                passedReasons: [],
                failedReasons: ['无法完成相对强弱计算'],
                directional: {
                    long: {
                        passed: false,
                        reasons: [],
                        failedReasons: ['无法完成相对强弱计算'],
                    },
                    short: {
                        passed: false,
                        reasons: [],
                        failedReasons: ['无法完成相对强弱计算'],
                    },
                },
            },
            entries: {
                breakout: {
                    long: insufficientCandidate,
                    short: insufficientCandidate,
                },
                pullback: {
                    long: insufficientCandidate,
                    short: insufficientCandidate,
                },
            },
        };
    }

    const regime = buildMarketRegime(input.btc4h, input.btc1d, params);
    const relativeStrength = buildRelativeStrength(
        input.symbol,
        input.signal1h,
        input.confirm4h,
        input.btc1h,
        input.btc4h,
        input.fallbackQuoteVolume24hUsd ?? 0,
        params,
    );

    return {
        universeAllowed: true,
        symbol: input.symbol,
        regime,
        relativeStrength,
        entries: {
            breakout: {
                long: buildBreakoutCandidate(input.symbol, 'long', input.signal1h, input.confirm4h, relativeStrength, params),
                short: buildBreakoutCandidate(input.symbol, 'short', input.signal1h, input.confirm4h, relativeStrength, params),
            },
            pullback: {
                long: buildPullbackCandidate(input.symbol, 'long', input.signal1h, input.confirm4h, relativeStrength, params),
                short: buildPullbackCandidate(input.symbol, 'short', input.signal1h, input.confirm4h, relativeStrength, params),
            },
        },
    };
}

function resolveActivePositions(portfolioState?: StrategyPortfolioState) {
    if (portfolioState?.activePositionsBySymbol) {
        return Object.values(portfolioState.activePositionsBySymbol);
    }

    return (portfolioState?.activeSymbols ?? []).map((symbol) => ({ symbol, direction: 'long' as const, riskPct: 0 }));
}

export function applyWeiShenPortfolioGuards(args: {
    symbol: string;
    grade: WeiShenSignalGrade;
    baseRiskPct: number;
    portfolioState?: StrategyPortfolioState;
    params?: WeiShenLedgerParameters;
}) {
    const params = args.params ?? getStrategyParameterConfig('wei-shen-ledger');
    const blockedReasons: string[] = [];

    if (args.grade === 'C' || args.baseRiskPct <= 0) {
        return {
            suggestedRiskPct: 0,
            blockedReasons,
        };
    }

    const activePositions = resolveActivePositions(args.portfolioState);
    if (activePositions.some((position) => position.symbol === args.symbol)) {
        blockedReasons.push('同一币种已有持仓，不重复开仓');
    }

    if (activePositions.length >= params.risk.maxConcurrentPositions) {
        blockedReasons.push(`同时持仓达到上限 ${params.risk.maxConcurrentPositions}`);
    }

    if ((args.portfolioState?.consecutiveLosses ?? 0) >= params.risk.maxConsecutiveLossesBeforeCooldown) {
        blockedReasons.push(`连续亏损达到 ${params.risk.maxConsecutiveLossesBeforeCooldown} 笔，进入 cooldown`);
    }

    if ((args.portfolioState?.dailyDrawdownPct ?? 0) >= params.risk.maxDailyDrawdownPct) {
        blockedReasons.push(`当日回撤达到 ${params.risk.maxDailyDrawdownPct}% 上限`);
    }

    let suggestedRiskPct = args.baseRiskPct;
    const clusterSymbols = WEI_SHEN_CORE_CLUSTER.includes(args.symbol as (typeof WEI_SHEN_CORE_CLUSTER)[number])
        ? WEI_SHEN_CORE_CLUSTER
        : WEI_SHEN_SPEC_CLUSTER;
    const clusterSymbolSet = new Set<string>(clusterSymbols);
    const clusterCap = clusterSymbols === WEI_SHEN_CORE_CLUSTER
        ? params.risk.coreClusterRiskCap
        : params.risk.specClusterRiskCap;
    const activeClusterRisk = activePositions
        .filter((position) => clusterSymbolSet.has(position.symbol))
        .reduce((sum, position) => sum + (position.riskPct ?? 0), 0);
    const remainingClusterRisk = clusterCap - activeClusterRisk;

    if (remainingClusterRisk <= 0) {
        blockedReasons.push(`相关币种总风险已达到簇上限 ${clusterCap}%`);
    } else {
        suggestedRiskPct = Math.min(suggestedRiskPct, remainingClusterRisk);
    }

    const btcIsActive = activePositions.some((position) => position.symbol === 'BTCUSDT');
    if (btcIsActive && (args.symbol === 'ETHUSDT' || args.symbol === 'SOLUSDT')) {
        suggestedRiskPct *= params.risk.btcLeadAltRiskMultiplier;
    }

    if (blockedReasons.length > 0) {
        return {
            suggestedRiskPct: 0,
            blockedReasons,
        };
    }

    return {
        suggestedRiskPct: round(suggestedRiskPct, 4),
        blockedReasons,
    };
}

export function buildWeiShenRiskManagement(args: {
    symbol: string;
    entryPrice: number;
    direction: Direction;
    confidence: number;
    stopLossPrice: number;
    invalidationPrice: number;
    suggestedRiskPct: number;
    entryType: WeiShenEntryType;
    params?: WeiShenLedgerParameters;
    accountBalance?: number;
}): RiskManagement | undefined {
    const params = args.params ?? getStrategyParameterConfig('wei-shen-ledger');
    if (!Number.isFinite(args.entryPrice) || args.entryPrice <= 0 || args.suggestedRiskPct <= 0) {
        return undefined;
    }

    const accountBalance = args.accountBalance ?? 10000;
    const stopLossPct = Math.abs((args.stopLossPrice - args.entryPrice) / args.entryPrice) * 100;
    if (!Number.isFinite(stopLossPct) || stopLossPct <= 0) {
        return undefined;
    }

    const stopDistance = Math.abs(args.entryPrice - args.stopLossPrice);
    const r1Price = args.direction === 'long'
        ? args.entryPrice + (stopDistance * params.risk.moveStopToEntryAtR)
        : args.entryPrice - (stopDistance * params.risk.moveStopToEntryAtR);
    const r2Price = args.direction === 'long'
        ? args.entryPrice + (stopDistance * params.risk.partialTakeProfitAtR)
        : args.entryPrice - (stopDistance * params.risk.partialTakeProfitAtR);
    const positionPct = clamp((args.suggestedRiskPct / stopLossPct) * 100, 2, args.symbol === 'BTCUSDT' ? 30 : 24);
    const maxRiskAmount = round((accountBalance * args.suggestedRiskPct) / 100, 2);
    const leverage = args.symbol === 'BTCUSDT'
        ? 2
        : args.symbol === 'ETHUSDT'
            ? 2
            : args.symbol === 'SOLUSDT'
                ? 2
                : 1;

    return {
        stopLoss: {
            price: round(args.stopLossPrice, 6),
            percentage: round(stopLossPct, 3),
            type: 'dynamic',
            reason: '基于 swing low/high + ATR + 结构失效位的初始止损',
        },
        takeProfit: {
            targets: [
                {
                    price: round(r1Price, 6),
                    percentage: round(Math.abs((r1Price - args.entryPrice) / args.entryPrice) * 100, 3),
                    closePercentage: 0,
                    moveStopToEntry: true,
                    reason: '达到 1R 后将止损抬到保本位',
                },
                {
                    price: round(r2Price, 6),
                    percentage: round(Math.abs((r2Price - args.entryPrice) / args.entryPrice) * 100, 3),
                    closePercentage: params.risk.partialTakeProfitClosePct,
                    moveStopToEntry: true,
                    reason: '达到 2R 后先止盈一半，回收波动成本',
                },
            ],
            riskRewardRatio: round(params.risk.partialTakeProfitAtR, 2),
        },
        positionSizing: {
            percentage: round(positionPct, 2),
            leverage,
            maxRiskAmount,
            confidence: args.confidence,
            reasoning: `按 ${round(args.suggestedRiskPct, 3)}% 风险预算反推仓位，并保留 BTC 主导的相关性折扣`,
        },
        metrics: {
            entryPrice: round(args.entryPrice, 6),
            riskAmount: maxRiskAmount,
            potentialProfit: round(maxRiskAmount * params.risk.partialTakeProfitAtR, 2),
        },
        dynamicExit: {
            enabled: true,
            timeframe: params.timeframes.executionInterval,
            emaPeriod: params.risk.trailingEmaPeriod,
            donchianLookback: params.risk.trailingDonchianLookback,
            activateAfterTargetIndex: 1,
            invalidationPrice: round(args.invalidationPrice, 6),
            reason: `2R 后剩余仓位按 ${params.timeframes.executionInterval} EMA${params.risk.trailingEmaPeriod} / Donchian(${params.risk.trailingDonchianLookback}) 中线追踪`,
        },
        timeStop: {
            maxHoldBars: args.entryType === 'breakout'
                ? params.risk.breakoutTimeStopBars
                : params.risk.pullbackTimeStopBars,
            profitThreshold: 0.2,
        },
    };
}

export function selectWeiShenCandidate(args: {
    symbolContext: WeiShenSymbolContext;
    entryPrice: number;
    portfolioState?: StrategyPortfolioState;
    params?: WeiShenLedgerParameters;
}): WeiShenSelectedCandidate | null {
    const params = args.params ?? getStrategyParameterConfig('wei-shen-ledger');
    const { symbolContext } = args;
    if (symbolContext.universeAllowed === false) {
        return null;
    }
    const symbol = symbolContext.symbol || '';

    const candidates = [
        { direction: 'long' as const, entryType: 'breakout' as const, candidate: symbolContext.entries.breakout.long },
        { direction: 'long' as const, entryType: 'pullback' as const, candidate: symbolContext.entries.pullback.long },
        { direction: 'short' as const, entryType: 'breakout' as const, candidate: symbolContext.entries.breakout.short },
        { direction: 'short' as const, entryType: 'pullback' as const, candidate: symbolContext.entries.pullback.short },
    ];

    const normalized = candidates
        .map((item) => {
            const allowDirection = item.direction === 'long'
                ? symbolContext.regime.allowLong
                : symbolContext.regime.allowShort;
            const blockedReasons = Array.isArray(item.candidate.blockedReasons)
                ? [...item.candidate.blockedReasons]
                : [];
            let grade = item.candidate.grade ?? 'C';
            let eligible = item.candidate.eligible ?? false;

            if (!allowDirection) {
                blockedReasons.push('BTC 市场总开关未放行该方向');
                eligible = false;
                grade = 'C';
            }

            if (symbolContext.regime.onlyAGrade && grade !== 'A') {
                blockedReasons.push('BTC 当前处于震荡态，只接受 A 级信号');
                eligible = false;
                grade = 'C';
            }

            const guard = applyWeiShenPortfolioGuards({
                symbol,
                grade,
                baseRiskPct: item.candidate.suggestedRiskPct,
                portfolioState: args.portfolioState,
                params,
            });
            const suggestedRiskPct = guard.suggestedRiskPct;
            const mergedBlockedReasons = [...blockedReasons, ...guard.blockedReasons];
            if (
                grade === 'C'
                && mergedBlockedReasons.length === 0
                && (item.candidate.failed?.length ?? 0) > 0
            ) {
                mergedBlockedReasons.push(item.candidate.failed![0]);
            }
            const executionMode: WeiShenExecutionMode = grade !== 'C'
                && params.grading.tradableGrades.includes(grade as 'A' | 'B')
                && suggestedRiskPct > 0
                && mergedBlockedReasons.length === 0
                ? 'trade'
                : 'observe';
            const confidence = grade === item.candidate.grade
                ? (item.candidate.confidenceScore ?? params.grading.baseConfidence[grade])
                : params.grading.baseConfidence[grade];

            return {
                direction: item.direction,
                entryType: item.entryType,
                grade,
                executionMode,
                confidence,
                passed: item.candidate.passed ?? [],
                failed: item.candidate.failed ?? [],
                blockedReasons: mergedBlockedReasons,
                suggestedRiskPct,
                stopLossPrice: item.candidate.stopLossPrice,
                invalidationPrice: item.candidate.invalidationPrice,
                eligible,
            };
        })
        .filter((candidate) =>
            candidate.passed.length > 0
            || candidate.failed.length > 0
            || candidate.blockedReasons.length > 0
        );

    if (normalized.length === 0) {
        return null;
    }

    normalized.sort((left, right) => {
        const leftTradeScore = left.executionMode === 'trade' ? 100 : 0;
        const rightTradeScore = right.executionMode === 'trade' ? 100 : 0;
        const tradeDelta = rightTradeScore - leftTradeScore;
        if (tradeDelta !== 0) {
            return tradeDelta;
        }

        const leftEligible = left.eligible ? 10 : 0;
        const rightEligible = right.eligible ? 10 : 0;
        const eligibleDelta = (rightEligible + gradeWeight(right.grade)) - (leftEligible + gradeWeight(left.grade));
        if (eligibleDelta !== 0) {
            return eligibleDelta;
        }

        return right.confidence - left.confidence;
    });

    const best = normalized[0];
    return {
        direction: best.direction,
        entryType: best.entryType,
        grade: best.grade,
        executionMode: best.executionMode,
        confidence: best.confidence,
        passed: best.passed,
        failed: best.failed,
        blockedReasons: best.blockedReasons,
        suggestedRiskPct: best.suggestedRiskPct,
        stopLossPrice: best.stopLossPrice,
        invalidationPrice: best.invalidationPrice,
    };
}
