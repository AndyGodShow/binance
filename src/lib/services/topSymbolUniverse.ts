export interface MarketUniverseTicker {
    symbol: string;
    quoteVolume: string;
}

interface ExchangeInfoSymbol {
    symbol: string;
    contractType: string;
    status: string;
}

export interface MarketUniverseExchangeInfo {
    symbols: ExchangeInfoSymbol[];
}

function isActiveUsdtPerpetual(symbol: ExchangeInfoSymbol): boolean {
    return (
        /^[A-Z0-9]+USDT$/.test(symbol.symbol) &&
        symbol.symbol.endsWith('USDT') &&
        (symbol.contractType === 'PERPETUAL' || symbol.contractType === 'TRADIFI_PERPETUAL') &&
        symbol.status === 'TRADING'
    );
}

export function selectTopUsdtPerpetualSymbols(
    tickers: MarketUniverseTicker[],
    exchangeInfo: MarketUniverseExchangeInfo,
    limit: number,
): string[] {
    const allowedSymbols = new Set(
        exchangeInfo.symbols
            .filter(isActiveUsdtPerpetual)
            .map((item) => item.symbol),
    );

    const ranked = new Map<string, number>();

    tickers.forEach((ticker) => {
        if (!allowedSymbols.has(ticker.symbol)) {
            return;
        }

        const quoteVolume = Number.parseFloat(ticker.quoteVolume);
        if (!Number.isFinite(quoteVolume) || quoteVolume <= 0) {
            return;
        }

        const previous = ranked.get(ticker.symbol) ?? Number.NEGATIVE_INFINITY;
        if (quoteVolume > previous) {
            ranked.set(ticker.symbol, quoteVolume);
        }
    });

    return Array.from(ranked.entries())
        .sort((left, right) => right[1] - left[1])
        .slice(0, Math.max(0, limit))
        .map(([symbol]) => symbol);
}

export function buildSymbolChunks(symbols: string[], chunkSize: number): string[][] {
    const normalizedChunkSize = Math.max(1, Math.floor(chunkSize));
    const chunks: string[][] = [];

    for (let index = 0; index < symbols.length; index += normalizedChunkSize) {
        chunks.push(symbols.slice(index, index + normalizedChunkSize));
    }

    return chunks;
}
