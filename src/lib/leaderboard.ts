import type {
    DashboardLeaderboards,
    LeaderboardEntry,
    LeaderboardWindow,
    OpenInterestFrameSnapshot,
    TickerData,
} from './types';

type OpenInterestWindowKey = 'change15m' | 'change1h' | 'change4h' | 'change24h';

const PRICE_WINDOW_KEYS: Record<LeaderboardWindow, keyof TickerData> = {
    '15m': 'change15m',
    '1h': 'change1h',
    '4h': 'change4h',
    '24h': 'priceChangePercent',
};

const OI_WINDOW_KEYS: Record<LeaderboardWindow, OpenInterestWindowKey> = {
    '15m': 'change15m',
    '1h': 'change1h',
    '4h': 'change4h',
    '24h': 'change24h',
};

function isFiniteNumber(value: number): boolean {
    return Number.isFinite(value);
}

function takeTop(entries: LeaderboardEntry[], limit: number): LeaderboardEntry[] {
    return entries
        .sort((a, b) => b.value - a.value)
        .slice(0, limit);
}

function takeBottom(entries: LeaderboardEntry[], limit: number): LeaderboardEntry[] {
    return entries
        .sort((a, b) => a.value - b.value)
        .slice(0, limit);
}

export function buildDashboardLeaderboards(
    tickers: TickerData[],
    openInterestFrames: Record<string, OpenInterestFrameSnapshot> = {}
): DashboardLeaderboards {
    const price = {
        '15m': [] as LeaderboardEntry[],
        '1h': [] as LeaderboardEntry[],
        '4h': [] as LeaderboardEntry[],
        '24h': [] as LeaderboardEntry[],
    };

    const oi = {
        '15m': [] as LeaderboardEntry[],
        '1h': [] as LeaderboardEntry[],
        '4h': [] as LeaderboardEntry[],
        '24h': [] as LeaderboardEntry[],
    };

    const oiToVolume: LeaderboardEntry[] = [];
    const positiveFunding: LeaderboardEntry[] = [];
    const negativeFunding: LeaderboardEntry[] = [];

    tickers.forEach((ticker) => {
        (Object.keys(PRICE_WINDOW_KEYS) as LeaderboardWindow[]).forEach((window) => {
            const rawValue = ticker[PRICE_WINDOW_KEYS[window]];
            const numericValue = typeof rawValue === 'number' ? rawValue : Number(rawValue);
            if (isFiniteNumber(numericValue)) {
                price[window].push({
                    symbol: ticker.symbol,
                    value: numericValue,
                });
            }
        });

        const oiSnapshot = openInterestFrames[ticker.symbol];
        if (oiSnapshot) {
            (Object.keys(OI_WINDOW_KEYS) as LeaderboardWindow[]).forEach((window) => {
                const change = oiSnapshot[OI_WINDOW_KEYS[window]];
                if (change && isFiniteNumber(change.percent)) {
                    oi[window].push({
                        symbol: ticker.symbol,
                        value: change.percent,
                        secondaryValue: change.value,
                    });
                }
            });
        }

        const openInterestValue = Number(ticker.openInterestValue);
        const quoteVolume = Number(ticker.quoteVolume);
        if (isFiniteNumber(openInterestValue) && isFiniteNumber(quoteVolume) && openInterestValue > 0 && quoteVolume > 0) {
            oiToVolume.push({
                symbol: ticker.symbol,
                value: openInterestValue / quoteVolume,
                secondaryValue: openInterestValue,
            });
        }

        const fundingRate = Number(ticker.fundingRate);
        if (isFiniteNumber(fundingRate) && fundingRate > 0) {
            positiveFunding.push({
                symbol: ticker.symbol,
                value: fundingRate,
            });
        } else if (isFiniteNumber(fundingRate) && fundingRate < 0) {
            negativeFunding.push({
                symbol: ticker.symbol,
                value: fundingRate,
            });
        }
    });

    return {
        price: {
            '15m': takeTop(price['15m'], 10),
            '1h': takeTop(price['1h'], 10),
            '4h': takeTop(price['4h'], 10),
            '24h': takeTop(price['24h'], 10),
        },
        oi: {
            '15m': takeTop(oi['15m'], 10),
            '1h': takeTop(oi['1h'], 10),
            '4h': takeTop(oi['4h'], 10),
            '24h': takeTop(oi['24h'], 10),
        },
        oiToVolume: takeTop(oiToVolume, 10),
        funding: {
            positive: takeTop(positiveFunding, 5),
            negative: takeBottom(negativeFunding, 5),
        },
    };
}
