import { NextRequest, NextResponse } from 'next/server';
import { dataCollector } from '@/lib/services/dataCollector';
import {
    authorizeDataDownloadRequest,
    validateDataDownloadRequest,
} from '@/lib/dataDownloadAccess';

const isServerless = !!(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME || process.env.SERVERLESS);

export async function POST(req: NextRequest) {
    if (isServerless) {
        return NextResponse.json({
            error: '云端部署不支持本地数据下载功能，回测将使用 API 数据（最近30天）',
            status: 'unsupported'
        }, { status: 400 });
    }

    const authResult = authorizeDataDownloadRequest(req.headers.get('authorization'), {
        nodeEnv: process.env.NODE_ENV,
        token: process.env.DATA_DOWNLOAD_TOKEN,
    });
    if (!authResult.ok) {
        return NextResponse.json({ error: authResult.error }, { status: authResult.status });
    }

    const payload = await req.json() as Record<string, unknown>;
    const validation = validateDataDownloadRequest({
        symbol: typeof payload.symbol === 'string' ? payload.symbol : null,
        type: typeof payload.type === 'string' ? payload.type : null,
        startDate: typeof payload.startDate === 'string' ? payload.startDate : null,
        endDate: typeof payload.endDate === 'string' ? payload.endDate : null,
    });
    if (!validation.ok) {
        return NextResponse.json({ error: validation.error }, { status: 400 });
    }

    // Start download in background
    dataCollector.downloadData(
        validation.value.symbol,
        validation.value.type,
        validation.value.startDate,
        validation.value.endDate
    ).catch(err => {
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
    const authResult = authorizeDataDownloadRequest(req.headers.get('authorization'), {
        nodeEnv: process.env.NODE_ENV,
        token: process.env.DATA_DOWNLOAD_TOKEN,
    });
    if (!authResult.ok) {
        return NextResponse.json({ error: authResult.error }, { status: authResult.status });
    }

    const { searchParams } = new URL(req.url);
    const validation = validateDataDownloadRequest({
        symbol: searchParams.get('symbol'),
        type: searchParams.get('type'),
        startDate: searchParams.get('startDate'),
        endDate: searchParams.get('endDate'),
    });
    if (!validation.ok) {
        return NextResponse.json({ error: validation.error }, { status: 400 });
    }

    const coverage = dataCollector.checkDataCoverage(
        validation.value.symbol,
        validation.value.type,
        validation.value.startDate,
        validation.value.endDate
    );
    return NextResponse.json(coverage);
}
