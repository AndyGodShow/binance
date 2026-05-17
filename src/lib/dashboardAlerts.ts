interface MarketConnectionAlertInput {
    shouldRunLiveMarketRequests: boolean;
    marketError: unknown;
    auxiliaryError: unknown;
    processedDataLength: number;
}

interface OpenInterestAlertInput {
    shouldRunLiveMarketRequests: boolean;
    hasOpenInterestPayload: boolean;
    isOpenInterestDegraded: boolean;
    processedData: Array<{
        symbol?: string;
        openInterest?: string;
        openInterestValue?: string;
    }>;
}

function isPositiveNumericString(value: string | undefined): boolean {
    if (!value) {
        return false;
    }

    const numericValue = Number.parseFloat(value);
    return Number.isFinite(numericValue) && numericValue > 0;
}

export function hasUsableOpenInterest(
    rows: Array<{
        symbol?: string;
        openInterest?: string;
        openInterestValue?: string;
    }>
): boolean {
    return rows.some((row) =>
        isPositiveNumericString(row.openInterestValue) ||
        isPositiveNumericString(row.openInterest)
    );
}

export function shouldShowMarketConnectionAlert(input: MarketConnectionAlertInput): boolean {
    if (!input.shouldRunLiveMarketRequests) {
        return false;
    }

    if (input.processedDataLength > 0) {
        return false;
    }

    return Boolean(input.marketError || input.auxiliaryError);
}

export function shouldShowOpenInterestUnavailableAlert(input: OpenInterestAlertInput): boolean {
    return input.shouldRunLiveMarketRequests &&
        input.hasOpenInterestPayload &&
        input.isOpenInterestDegraded &&
        !hasUsableOpenInterest(input.processedData);
}
