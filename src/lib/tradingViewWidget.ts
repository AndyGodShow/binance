export const TRADINGVIEW_ADVANCED_CHART_EMBED_URL = 'https://www.tradingview.com/embed-widget/advanced-chart/';

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
    width?: string;
    height?: string;
    utm_source?: string;
    utm_medium?: string;
    utm_campaign?: string;
    'page-uri'?: string;
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

export function buildTradingViewAdvancedChartEmbedUrl(symbol: string, pageUri = ''): string {
    const url = new URL(TRADINGVIEW_ADVANCED_CHART_EMBED_URL);
    url.searchParams.set('locale', 'zh_CN');
    const config = {
        ...buildTradingViewAdvancedChartConfig(symbol),
        width: '100%',
        height: '100%',
        utm_source: pageUri.split('/')[0] || 'binance-psi-eosin.vercel.app',
        utm_medium: 'widget',
        utm_campaign: 'advanced-chart',
        'page-uri': pageUri,
    } satisfies TradingViewAdvancedChartConfig;

    url.hash = encodeURIComponent(JSON.stringify(config));
    return url.toString();
}
