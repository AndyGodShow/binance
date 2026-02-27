import { NextRequest, NextResponse } from 'next/server';
import { dataCollector } from '@/lib/services/dataCollector';

const isServerless = !!(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME || process.env.SERVERLESS);

export async function POST(req: NextRequest) {
    if (isServerless) {
        return NextResponse.json({
            error: '云端部署不支持本地数据下载功能，回测将使用 API 数据（最近30天）',
            status: 'unsupported'
        }, { status: 400 });
    }

    const { symbol, type, startDate, endDate } = await req.json();

    if (!symbol || !type || !startDate || !endDate) {
        return NextResponse.json({ error: 'Missing parameters' }, { status: 400 });
    }

    // Start download in background
    dataCollector.downloadData(symbol, type, startDate, endDate).catch(err => {
        console.error('Background download failed:', err);
    });

    return NextResponse.json({
        message: 'Download started',
        status: 'downloading'
    });
}

/**
 * Check data coverage
 */
export async function GET(req: NextRequest) {
    const { searchParams } = new URL(req.url);
    const symbol = searchParams.get('symbol');
    const type = searchParams.get('type') as 'metrics' | 'fundingRate';
    const startDate = searchParams.get('startDate');
    const endDate = searchParams.get('endDate');

    if (!symbol || !type || !startDate || !endDate) {
        return NextResponse.json({ error: 'Missing parameters' }, { status: 400 });
    }

    const coverage = dataCollector.checkDataCoverage(symbol, type, startDate, endDate);
    return NextResponse.json(coverage);
}
