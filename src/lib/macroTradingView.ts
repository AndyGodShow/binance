const NYSE_SYMBOLS = new Set(['TSM', 'BABA', 'XPEV']);
const AMEX_SYMBOLS = new Set([
    'SOXL',
    'SOXS',
    'SPXL',
    'SPXS',
    'FNGU',
    'FNGD',
    'XLK',
    'XLY',
    'XLC',
    'XLF',
    'XLV',
    'XLI',
    'XLE',
    'XLP',
    'XLU',
    'XLB',
    'XLRE',
]);

export function buildMacroEquityTradingViewSymbol(symbol: string): string {
    const normalized = symbol.trim().toUpperCase();

    if (normalized === '^HSI') return 'TVC:HSI';
    if (normalized === '^HSCE') return 'HSI:HSCEI';

    if (normalized.endsWith('.HK')) {
        const code = normalized.slice(0, -3).replace(/^0+(?=\d)/, '');
        return `HKEX:${code}`;
    }

    if (normalized.endsWith('.SS')) {
        return `SSE:${normalized.slice(0, -3)}`;
    }

    if (normalized.endsWith('.SZ')) {
        return `SZSE:${normalized.slice(0, -3)}`;
    }

    if (NYSE_SYMBOLS.has(normalized)) {
        return `NYSE:${normalized}`;
    }

    if (AMEX_SYMBOLS.has(normalized)) {
        return `AMEX:${normalized}`;
    }

    return `NASDAQ:${normalized}`;
}

export function canEmbedMacroEquityChart(symbol: string): boolean {
    const normalized = symbol.trim().toUpperCase();
    return !normalized.endsWith('.HK') && normalized !== '^HSI' && normalized !== '^HSCE';
}

export function buildMacroEquityTradingViewUrl(symbol: string): string {
    const url = new URL('https://www.tradingview.com/chart/');
    url.searchParams.set('symbol', buildMacroEquityTradingViewSymbol(symbol));
    return url.toString();
}
