export const YAHOO_CHART_HOSTS = [
    'query1.finance.yahoo.com',
    'query2.finance.yahoo.com',
] as const;

export const YAHOO_CHART_HOST_TIMEOUT_MS = 4_000;

export const MACRO_SOURCE_FRESHNESS_MODE = {
    market: 'intraday',
    'us-equities': 'daily',
    'hk-equities': 'daily',
    'a-share-equities': 'daily',
} as const;
