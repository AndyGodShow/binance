export const WEI_SHEN_UNIVERSE = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'XRPUSDT', 'DOGEUSDT'] as const;
export const WEI_SHEN_CORE_CLUSTER = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT'] as const;
export const WEI_SHEN_SPEC_CLUSTER = ['XRPUSDT', 'DOGEUSDT'] as const;

export type WeiShenUniverseSymbol = (typeof WEI_SHEN_UNIVERSE)[number];

export function isWeiShenUniverseSymbol(symbol: string): symbol is WeiShenUniverseSymbol {
    return WEI_SHEN_UNIVERSE.includes(symbol as WeiShenUniverseSymbol);
}

export function filterWeiShenUniverseSymbols(symbols: string[]): WeiShenUniverseSymbol[] {
    const uniqueSymbols = new Set(symbols.map((symbol) => symbol.trim().toUpperCase()));

    return WEI_SHEN_UNIVERSE.filter((symbol) => uniqueSymbols.has(symbol));
}

export function resolveStrategyUniverseSymbols(strategyId: string, symbols: string[]): string[] {
    if (strategyId !== 'wei-shen-ledger') {
        return Array.from(new Set(symbols.map((symbol) => symbol.trim().toUpperCase()).filter(Boolean)));
    }

    return filterWeiShenUniverseSymbols(symbols);
}

export function getDefaultUniverseForStrategy(strategyId: string): readonly string[] | null {
    if (strategyId === 'wei-shen-ledger') {
        return WEI_SHEN_UNIVERSE;
    }

    return null;
}
