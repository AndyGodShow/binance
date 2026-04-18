import {
    buildApiSmokeEndpoints,
    createRunSummary,
    selectEndpoints,
    validatePayload,
} from './verification-helpers.mjs';

const DEFAULT_BASE_URL = process.env.BASE_URL || 'http://127.0.0.1:3000';
const DEFAULT_SYMBOL = process.env.STABILITY_SYMBOL || process.env.SYMBOL || 'BTCUSDT';
const DEFAULT_DURATION_MS = Number.parseInt(process.env.STABILITY_DURATION_MS || String(30 * 60 * 1000), 10);
const DEFAULT_INTERVAL_MS = Number.parseInt(process.env.STABILITY_INTERVAL_MS || String(60 * 1000), 10);
const DEFAULT_TIMEOUT_MS = Number.parseInt(process.env.STABILITY_TIMEOUT_MS || '25000', 10);
const DEFAULT_ENDPOINTS = ['market-light', 'market-multiframe', 'oi-multiframe', 'longshort', 'backtest-klines'];

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
    let cycle = 0;

    if (endpoints.length === 0) {
        throw new Error('No stability endpoints selected');
    }

    console.log(`Stability verifying ${endpoints.length} endpoints against ${DEFAULT_BASE_URL}`);
    console.log(`Duration=${DEFAULT_DURATION_MS}ms interval=${DEFAULT_INTERVAL_MS}ms timeout=${DEFAULT_TIMEOUT_MS}ms`);

    while (Date.now() < deadline) {
        cycle += 1;
        console.log(`Cycle ${cycle}`);

        for (const endpoint of endpoints) {
            const result = await verifyEndpoint(DEFAULT_BASE_URL, endpoint);
            allResults.push({ ...result, cycle });
            console.log(`${result.ok ? 'OK' : 'FAIL'} ${endpoint.name} ${result.durationMs}ms${result.error ? ` ${result.error}` : ''}`);
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
