export const TRADINGVIEW_ADVANCED_CHART_SCRIPT_URL = 'https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js';

export interface TradingViewAdvancedChartConfig {
    autosize: boolean;
    symbol: string;
    interval: string;
    timezone: string;
    theme: 'dark' | 'light';
    style: string;
    locale: string;
    allow_symbol_change: boolean;
    save_image: boolean;
    hide_side_toolbar: boolean;
    calendar: boolean;
    hide_volume: boolean;
    support_host: string;
}

export function buildTradingViewPerpetualSymbol(symbol: string): string {
    return `BINANCE:${symbol.trim().toUpperCase()}.P`;
}

export function buildTradingViewAdvancedChartConfig(symbol: string): TradingViewAdvancedChartConfig {
    return {
        autosize: true,
        symbol: buildTradingViewPerpetualSymbol(symbol),
        interval: '15',
        timezone: 'Asia/Shanghai',
        theme: 'dark',
        style: '1',
        locale: 'zh_CN',
        allow_symbol_change: false,
        save_image: false,
        hide_side_toolbar: false,
        calendar: false,
        hide_volume: false,
        support_host: 'https://www.tradingview.com',
    };
}

export function buildTradingViewWidgetEmbedUrl(symbol: string): URL {
    const url = new URL('https://s.tradingview.com/widgetembed/');
    url.searchParams.set('symbol', buildTradingViewPerpetualSymbol(symbol));
    url.searchParams.set('interval', '15');
    url.searchParams.set('theme', 'dark');
    url.searchParams.set('style', '1');
    url.searchParams.set('timezone', 'Asia/Shanghai');
    url.searchParams.set('locale', 'zh_CN');
    url.searchParams.set('withdateranges', '1');
    url.searchParams.set('hide_side_toolbar', '0');
    url.searchParams.set('allow_symbol_change', '0');
    url.searchParams.set('save_image', '0');
    return url;
}

export function resetTradingViewWidgetContainer(container: HTMLElement): void {
    container.replaceChildren();
}

export function mountTradingViewAdvancedChart(container: HTMLElement, symbol: string): void {
    resetTradingViewWidgetContainer(container);

    const widgetContainer = document.createElement('div');
    widgetContainer.className = 'tradingview-widget-container';
    widgetContainer.style.height = '100%';
    widgetContainer.style.width = '100%';

    const widget = document.createElement('div');
    widget.className = 'tradingview-widget-container__widget';
    widget.style.height = 'calc(100% - 32px)';
    widget.style.width = '100%';

    const script = document.createElement('script');
    script.type = 'text/javascript';
    script.src = TRADINGVIEW_ADVANCED_CHART_SCRIPT_URL;
    script.async = true;
    script.textContent = JSON.stringify(buildTradingViewAdvancedChartConfig(symbol));

    widgetContainer.append(widget, script);
    container.appendChild(widgetContainer);
}
