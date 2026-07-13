const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const DEFAULT_SIGNATURE_LIMIT = 12;

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
        {
            name: 'market-health',
            path: '/api/health/market',
            expect: 'market-health',
            allowNotReady: true,
            minSymbols: 500,
            allowedNotReadyReasons: ['redis-not-configured', 'enrichment-building', 'enrichment-stuck', 'enriched-snapshot-stale'],
        },
        { name: 'market-light', path: '/api/market/light', expect: 'array' },
        { name: 'market-multiframe', path: `/api/market/multiframe?symbols=${symbol}`, expect: 'object' },
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
    if (endpoint.expect === 'market-health') {
        const valid = payload
            && payload.service === 'market'
            && typeof payload.ready === 'boolean'
            && ['enriched', 'lightweight', 'unavailable'].includes(payload.dataQuality)
            && ['ready', 'building', 'stuck', 'blocked'].includes(payload.buildState)
            && Number.isInteger(payload.symbolCount)
            && payload.symbolCount >= 0;
        if (!valid) {
            throw new Error(`${endpoint.name} expected a valid market health payload`);
        }
        if (payload.serving !== true || payload.symbolCount < (endpoint.minSymbols ?? 1)) {
            throw new Error(`${endpoint.name} expected serving market data with at least ${endpoint.minSymbols ?? 1} symbols`);
        }
        if (payload.ready === false && endpoint.allowedNotReadyReasons
            && !endpoint.allowedNotReadyReasons.includes(payload.reason)) {
            throw new Error(`${endpoint.name} returned unexpected degradation reason ${payload.reason ?? 'missing'}`);
        }
        return;
    }

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

function describePrimitive(value) {
    if (value === null) {
        return 'null';
    }

    if (Array.isArray(value)) {
        return 'array';
    }

    return typeof value;
}

function summarizeObjectKeys(value, limit = DEFAULT_SIGNATURE_LIMIT) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return [];
    }

    return Object.keys(value)
        .sort()
        .slice(0, limit);
}

function findArraySymbolEntry(payload, symbol) {
    if (!Array.isArray(payload) || !symbol) {
        return null;
    }

    return payload.find((item) => item && typeof item === 'object' && item.symbol === symbol) ?? null;
}

function findObjectSymbolEntry(payload, symbol) {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload) || !symbol) {
        return null;
    }

    const value = payload[symbol];
    return value && typeof value === 'object' ? value : null;
}

function summarizeArrayPayload(payload, symbol) {
    const firstItem = payload[0] ?? null;
    const symbolEntry = findArraySymbolEntry(payload, symbol);
    const sample = symbolEntry ?? firstItem;

    return {
        kind: 'array',
        length: payload.length,
        firstItemType: describePrimitive(firstItem),
        sampleKeys: summarizeObjectKeys(sample),
        symbolPresent: Boolean(symbolEntry),
        symbolKeys: summarizeObjectKeys(symbolEntry),
    };
}

function summarizeObjectPayload(payload, symbol) {
    const topLevelKeys = Object.keys(payload).sort();
    const symbolEntry = findObjectSymbolEntry(payload, symbol);
    const firstValue = topLevelKeys.length > 0 ? payload[topLevelKeys[0]] : null;
    const sample = symbolEntry ?? firstValue;

    return {
        kind: 'object',
        keyCount: topLevelKeys.length,
        topLevelKeys: topLevelKeys.slice(0, DEFAULT_SIGNATURE_LIMIT),
        sampleType: describePrimitive(sample),
        sampleKeys: summarizeObjectKeys(sample),
        symbolPresent: Boolean(symbolEntry),
        symbolKeys: summarizeObjectKeys(symbolEntry),
    };
}

function summarizeBacktestPayload(payload) {
    const rows = Array.isArray(payload?.data) ? payload.data : [];
    const firstRow = rows[0] ?? null;
    const lastRow = rows[rows.length - 1] ?? null;

    return {
        kind: 'backtest',
        count: rows.length,
        rowKeys: summarizeObjectKeys(firstRow),
        firstOpenTimeType: describePrimitive(firstRow?.openTime),
        lastOpenTimeType: describePrimitive(lastRow?.openTime),
    };
}

export function createEndpointBaseline(endpoint, payload, options = {}) {
    const symbol = toSymbol(options.symbol);
    validatePayload(endpoint, payload);

    if (endpoint.expect === 'array') {
        return summarizeArrayPayload(payload, symbol);
    }

    if (endpoint.expect === 'market-health') {
        return {
            kind: 'market-health',
            service: payload.service,
            dataQuality: payload.dataQuality,
            buildState: payload.buildState,
        };
    }

    if (endpoint.expect === 'backtest') {
        return summarizeBacktestPayload(payload);
    }

    return summarizeObjectPayload(payload, symbol);
}

function compareSignatureList(label, expected, actual, issues) {
    if (expected.join('|') !== actual.join('|')) {
        issues.push(`${label} changed from [${expected.join(', ')}] to [${actual.join(', ')}]`);
    }
}

export function compareEndpointToBaseline(endpoint, baseline, payload, options = {}) {
    const current = createEndpointBaseline(endpoint, payload, options);
    const issues = [];

    if (baseline.kind !== current.kind) {
        issues.push(`${endpoint.name} payload kind changed from ${baseline.kind} to ${current.kind}`);
        return issues;
    }

    if (baseline.kind === 'market-health') {
        if (current.service !== 'market') issues.push('market-health service changed');
        return issues;
    }

    if (baseline.kind === 'array') {
        if (current.length === 0) {
            issues.push(`${endpoint.name} returned empty array`);
        }
        if (baseline.firstItemType !== current.firstItemType) {
            issues.push(`${endpoint.name} first item type changed from ${baseline.firstItemType} to ${current.firstItemType}`);
        }
        compareSignatureList(`${endpoint.name} sample keys`, baseline.sampleKeys, current.sampleKeys, issues);
        if (baseline.symbolPresent && !current.symbolPresent) {
            issues.push(`${endpoint.name} no longer contains requested symbol`);
        }
        if (baseline.symbolPresent) {
            compareSignatureList(`${endpoint.name} symbol keys`, baseline.symbolKeys, current.symbolKeys, issues);
        }
        return issues;
    }

    if (baseline.kind === 'object') {
        if (current.keyCount === 0 && baseline.keyCount > 0 && !endpoint.allowEmptyObject) {
            issues.push(`${endpoint.name} returned empty object`);
        }
        if (baseline.sampleType !== current.sampleType) {
            issues.push(`${endpoint.name} sample type changed from ${baseline.sampleType} to ${current.sampleType}`);
        }
        compareSignatureList(`${endpoint.name} top-level keys`, baseline.topLevelKeys, current.topLevelKeys, issues);
        compareSignatureList(`${endpoint.name} sample keys`, baseline.sampleKeys, current.sampleKeys, issues);
        if (baseline.symbolPresent && !current.symbolPresent) {
            issues.push(`${endpoint.name} no longer contains requested symbol`);
        }
        if (baseline.symbolPresent) {
            compareSignatureList(`${endpoint.name} symbol keys`, baseline.symbolKeys, current.symbolKeys, issues);
        }
        return issues;
    }

    if (current.count === 0) {
        issues.push(`${endpoint.name} returned empty backtest data`);
    }
    compareSignatureList(`${endpoint.name} row keys`, baseline.rowKeys, current.rowKeys, issues);
    if (baseline.firstOpenTimeType !== current.firstOpenTimeType) {
        issues.push(`${endpoint.name} first row openTime type changed from ${baseline.firstOpenTimeType} to ${current.firstOpenTimeType}`);
    }
    if (baseline.lastOpenTimeType !== current.lastOpenTimeType) {
        issues.push(`${endpoint.name} last row openTime type changed from ${baseline.lastOpenTimeType} to ${current.lastOpenTimeType}`);
    }

    return issues;
}

function asFiniteNumber(value) {
    if (typeof value === 'number') {
        return Number.isFinite(value) ? value : null;
    }

    if (typeof value === 'string' && value.trim()) {
        const parsed = Number.parseFloat(value);
        return Number.isFinite(parsed) ? parsed : null;
    }

    return null;
}

export function validateCrossEndpointConsistency(payloadByEndpoint, options = {}) {
    const symbol = toSymbol(options.symbol);
    const issues = [];
    const market = Array.isArray(payloadByEndpoint['market']) ? payloadByEndpoint['market'] : null;
    const marketLight = Array.isArray(payloadByEndpoint['market-light']) ? payloadByEndpoint['market-light'] : null;
    const multiframe = payloadByEndpoint['market-multiframe'] && typeof payloadByEndpoint['market-multiframe'] === 'object'
        ? payloadByEndpoint['market-multiframe']
        : null;
    const oiMultiframe = payloadByEndpoint['oi-multiframe'] && typeof payloadByEndpoint['oi-multiframe'] === 'object'
        ? payloadByEndpoint['oi-multiframe']
        : null;
    const rsrs = payloadByEndpoint['rsrs'] && typeof payloadByEndpoint['rsrs'] === 'object'
        ? payloadByEndpoint['rsrs']
        : null;
    const backtest = payloadByEndpoint['backtest-klines'] && typeof payloadByEndpoint['backtest-klines'] === 'object'
        ? payloadByEndpoint['backtest-klines']
        : null;

    const marketEntry = findArraySymbolEntry(market, symbol);
    const lightEntry = findArraySymbolEntry(marketLight, symbol);

    if (market && !marketEntry) {
        issues.push(`market payload missing ${symbol}`);
    }
    if (marketLight && !lightEntry) {
        issues.push(`market-light payload missing ${symbol}`);
    }

    [marketEntry, lightEntry].forEach((entry, index) => {
        if (!entry) {
            return;
        }
        const source = index === 0 ? 'market' : 'market-light';
        if (asFiniteNumber(entry.lastPrice) === null) {
            issues.push(`${source}.${symbol}.lastPrice is not numeric`);
        }
        if (asFiniteNumber(entry.markPrice) === null) {
            issues.push(`${source}.${symbol}.markPrice is not numeric`);
        }
        if (typeof entry.fundingRate !== 'string') {
            issues.push(`${source}.${symbol}.fundingRate is not a string`);
        }
    });

    if (multiframe) {
        const multiframeEntry = multiframe[symbol];
        if (!multiframeEntry || asFiniteNumber(multiframeEntry.o15m) === null || asFiniteNumber(multiframeEntry.o1h) === null || asFiniteNumber(multiframeEntry.o4h) === null) {
            issues.push(`market-multiframe.${symbol} is missing required open anchors`);
        }
    }

    if (oiMultiframe && Object.keys(oiMultiframe).length > 0) {
        const oiEntry = oiMultiframe[symbol];
        if (!oiEntry) {
            issues.push(`oi-multiframe payload missing ${symbol}`);
        } else if (asFiniteNumber(oiEntry.currentValue) === null) {
            issues.push(`oi-multiframe.${symbol}.currentValue is not numeric`);
        }
    }

    if (rsrs && Object.keys(rsrs).length > 0) {
        const rsrsEntry = rsrs[symbol];
        if (!rsrsEntry) {
            issues.push(`rsrs payload missing ${symbol}`);
        } else {
            ['beta', 'r2', 'rsrsFinal', 'dynamicLongThreshold', 'dynamicShortThreshold'].forEach((key) => {
                if (asFiniteNumber(rsrsEntry[key]) === null) {
                    issues.push(`rsrs.${symbol}.${key} is not numeric`);
                }
            });
            if (typeof rsrsEntry.method !== 'string' || rsrsEntry.method.trim().length === 0) {
                issues.push(`rsrs.${symbol}.method is missing`);
            }
        }
    }

    if (backtest && Array.isArray(backtest.data)) {
        const rows = backtest.data;
        for (let index = 1; index < rows.length; index += 1) {
            const previousOpenTime = asFiniteNumber(rows[index - 1]?.openTime);
            const currentOpenTime = asFiniteNumber(rows[index]?.openTime);
            if (previousOpenTime === null || currentOpenTime === null || currentOpenTime <= previousOpenTime) {
                issues.push(`backtest-klines data is not strictly increasing at row ${index}`);
                break;
            }
        }
    }

    return issues;
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
