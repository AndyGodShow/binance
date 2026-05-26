import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

const TRADINGVIEW_ADVANCED_CHART_HTML_URL = 'https://www.tradingview.com/embed-widget/advanced-chart/?locale=zh_CN';
const BLOCKED_TRADINGVIEW_WIDGET_HOST = 'https://www.tradingview-widget.com/';
const ACCESSIBLE_TRADINGVIEW_HOST = 'https://www.tradingview.com/';
const WIDGET_HTML_REFRESH_INTERVAL_MS = 30 * 60 * 1000;
const WIDGET_HTML_FETCH_TIMEOUT_MS = 6_000;
const WIDGET_HTML_FETCH_ATTEMPTS = 2;

let cachedWidgetHtml: string | null = null;
let cachedWidgetHtmlUpdatedAt = 0;
let refreshWidgetHtmlPromise: Promise<string> | null = null;

function rewriteTradingViewWidgetHtml(html: string): string {
    return html
        .replaceAll(BLOCKED_TRADINGVIEW_WIDGET_HOST, ACCESSIBLE_TRADINGVIEW_HOST)
        .replaceAll(
            '"^embed-widget/([0-9a-zA-Z-]+)/(([0-9a-zA-Z-]+)/)?$"',
            '"^embed-widget/([0-9a-zA-Z-]+)$","^embed-widget/([0-9a-zA-Z-]+)/(([0-9a-zA-Z-]+)/)?$"'
        )
        .replaceAll('window.WEBSOCKET_HOST = "widgetdata.tradingview.com";', 'window.WEBSOCKET_HOST = "data.tradingview.com";')
        .replaceAll('window.WEBSOCKET_HOST_FOR_RECONNECT = "widgetdata-backup.tradingview.com";', 'window.WEBSOCKET_HOST_FOR_RECONNECT = "prodata.tradingview.com";');
}

async function fetchTradingViewWidgetHtml(): Promise<Response> {
    let lastError: unknown;

    for (let attempt = 0; attempt < WIDGET_HTML_FETCH_ATTEMPTS; attempt += 1) {
        try {
            const response = await fetch(TRADINGVIEW_ADVANCED_CHART_HTML_URL, {
                cache: 'no-store',
                headers: {
                    'user-agent': 'Mozilla/5.0',
                    accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                },
                signal: AbortSignal.timeout(WIDGET_HTML_FETCH_TIMEOUT_MS),
            });

            if (response.ok) return response;
            lastError = new Error(`TradingView widget responded with ${response.status}`);
        } catch (error) {
            lastError = error;
        }

        await new Promise((resolve) => setTimeout(resolve, 400));
    }

    throw lastError instanceof Error ? lastError : new Error('TradingView widget unavailable');
}

async function refreshTradingViewWidgetHtml(): Promise<string> {
    refreshWidgetHtmlPromise ??= (async () => {
        const response = await fetchTradingViewWidgetHtml();
        const html = rewriteTradingViewWidgetHtml(await response.text());
        cachedWidgetHtml = html;
        cachedWidgetHtmlUpdatedAt = Date.now();

        return html;
    })().finally(() => {
        refreshWidgetHtmlPromise = null;
    });

    return refreshWidgetHtmlPromise;
}

function createTradingViewHtmlResponse(html: string): NextResponse {
    return new NextResponse(html, {
        headers: {
            'content-type': 'text/html; charset=utf-8',
            'cache-control': 'no-store',
        },
    });
}

export async function GET() {
    const cachedHtml = cachedWidgetHtml;

    if (cachedHtml) {
        if (Date.now() - cachedWidgetHtmlUpdatedAt > WIDGET_HTML_REFRESH_INTERVAL_MS) {
            void refreshTradingViewWidgetHtml().catch(() => undefined);
        }

        return createTradingViewHtmlResponse(cachedHtml);
    }

    try {
        return createTradingViewHtmlResponse(await refreshTradingViewWidgetHtml());
    } catch (error) {
        const message = error instanceof Error ? error.message : 'TradingView widget unavailable';

        if (cachedWidgetHtml) {
            return createTradingViewHtmlResponse(cachedWidgetHtml);
        }

        return NextResponse.json(
            { error: 'TradingView widget unavailable', message },
            { status: 502 }
        );
    }
}
