export const TRADINGVIEW_WIDGET_UPSTREAM_URL = 'https://www.tradingview.com/embed-widget/advanced-chart/?locale=zh_CN';
const TRADINGVIEW_WIDGET_ROUTE = '/embed-widget/advanced-chart';

const BLOCKED_WIDGET_HOST = 'https://www.tradingview-widget.com/';
const ACCESSIBLE_WIDGET_HOST = 'https://www.tradingview.com/';

export function buildTradingViewPerpetualSymbol(symbol: string): string {
    return `BINANCE:${symbol.trim().toUpperCase()}.P`;
}

export function buildTradingViewSymbol(symbol: string): string {
    const normalized = symbol.trim().toUpperCase();
    return normalized.includes(':')
        ? normalized
        : buildTradingViewPerpetualSymbol(normalized);
}

export function buildTradingViewWidgetEmbedUrl(symbol: string): string {
    const tradingViewSymbol = buildTradingViewSymbol(symbol);
    const url = new URL(TRADINGVIEW_WIDGET_ROUTE, 'http://localhost');
    url.searchParams.set('locale', 'zh_CN');
    url.hash = encodeURIComponent(JSON.stringify({
        autosize: true,
        width: '100%',
        height: '100%',
        symbol: tradingViewSymbol,
        interval: tradingViewSymbol.startsWith('SSE:') || tradingViewSymbol.startsWith('SZSE:')
            ? 'D'
            : '15',
        timezone: 'Asia/Shanghai',
        theme: 'dark',
        style: '1',
        locale: 'zh_CN',
        hide_side_toolbar: true,
        allow_symbol_change: false,
        withdateranges: true,
        save_image: false,
        calendar: false,
        support_host: 'https://www.tradingview.com',
    }));
    return `${url.pathname}${url.search}${url.hash}`;
}

export function rewriteTradingViewWidgetHtml(html: string): string {
    return html
        .replaceAll(BLOCKED_WIDGET_HOST, ACCESSIBLE_WIDGET_HOST)
        .replaceAll(
            '"^embed-widget/([0-9a-zA-Z-]+)/(([0-9a-zA-Z-]+)/)?$"',
            '"^embed-widget/([0-9a-zA-Z-]+)$","^embed-widget/([0-9a-zA-Z-]+)/(([0-9a-zA-Z-]+)/)?$"'
        );
}
