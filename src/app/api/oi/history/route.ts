import { NextResponse } from 'next/server';
import { fetchBinance } from '@/lib/binanceApi';

/**
 * OI 历史数据 API
 * 返回指定币种在不同时间点的持仓量数据
 * 用于计算真实的 OI 增长率
 */

// 内存缓存 - 存储历史 OI 数据
const oiHistoryCache = new Map<string, {
    timestamp: number;
    data: {
        current: number;
        oneHourAgo: number;
        fourHoursAgo: number;
        oneDayAgo: number;
    };
}>();

// 滚动窗口存储 - 保留最近 24 小时的数据点
const oiDataPoints = new Map<string, Array<{
    timestamp: number;
    value: number;
}>>();

const MAX_DATA_POINTS = 288; // 24小时 * 12 (每5分钟一个点)
const CACHE_DURATION = 5 * 60 * 1000; // 5分钟缓存

export async function GET(request: Request) {
    const { searchParams } = new URL(request.url);
    const symbol = searchParams.get('symbol');

    if (!symbol) {
        return NextResponse.json({ error: 'Symbol is required' }, { status: 400 });
    }

    try {
        // 检查缓存
        const cached = oiHistoryCache.get(symbol);
        const now = Date.now();

        if (cached && (now - cached.timestamp) < CACHE_DURATION) {
            return NextResponse.json(cached.data);
        }

        // 获取当前 OI
        const currentOI = await fetchCurrentOI(symbol);

        // 获取历史数据点
        const dataPoints = oiDataPoints.get(symbol) || [];

        // 添加当前数据点
        dataPoints.push({
            timestamp: now,
            value: currentOI
        });

        // 保持数据点数量在限制内
        if (dataPoints.length > MAX_DATA_POINTS) {
            dataPoints.shift(); // 移除最老的数据点
        }

        // 更新存储
        oiDataPoints.set(symbol, dataPoints);

        // 计算历史值
        const oneHourAgo = findClosestValue(dataPoints, now - 60 * 60 * 1000) || currentOI;
        const fourHoursAgo = findClosestValue(dataPoints, now - 4 * 60 * 60 * 1000) || currentOI;
        const oneDayAgo = findClosestValue(dataPoints, now - 24 * 60 * 60 * 1000) || currentOI;

        const result = {
            current: currentOI,
            oneHourAgo,
            fourHoursAgo,
            oneDayAgo
        };

        // 更新缓存
        oiHistoryCache.set(symbol, {
            timestamp: now,
            data: result
        });

        return NextResponse.json(result, {
            headers: {
                'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600',
            }
        });

    } catch (error) {
        console.error(`Failed to fetch OI history for ${symbol}:`, error);
        return NextResponse.json(
            { error: 'Failed to fetch OI history' },
            { status: 500 }
        );
    }
}

// 辅助函数：获取当前 OI
async function fetchCurrentOI(symbol: string): Promise<number> {
    const response = await fetchBinance(`/fapi/v1/openInterest?symbol=${symbol}`, { revalidate: 60 });

    if (!response.ok) {
        throw new Error(`Failed to fetch OI for ${symbol}`);
    }

    const data = await response.json();
    return parseFloat(data.openInterest || '0');
}

// 辅助函数：找到最接近目标时间的值
function findClosestValue(
    dataPoints: Array<{ timestamp: number; value: number }>,
    targetTime: number
): number | null {
    if (dataPoints.length === 0) return null;

    let closest = dataPoints[0];
    let minDiff = Math.abs(dataPoints[0].timestamp - targetTime);

    for (const point of dataPoints) {
        const diff = Math.abs(point.timestamp - targetTime);
        if (diff < minDiff) {
            minDiff = diff;
            closest = point;
        }
    }

    // 如果最接近的点超过 15 分钟，返回 null（数据太旧）
    if (minDiff > 15 * 60 * 1000) {
        return null;
    }

    return closest.value;
}
