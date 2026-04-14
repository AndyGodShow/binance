import type { FundingRateItem, ScheduledAlertRecord, TickerData } from './types';

function toFundingRateItems(data: TickerData[], predicate: (fundingRate: number) => boolean): FundingRateItem[] {
    return data
        .filter((ticker) => predicate(parseFloat(ticker.fundingRate || '0')))
        .slice(0, 3)
        .map((ticker) => ({
            symbol: ticker.symbol,
            fundingRate: parseFloat(ticker.fundingRate || '0'),
        }));
}

export function buildFundingRateAlert(currentData: TickerData[], timestamp: number): ScheduledAlertRecord | null {
    if (currentData.length === 0) {
        return null;
    }

    const validData = currentData.filter((ticker) => ticker.fundingRate && parseFloat(ticker.fundingRate) !== 0);
    if (validData.length === 0) {
        return null;
    }

    const sorted = [...validData].sort((a, b) =>
        parseFloat(b.fundingRate || '0') - parseFloat(a.fundingRate || '0')
    );

    const topPositive = toFundingRateItems(sorted, (fundingRate) => fundingRate > 0);
    const topNegative = toFundingRateItems([...sorted].reverse(), (fundingRate) => fundingRate < 0);

    if (topPositive.length === 0 && topNegative.length === 0) {
        return null;
    }

    return {
        id: `scheduled-${timestamp}`,
        type: 'funding-rate',
        timestamp,
        topPositive,
        topNegative,
    };
}
