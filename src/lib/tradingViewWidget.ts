export const TRADINGVIEW_ADVANCED_CHART_SCRIPT_URL = 'https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js';

export interface TradingViewAdvancedChartConfig {
    autosize: boolean;
    symbol: string;
    interval: string;
    timezone: string;
    theme: 'dark' | 'light';
    backgroundColor: string;
    gridColor: string;
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
        symbol: buildTradingViewPerpetualSymbol(symbol),
        interval: '15',
        timezone: 'Asia/Shanghai',
        theme: 'dark',
        backgroundColor: 'rgba(22, 26, 30, 1)',
        gridColor: 'rgba(55, 65, 81, 0.35)',
        style: '1',
        locale: 'zh_CN',
        hide_side_toolbar: false,
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

export function mountTradingViewAdvancedChart(container: HTMLElement, symbol: string): HTMLScriptElement {
    resetTradingViewWidgetContainer(container);

    const widgetContainer = document.createElement('div');
    widgetContainer.className = 'tradingview-widget-container';
    widgetContainer.style.height = '100%';
    widgetContainer.style.width = '100%';

    const widget = document.createElement('div');
    widget.className = 'tradingview-widget-container__widget';
    widget.style.height = '100%';
    widget.style.width = '100%';

    const script = document.createElement('script');
    script.type = 'text/javascript';
    script.src = TRADINGVIEW_ADVANCED_CHART_SCRIPT_URL;
    script.async = true;
    script.textContent = JSON.stringify(buildTradingViewAdvancedChartConfig(symbol));

    widgetContainer.append(widget, script);
    container.appendChild(widgetContainer);

    return script;
}
