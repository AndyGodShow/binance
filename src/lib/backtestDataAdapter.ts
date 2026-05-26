import type { KlineData } from '../app/api/backtest/klines/route.ts';

export type BacktestAuxiliaryQuality = 'exact' | 'forward-fill' | 'missing';

export interface MarketBar {
    time: number;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
}

export interface FundingPoint {
    time: number;
    rate: number;
    source: string;
    quality: BacktestAuxiliaryQuality;
}

export interface OpenInterestPoint {
    time: number;
    openInterest: number;
    openInterestValue?: number;
    source: string;
    quality: BacktestAuxiliaryQuality;
}

export interface BacktestDataQualityWarning {
    code: 'missing-funding' | 'missing-open-interest' | 'invalid-market-bar';
    message: string;
    count: number;
}

export interface BacktestDataQuality {
    totalBars: number;
    validBars: number;
    fundingCoverage: number;
    openInterestCoverage: number;
    warnings: BacktestDataQualityWarning[];
}

export interface BacktestDataSlice {
    bars: MarketBar[];
    funding: FundingPoint[];
    openInterest: OpenInterestPoint[];
    dataQuality: BacktestDataQuality;
}

function parseFiniteNumber(value: string | number | undefined): number | null {
    if (value === undefined) {
        return null;
    }

    const parsed = typeof value === 'number' ? value : Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : null;
}

function toQuality(source: 'exact' | 'forward-fill' | undefined): BacktestAuxiliaryQuality {
    return source ?? 'missing';
}

export function adaptKlinesToBacktestDataSlice(klines: KlineData[]): BacktestDataSlice {
    const bars: MarketBar[] = [];
    const funding: FundingPoint[] = [];
    const openInterest: OpenInterestPoint[] = [];
    let invalidMarketBars = 0;
    let missingFunding = 0;
    let missingOpenInterest = 0;

    klines.forEach((kline) => {
        const open = parseFiniteNumber(kline.open);
        const high = parseFiniteNumber(kline.high);
        const low = parseFiniteNumber(kline.low);
        const close = parseFiniteNumber(kline.close);
        const volume = parseFiniteNumber(kline.volume);

        if (
            Number.isFinite(kline.closeTime) &&
            open !== null &&
            high !== null &&
            low !== null &&
            close !== null &&
            volume !== null
        ) {
            bars.push({
                time: kline.closeTime,
                open,
                high,
                low,
                close,
                volume,
            });
        } else {
            invalidMarketBars += 1;
        }

        const fundingRate = parseFiniteNumber(kline.fundingRate);
        const fundingQuality = toQuality(kline.fundingRateSource);
        const isSettlementFundingPoint = fundingQuality !== 'forward-fill';
        if (fundingRate !== null && Number.isFinite(kline.closeTime) && isSettlementFundingPoint) {
            const quality = fundingQuality === 'missing' ? 'exact' : fundingQuality;
            funding.push({
                time: kline.closeTime,
                rate: fundingRate,
                source: quality,
                quality,
            });
        } else {
            missingFunding += 1;
        }

        const oi = parseFiniteNumber(kline.openInterest);
        if (oi !== null && Number.isFinite(kline.closeTime)) {
            const oiValue = parseFiniteNumber(kline.openInterestValue);
            const quality = toQuality(kline.openInterestSource);
            openInterest.push({
                time: kline.closeTime,
                openInterest: oi,
                openInterestValue: oiValue ?? undefined,
                source: quality === 'missing' ? 'kline' : quality,
                quality: quality === 'missing' ? 'forward-fill' : quality,
            });
        } else {
            missingOpenInterest += 1;
        }
    });

    const warnings: BacktestDataQualityWarning[] = [];
    if (invalidMarketBars > 0) {
        warnings.push({
            code: 'invalid-market-bar',
            message: `${invalidMarketBars} 根 K 线无法转换为有效 MarketBar。`,
            count: invalidMarketBars,
        });
    }
    if (missingFunding > 0) {
        warnings.push({
            code: 'missing-funding',
            message: `${missingFunding} 根 K 线缺少 fundingRate。`,
            count: missingFunding,
        });
    }
    if (missingOpenInterest > 0) {
        warnings.push({
            code: 'missing-open-interest',
            message: `${missingOpenInterest} 根 K 线缺少 openInterest。`,
            count: missingOpenInterest,
        });
    }

    const totalBars = klines.length;
    return {
        bars,
        funding,
        openInterest,
        dataQuality: {
            totalBars,
            validBars: bars.length,
            fundingCoverage: totalBars > 0 ? (funding.length / totalBars) * 100 : 0,
            openInterestCoverage: totalBars > 0 ? (openInterest.length / totalBars) * 100 : 0,
            warnings,
        },
    };
}
