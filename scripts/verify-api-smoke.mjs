import {
    buildApiSmokeEndpoints,
    createRunSummary,
    selectEndpoints,
    validatePayload,
} from './verification-helpers.mjs';

const DEFAULT_BASE_URL = process.env.BASE_URL || 'http://127.0.0.1:3000';
const DEFAULT_TIMEOUT_MS = Number.parseInt(process.env.API_SMOKE_TIMEOUT_MS || '25000', 10);
const DEFAULT_SYMBOL = process.env.API_SMOKE_SYMBOL || process.env.SYMBOL || 'BTCUSDT';
const DEFAULT_KEYWORD = process.env.API_SMOKE_KEYWORD || 'PEPE';

function parseEndpointFilter() {
    const raw = process.env.API_SMOKE_ENDPOINTS;
    if (!raw) {
        return [];
    }

    return raw
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean);
}

async function fetchJsonWithTimeout(url, timeoutMs) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
        const response = await fetch(url, { signal: controller.signal });
        const text = await response.text();
        let json = null;

        try {
            json = text ? JSON.parse(text) : null;
        } catch {
            throw new Error(`Invalid JSON body: ${text.slice(0, 160)}`);
        }

        return {
            ok: response.ok,
            status: response.status,
            json,
            text,
        };
    } finally {
        clearTimeout(timeout);
    }
}

async function verifyEndpoint(baseUrl, endpoint, timeoutMs) {
    const startedAt = Date.now();
    const url = new URL(endpoint.path, baseUrl).toString();

    try {
        const response = await fetchJsonWithTimeout(url, timeoutMs);
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
        buildApiSmokeEndpoints({ symbol: DEFAULT_SYMBOL, keyword: DEFAULT_KEYWORD }),
        parseEndpointFilter()
    );

    if (endpoints.length === 0) {
        throw new Error('No API smoke endpoints selected');
    }

    console.log(`API smoke verifying ${endpoints.length} endpoints against ${DEFAULT_BASE_URL}`);

    const results = [];
    for (const endpoint of endpoints) {
        const result = await verifyEndpoint(DEFAULT_BASE_URL, endpoint, DEFAULT_TIMEOUT_MS);
        results.push(result);
        console.log(`${result.ok ? 'OK' : 'FAIL'} ${result.name} ${result.durationMs}ms${result.error ? ` ${result.error}` : ''}`);
    }

    const summary = createRunSummary(results);
    console.log(`API smoke summary: ${summary.passed}/${summary.total} passed, avg=${summary.averageDurationMs}ms, max=${summary.maxDurationMs}ms`);

    if (summary.failed > 0) {
        console.error(JSON.stringify(results.filter((result) => !result.ok), null, 2));
        process.exitCode = 1;
    }
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
