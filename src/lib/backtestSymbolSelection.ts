import type { TickerData } from './types.ts';

const BACKTEST_SYMBOL_PATTERN = /^[\p{L}\p{N}]{1,40}USDT$/u;

export function isBacktestSymbolCandidate(symbol: string): boolean {
    return BACKTEST_SYMBOL_PATTERN.test(symbol);
}

export function selectBacktestSymbolsByVolume(
    tickers: Array<Pick<TickerData, 'symbol' | 'quoteVolume'>>
): string[] {
    return [...tickers]
        .filter((ticker) => isBacktestSymbolCandidate(ticker.symbol))
        .sort((a, b) => Number(b.quoteVolume) - Number(a.quoteVolume))
        .map((ticker) => ticker.symbol);
}
