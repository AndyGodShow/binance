import { NextResponse } from 'next/server';
import { fetchBinanceJson } from '@/lib/binanceApi';

export const dynamic = 'force-dynamic';

type CheckStatus = 'pass' | 'warn' | 'fail';

interface HealthCheck {
    name: string;
    status: CheckStatus;
    latencyMs: number;
    details?: Record<string, unknown>;
    error?: string;
}

async function runCheck(
    name: string,
    fn: () => Promise<Record<string, unknown> | undefined>,
    fallbackStatus: CheckStatus = 'fail'
): Promise<HealthCheck> {
    const startedAt = Date.now();

    try {
        const details = await fn();
        return {
            name,
            status: 'pass',
            latencyMs: Date.now() - startedAt,
            details,
        };
    } catch (error) {
        return {
            name,
            status: fallbackStatus,
            latencyMs: Date.now() - startedAt,
            error: error instanceof Error ? error.message : String(error),
        };
    }
}

export async function GET() {
    const startedAt = Date.now();

    const checks = await Promise.all([
        runCheck('binance.ticker24hr', async () => {
            const tickers = await fetchBinanceJson<unknown>('/fapi/v1/ticker/24hr', {
                revalidate: 5,
                timeoutMs: 6000,
            });

            if (!Array.isArray(tickers) || tickers.length === 0) {
                throw new Error('Ticker endpoint returned no rows');
            }

            return { rowCount: tickers.length };
        }),
        runCheck('binance.premiumIndex', async () => {
            const premiums = await fetchBinanceJson<unknown>('/fapi/v1/premiumIndex', {
                revalidate: 5,
                timeoutMs: 6000,
            });

            if (!Array.isArray(premiums) || premiums.length === 0) {
                throw new Error('Premium index endpoint returned no rows');
            }

            return { rowCount: premiums.length };
        }),
        runCheck('binance.exchangeInfo', async () => {
            const exchangeInfo = await fetchBinanceJson<{ symbols?: unknown[] }>('/fapi/v1/exchangeInfo', {
                revalidate: 3600,
                timeoutMs: 8000,
            });

            if (!Array.isArray(exchangeInfo.symbols) || exchangeInfo.symbols.length === 0) {
                throw new Error('Exchange info endpoint returned no symbols');
            }

            return { symbolCount: exchangeInfo.symbols.length };
        }, 'warn'),
        runCheck('binance.openInterest.btc', async () => {
            const openInterest = await fetchBinanceJson<{ openInterest?: string }>('/fapi/v1/openInterest?symbol=BTCUSDT', {
                revalidate: 30,
                timeoutMs: 6000,
            });

            if (typeof openInterest.openInterest !== 'string') {
                throw new Error('Open interest payload missing openInterest');
            }

            return { openInterest: openInterest.openInterest };
        }, 'warn'),
    ]);

    const hasFail = checks.some((check) => check.status === 'fail');
    const hasWarn = checks.some((check) => check.status === 'warn');
    const overallStatus: 'ok' | 'degraded' | 'down' = hasFail
        ? 'down'
        : hasWarn
            ? 'degraded'
            : 'ok';

    const statusCode = overallStatus === 'down' ? 503 : 200;

    return NextResponse.json(
        {
            status: overallStatus,
            checkedAt: new Date().toISOString(),
            responseTimeMs: Date.now() - startedAt,
            deployment: {
                environment: process.env.NODE_ENV,
                region: process.env.VERCEL_REGION || null,
                url: process.env.VERCEL_URL || null,
                commitSha: process.env.VERCEL_GIT_COMMIT_SHA || null,
                commitRef: process.env.VERCEL_GIT_COMMIT_REF || null,
            },
            runtime: {
                node: process.version,
                uptimeSeconds: Math.round(process.uptime()),
            },
            checks,
        },
        {
            status: statusCode,
            headers: {
                'Cache-Control': 'no-store, max-age=0',
                'X-Health-Status': overallStatus,
            },
        }
    );
}
