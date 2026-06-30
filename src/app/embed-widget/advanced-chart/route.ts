import {
    rewriteTradingViewWidgetHtml,
    TRADINGVIEW_WIDGET_UPSTREAM_URL,
} from '@/lib/tradingViewWidget';

export const dynamic = 'force-dynamic';

export async function GET() {
    try {
        const response = await fetch(TRADINGVIEW_WIDGET_UPSTREAM_URL, {
            cache: 'no-store',
            signal: AbortSignal.timeout(6_000),
        });

        if (!response.ok) {
            return Response.json(
                { error: `TradingView responded with ${response.status}` },
                { status: 502 }
            );
        }

        return new Response(rewriteTradingViewWidgetHtml(await response.text()), {
            headers: {
                'content-type': 'text/html; charset=utf-8',
                'cache-control': 'no-store',
            },
        });
    } catch (error) {
        return Response.json(
            {
                error: 'TradingView widget unavailable',
                message: error instanceof Error ? error.message : 'Unknown error',
            },
            { status: 502 }
        );
    }
}
