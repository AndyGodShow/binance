export function trimLeaderboardDisplaySymbol(symbol: string): string {
    return symbol.endsWith('USDT') ? symbol.slice(0, -4) : symbol;
}
