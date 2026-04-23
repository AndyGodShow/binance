import {
    buildApiSmokeEndpoints,
    compareEndpointToBaseline,
    createRunSummary,
    createEndpointBaseline,
    selectEndpoints,
    validatePayload,
    validateCrossEndpointConsistency,
} from './verification-helpers.mjs';

const DEFAULT_BASE_URL = process.env.BASE_URL || 'http://127.0.0.1:3000';
const DEFAULT_SYMBOL = process.env.STABILITY_SYMBOL || process.env.SYMBOL || 'BTCUSDT';
const DEFAULT_DURATION_MS = Number.parseInt(process.env.STABILITY_DURATION_MS || String(30 * 60 * 1000), 10);
const DEFAULT_INTERVAL_MS = Number.parseInt(process.env.STABILITY_INTERVAL_MS || String(60 * 1000), 10);
const DEFAULT_TIMEOUT_MS = Number.parseInt(process.env.STABILITY_TIMEOUT_MS || '25000', 10);
const DEFAULT_ENDPOINTS = ['market', 'market-light', 'market-multiframe', 'oi-multiframe', 'rsrs', 'backtest-klines'];

function parseEndpointFilter() {
    const raw = process.env.STABILITY_ENDPOINTS;
    if (!raw) {
        return DEFAULT_ENDPOINTS;
    }

    return raw
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean);
}

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchJsonWithTimeout(url, timeoutMs) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
        const response = await fetch(url, { signal: controller.signal });
        const text = await response.text();
        const json = text ? JSON.parse(text) : null;
        return { ok: response.ok, status: response.status, json, text };
    } finally {
        clearTimeout(timeout);
    }
}

async function verifyEndpoint(baseUrl, endpoint) {
    const startedAt = Date.now();
    const url = new URL(endpoint.path, baseUrl).toString();

    try {
        const response = await fetchJsonWithTimeout(url, DEFAULT_TIMEOUT_MS);
        const durationMs = Date.now() - startedAt;

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.text.slice(0, 160)}`);
        }

        validatePayload(endpoint, response.json);

        return {
            name: endpoint.name,
            ok: true,
            status: response.status,
            durationMs,
            payload: response.json,
        };
    } catch (error) {
        return {
            name: endpoint.name,
            ok: false,
            status: 0,
            durationMs: Date.now() - startedAt,
            error: error instanceof Error ? error.message : String(error),
        };
    }
}

async function main() {
    const endpoints = selectEndpoints(
        buildApiSmokeEndpoints({ symbol: DEFAULT_SYMBOL }),
        parseEndpointFilter()
    );
    const startedAt = Date.now();
    const deadline = startedAt + DEFAULT_DURATION_MS;
    const allResults = [];
    const baselines = new Map();
    let cycle = 0;

    if (endpoints.length === 0) {
        throw new Error('No stability endpoints selected');
    }

    console.log(`Stability verifying ${endpoints.length} endpoints against ${DEFAULT_BASE_URL}`);
    console.log(`Duration=${DEFAULT_DURATION_MS}ms interval=${DEFAULT_INTERVAL_MS}ms timeout=${DEFAULT_TIMEOUT_MS}ms`);

    while (Date.now() < deadline) {
        cycle += 1;
        console.log(`Cycle ${cycle}`);
        const payloadByEndpoint = {};

        for (const endpoint of endpoints) {
            const result = await verifyEndpoint(DEFAULT_BASE_URL, endpoint);
            let baselineIssues = [];

            if (result.ok) {
                payloadByEndpoint[endpoint.name] = result.payload;
                const existingBaseline = baselines.get(endpoint.name);
                if (!existingBaseline) {
                    baselines.set(endpoint.name, createEndpointBaseline(endpoint, result.payload, { symbol: DEFAULT_SYMBOL }));
                } else {
                    baselineIssues = compareEndpointToBaseline(endpoint, existingBaseline, result.payload, { symbol: DEFAULT_SYMBOL });
                }
            }

            const normalizedResult = {
                name: result.name,
                status: result.status,
                durationMs: result.durationMs,
                cycle,
                ok: result.ok && baselineIssues.length === 0,
                error: baselineIssues.length > 0 ? baselineIssues.join('; ') : result.error,
            };
            allResults.push(normalizedResult);
            console.log(`${normalizedResult.ok ? 'OK' : 'FAIL'} ${endpoint.name} ${normalizedResult.durationMs}ms${normalizedResult.error ? ` ${normalizedResult.error}` : ''}`);
        }

        const crossIssues = validateCrossEndpointConsistency(payloadByEndpoint, { symbol: DEFAULT_SYMBOL });
        if (crossIssues.length > 0) {
            const consistencyResult = {
                name: 'cross-endpoint-consistency',
                ok: false,
                status: 0,
                durationMs: 0,
                error: crossIssues.join('; '),
                cycle,
            };
            allResults.push(consistencyResult);
            console.log(`FAIL cross-endpoint-consistency ${consistencyResult.error}`);
        } else if (Object.keys(payloadByEndpoint).length > 0) {
            const consistencyResult = {
                name: 'cross-endpoint-consistency',
                ok: true,
                status: 200,
                durationMs: 0,
                cycle,
            };
            allResults.push(consistencyResult);
            console.log('OK cross-endpoint-consistency');
        }

        const remainingMs = deadline - Date.now();
        if (remainingMs > 0) {
            await sleep(Math.min(DEFAULT_INTERVAL_MS, remainingMs));
        }
    }

    const summary = createRunSummary(allResults);
    console.log(`Stability summary: ${summary.passed}/${summary.total} passed, avg=${summary.averageDurationMs}ms, max=${summary.maxDurationMs}ms`);

    if (summary.failed > 0) {
        console.error(JSON.stringify(allResults.filter((result) => !result.ok), null, 2));
        process.exitCode = 1;
    }
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
