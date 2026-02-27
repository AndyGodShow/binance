/**
 * 价格精度工具函数
 * 根据价格大小动态调整精度
 */

export function roundPrice(price: number): number {
    if (price < 0.01) {
        return Math.round(price * 10000) / 10000;  // 4位小数
    } else if (price < 1) {
        return Math.round(price * 1000) / 1000;    // 3位小数
    } else if (price < 100) {
        return Math.round(price * 100) / 100;      // 2位小数
    } else {
        return Math.round(price * 10) / 10;        // 1位小数
    }
}

export function roundPercentage(percentage: number): number {
    return Math.round(percentage * 100) / 100;  // 百分比保留2位
}
