const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

function toSymbol(value = 'BTCUSDT') {
    const normalized = String(value).trim().toUpperCase();
    if (!normalized) {
        return 'BTCUSDT';
    }
    return normalized.endsWith('USDT') ? normalized : `${normalized}USDT`;
}

function toDateInput(timestamp) {
    return new Date(timestamp).toISOString().slice(0, 10);
}

export function buildApiSmokeEndpoints(options = {}) {
    const symbol = toSymbol(options.symbol);
    const keyword = encodeURIComponent(String(options.keyword || symbol.replace(/USDT$/, '') || 'PEPE'));
    const now = Number.isFinite(options.now) ? options.now : Date.now();
    const startTime = Math.max(0, now - (6 * HOUR_MS));
    const startDate = toDateInput(now - (7 * DAY_MS));
    const endDate = toDateInput(now);

    return [
        { name: 'market', path: '/api/market', expect: 'array' },
        { name: 'market-light', path: '/api/market/light', expect: 'array' },
        { name: 'market-multiframe', path: `/api/market/multiframe?symbols=${symbol}`, expect: 'object' },
        { name: 'oi-all', path: '/api/oi/all', expect: 'object', allowEmptyObject: true },
        { name: 'oi-multiframe', path: `/api/oi/multiframe?symbols=${symbol}`, expect: 'object', allowEmptyObject: true },
        { name: 'longshort', path: `/api/longshort?symbol=${symbol}&period=1h&limit=30`, expect: 'object' },
        { name: 'macro', path: '/api/macro', expect: 'object' },
        { name: 'rsrs', path: '/api/rsrs', expect: 'object', allowEmptyObject: true },
        { name: 'onchain-dashboard', path: `/api/onchain/dashboard?keyword=${keyword}&scope=alpha`, expect: 'object' },
        {
            name: 'backtest-klines',
            path: `/api/backtest/klines?symbol=${symbol}&interval=1h&startTime=${startTime}&endTime=${now}&limit=24&includeAuxiliary=false`,
            expect: 'backtest',
        },
        {
            name: 'data-download-coverage',
            path: `/api/data/download?symbol=${symbol}&type=metrics&startDate=${startDate}&endDate=${endDate}`,
            expect: 'object',
        },
    ];
}

export function validatePayload(endpoint, payload) {
    if (endpoint.expect === 'array') {
        if (!Array.isArray(payload) || payload.length === 0) {
            throw new Error(`${endpoint.name} expected non-empty array`);
        }
        return;
    }

    if (endpoint.expect === 'backtest') {
        if (!payload || !Array.isArray(payload.data) || payload.data.length === 0) {
            throw new Error(`${endpoint.name} expected non-empty backtest data`);
        }
        return;
    }

    if (endpoint.expect === 'object') {
        const isObject = typeof payload === 'object' && payload !== null && !Array.isArray(payload);
        if (!isObject) {
            throw new Error(`${endpoint.name} expected object`);
        }
        if (!endpoint.allowEmptyObject && Object.keys(payload).length === 0) {
            throw new Error(`${endpoint.name} expected non-empty object`);
        }
    }
}

export function createRunSummary(results) {
    const total = results.length;
    const passed = results.filter((result) => result.ok).length;
    const failed = total - passed;
    const durations = results.map((result) => result.durationMs).filter(Number.isFinite);
    const durationTotal = durations.reduce((sum, duration) => sum + duration, 0);

    return {
        total,
        passed,
        failed,
        averageDurationMs: durations.length > 0 ? Math.round(durationTotal / durations.length) : 0,
        maxDurationMs: durations.length > 0 ? Math.max(...durations) : 0,
    };
}

export function selectEndpoints(endpoints, names) {
    if (!names || names.length === 0) {
        return endpoints;
    }

    const requested = new Set(names);
    return endpoints.filter((endpoint) => requested.has(endpoint.name));
}
