export const TRADINGVIEW_ADVANCED_CHART_SCRIPT_URL = 'https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js';
export const TRADINGVIEW_ADVANCED_CHART_WIDGET_HOST = 'https://www.tradingview.com';
export const TRADINGVIEW_ADVANCED_CHART_EMBED_URL = '/embed-widget/advanced-chart';
export const TRADINGVIEW_LOCALHOST_HOSTNAME = 'localhost';

export interface TradingViewAdvancedChartConfig {
    autosize: boolean;
    width: string;
    height: string;
    symbol: string;
    interval: string;
    timezone: string;
    theme: 'dark' | 'light';
    style: string;
    locale: string;
    hide_side_toolbar: boolean;
    allow_symbol_change: boolean;
    withdateranges: boolean;
    save_image: boolean;
    calendar: boolean;
    support_host: string;
}

export function buildTradingViewPerpetualSymbol(symbol: string): string {
    return `BINANCE:${symbol.trim().toUpperCase()}.P`;
}

export function buildTradingViewAdvancedChartConfig(symbol: string): TradingViewAdvancedChartConfig {
    return {
        autosize: true,
        width: '100%',
        height: '100%',
        symbol: buildTradingViewPerpetualSymbol(symbol),
        interval: '15',
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
    };
}

export function resetTradingViewWidgetContainer(container: HTMLElement): void {
    container.replaceChildren();
}

export function normalizeTradingViewWidgetHost(host: string): string {
    return host.replace(/^127\.0\.0\.1(?=(:|$))/, TRADINGVIEW_LOCALHOST_HOSTNAME);
}

export function buildTradingViewWidgetPageUri(host: string, pathname: string): string {
    return `${normalizeTradingViewWidgetHost(host)}${pathname}`;
}

export function buildTradingViewAdvancedChartEmbedUrl(
    symbol: string,
    pageUri = '',
    origin = ''
): string {
    const config = {
        ...buildTradingViewAdvancedChartConfig(symbol),
        utm_source: pageUri.split('/')[0] || 'localhost',
        utm_medium: 'widget',
        utm_campaign: 'advanced-chart',
        'page-uri': pageUri,
    };
    const url = new URL(TRADINGVIEW_ADVANCED_CHART_EMBED_URL, 'http://localhost');
    url.searchParams.set('locale', 'zh_CN');
    url.hash = encodeURIComponent(JSON.stringify(config));
    return `${origin}${url.pathname}${url.search}${url.hash}`;
}

let prewarmTradingViewWidgetPromise: Promise<void> | null = null;

export function prewarmTradingViewAdvancedChartWidget(): Promise<void> {
    if (typeof window === 'undefined') {
        return Promise.resolve();
    }

    prewarmTradingViewWidgetPromise ??= fetch(
        buildTradingViewAdvancedChartEmbedUrl(
            'BTCUSDT',
            buildTradingViewWidgetPageUri(window.location.host, window.location.pathname)
        ),
        { cache: 'no-store' }
    ).then(() => undefined).catch(() => undefined);

    return prewarmTradingViewWidgetPromise;
}

export function mountTradingViewAdvancedChart(container: HTMLElement, symbol: string): HTMLIFrameElement {
    resetTradingViewWidgetContainer(container);
    const tradingViewSymbol = buildTradingViewPerpetualSymbol(symbol);

    const widgetContainer = document.createElement('div');
    widgetContainer.className = 'tradingview-widget-container';
    widgetContainer.style.height = '100%';
    widgetContainer.style.width = '100%';

    const widget = document.createElement('div');
    widget.className = 'tradingview-widget-container__widget';
    widget.style.height = 'calc(100% - 32px)';
    widget.style.width = '100%';

    const copyright = document.createElement('div');
    copyright.className = 'tradingview-widget-copyright';
    copyright.style.height = '32px';
    copyright.style.display = 'flex';
    copyright.style.alignItems = 'center';
    copyright.style.justifyContent = 'center';
    copyright.style.gap = '0.25rem';
    copyright.style.color = '#6b7280';
    copyright.style.fontSize = '0.75rem';

    const link = document.createElement('a');
    link.href = `https://www.tradingview.com/symbols/${tradingViewSymbol.replace(':', '-')}/`;
    link.rel = 'noopener nofollow';
    link.target = '_blank';
    link.textContent = `${tradingViewSymbol} chart`;
    link.style.color = '#60a5fa';
    link.style.textDecoration = 'none';

    const attribution = document.createElement('span');
    attribution.textContent = ' by TradingView';
    copyright.append(link, attribution);

    const frame = document.createElement('iframe');
    frame.title = `${tradingViewSymbol} TradingView chart`;
    const widgetHost = normalizeTradingViewWidgetHost(window.location.host);
    const widgetOrigin = `${window.location.protocol}//${widgetHost}`;
    frame.src = buildTradingViewAdvancedChartEmbedUrl(
        symbol,
        buildTradingViewWidgetPageUri(window.location.host, window.location.pathname),
        widgetOrigin === window.location.origin ? '' : widgetOrigin
    );
    frame.style.width = '100%';
    frame.style.height = 'calc(100% - 32px)';
    frame.style.minHeight = '448px';
    frame.style.border = '0';
    frame.allowFullscreen = true;

    widgetContainer.append(widget, copyright);
    container.appendChild(widgetContainer);
    widget.replaceWith(frame);

    return frame;
}
