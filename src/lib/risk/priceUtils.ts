/**
 * 价格精度工具函数
 * 根据价格大小动态调整精度
 */

const MAX_PRICE_DECIMALS = 8;

function clampPricePrecision(precision: number): number {
    return Math.min(MAX_PRICE_DECIMALS, Math.max(0, precision));
}

function trimTrailingZeros(value: string): string {
    if (!value.includes('.')) {
        return value;
    }

    return value
        .replace(/(\.\d*?[1-9])0+$/, '$1')
        .replace(/\.0+$/, '')
        .replace(/\.$/, '');
}

export function getPricePrecision(price: number | string, extraDecimals: number = 0): number {
    const numericPrice = Math.abs(Number(price));

    if (!Number.isFinite(numericPrice) || numericPrice === 0) {
        return 2;
    }

    const basePrecision = numericPrice >= 1
        ? 2
        : Math.ceil(-Math.log10(numericPrice)) + 1;

    return clampPricePrecision(basePrecision + extraDecimals);
}

export function formatPrice(
    price: number | string,
    referencePrice: number | string = price,
    extraDecimals: number = 0
): string {
    const numericPrice = Number(price);

    if (!Number.isFinite(numericPrice)) {
        return '0';
    }

    return trimTrailingZeros(
        numericPrice.toFixed(getPricePrecision(referencePrice, extraDecimals))
    );
}

export function roundPrice(
    price: number,
    referencePrice: number | string = price,
    extraDecimals: number = 1
): number {
    if (!Number.isFinite(price)) {
        return 0;
    }

    return Number(
        price.toFixed(getPricePrecision(referencePrice, extraDecimals))
    );
}

export function roundPercentage(percentage: number): number {
    return Math.round(percentage * 100) / 100;  // 百分比保留2位
}

export function atrPercentToPriceDistance(
    entryPrice: number,
    atrPercent?: number,
    fallbackPercent: number = 2
): number {
    if (typeof atrPercent === 'number' && Number.isFinite(atrPercent) && atrPercent > 0) {
        return entryPrice * (atrPercent / 100);
    }

    return entryPrice * (fallbackPercent / 100);
}
