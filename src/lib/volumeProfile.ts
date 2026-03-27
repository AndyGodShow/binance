/**
 * Volume Profile 计算模块
 * 用于分析价格区间的成交量分布，识别支撑/阻力位
 */

import { OHLC } from './types';

export interface VolumeProfile {
    symbol: string;
    vah: number;              // Value Area High（成交密集区上沿，70% 成交量的上界）
    val: number;              // Value Area Low（成交密集区下沿，70% 成交量的下界）
    poc: number;              // Point of Control（最大成交量价位）
    valueArea: number;        // Value Area 范围（VAH - VAL）
    priceRanges: PriceRange[]; // 价格区间详情
}

export interface PriceRange {
    price: number;            // 价格（区间中点）
    volume: number;           // 该价格区间的成交量
    percentage: number;       // 占总成交量百分比
}

/**
 * 计算 Volume Profile
 * 
 * @param candles K线数据
 * @param numBins 价格区间数量（分桶数）
 * @param symbol 交易对
 * @returns Volume Profile 数据
 */
export function calculateVolumeProfile(
    candles: OHLC[],
    numBins: number = 50,
    symbol: string = ''
): VolumeProfile {
    if (candles.length === 0) {
        return {
            symbol,
            vah: 0,
            val: 0,
            poc: 0,
            valueArea: 0,
            priceRanges: []
        };
    }

    // 找出价格范围（使用 reduce 避免大数组时 Math.min/max spread 栈溢出）
    let minPrice = Infinity;
    let maxPrice = -Infinity;
    for (const c of candles) {
        if (c.low < minPrice) minPrice = c.low;
        if (c.high > maxPrice) maxPrice = c.high;
    }
    const priceStep = (maxPrice - minPrice) / numBins;

    // 初始化价格区间
    const bins: Map<number, number> = new Map();

    for (let i = 0; i < numBins; i++) {
        const binPrice = minPrice + (i + 0.5) * priceStep;
        bins.set(binPrice, 0);
    }

    // 将每根 K 线的成交量分配到价格区间
    for (const candle of candles) {
        const avgPrice = (candle.high + candle.low + candle.close) / 3;
        const binIndex = Math.min(
            Math.floor((avgPrice - minPrice) / priceStep),
            numBins - 1
        );
        const binPrice = minPrice + (binIndex + 0.5) * priceStep;

        bins.set(binPrice, (bins.get(binPrice) || 0) + candle.volume);
    }

    // 转换为数组并排序
    const priceRanges: PriceRange[] = Array.from(bins.entries())
        .map(([price, volume]) => ({
            price,
            volume,
            percentage: 0 // 稍后计算
        }))
        .sort((a, b) => b.volume - a.volume); // 按成交量降序

    const totalVolume = priceRanges.reduce((sum, range) => sum + range.volume, 0);

    // 计算百分比
    priceRanges.forEach(range => {
        range.percentage = totalVolume > 0 ? (range.volume / totalVolume) * 100 : 0;
    });

    // POC: 成交量最大的价位
    const poc = priceRanges[0]?.price || 0;

    // 计算 Value Area (70% 成交量)
    const { vah, val } = calculateValueArea(priceRanges, totalVolume);

    // 按价格排序（便于显示）
    priceRanges.sort((a, b) => a.price - b.price);

    return {
        symbol,
        vah,
        val,
        poc,
        valueArea: vah - val,
        priceRanges
    };
}

/**
 * 计算 Value Area（70% 成交量集中区间）
 * 
 * @param priceRanges 价格区间数组（已按成交量降序排列）
 * @param totalVolume 总成交量
 * @returns VAH 和 VAL
 */
function calculateValueArea(
    priceRanges: PriceRange[],
    totalVolume: number
): { vah: number; val: number } {
    const targetVolume = totalVolume * 0.7; // 70% 成交量
    let accumulatedVolume = 0;
    const selectedRanges: PriceRange[] = [];

    // 从成交量最大的区间开始累加，直到达到 70%
    for (const range of priceRanges) {
        selectedRanges.push(range);
        accumulatedVolume += range.volume;

        if (accumulatedVolume >= targetVolume) {
            break;
        }
    }

    // VAH: 所选区间的最高价
    // VAL: 所选区间的最低价
    const prices = selectedRanges.map(r => r.price);
    const vah = Math.max(...prices);
    const val = Math.min(...prices);

    return { vah, val };
}

