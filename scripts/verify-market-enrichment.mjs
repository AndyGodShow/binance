import {
    compareMarketUniverses,
    summarizeMarketCoverage,
    validateMarketHealthPayload,
} from './market-enrichment-helpers.mjs';

const BASE_URL = process.env.BASE_URL || 'http://127.0.0.1:3000';
const READY_TIMEOUT_MS = Number.parseInt(process.env.MARKET_READY_TIMEOUT_MS || '360000', 10);
const POLL_INTERVAL_MS = Number.parseInt(process.env.MARKET_READY_POLL_MS || '5000', 10);
const REQUEST_TIMEOUT_MS = Number.parseInt(process.env.MARKET_REQUEST_TIMEOUT_MS || '25000', 10);
const MIN_SYMBOLS = Number.parseInt(process.env.MARKET_MIN_SYMBOLS || '500', 10);
const MIN_ENHANCED_COVERAGE = Number.parseFloat(process.env.MARKET_MIN_ENHANCED_COVERAGE || '0.8');
const REQUIRED_FIELDS = ['symbol', 'lastPrice', 'quoteVolume', 'markPrice', 'fundingRate'];
const REQUIRED_NUMERIC_FIELDS = ['lastPrice', 'quoteVolume', 'markPrice', 'fundingRate'];
const ENHANCED_NUMERIC_FIELDS = ['openInterestValue', 'atr', 'bollingerMid'];
const ENHANCED_FIELDS = ['openInterestValue', 'rsrsMethod', 'atr', 'bollingerMid'];

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function getJson(path) {
    const startedAt = Date.now();
    const response = await fetch(new URL(path, BASE_URL), { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
    const text = await response.text();
    let payload;
    try {
        payload = text ? JSON.parse(text) : null;
    } catch {
        throw new Error(`${path} returned invalid JSON: ${text.slice(0, 120)}`);
    }
    return { response, payload, durationMs: Date.now() - startedAt };
}

async function waitForEnrichedSnapshot() {
    const deadline = Date.now() + READY_TIMEOUT_MS;
    let lastHealth = null;
    while (Date.now() <= deadline) {
        const health = await getJson('/api/health/market');
        lastHealth = health.payload;
        if (health.response.ok && validateMarketHealthPayload(health.payload).length === 0) {
            return { health: health.payload, readyDurationMs: READY_TIMEOUT_MS - Math.max(0, deadline - Date.now()) };
        }
        console.log(`WAIT market health=${health.response.status} reason=${health.payload?.reason ?? 'unknown'} quality=${health.payload?.dataQuality ?? 'unknown'}`);
        await sleep(POLL_INTERVAL_MS);
    }
    throw new Error(`Market enrichment did not become ready within ${READY_TIMEOUT_MS}ms: ${JSON.stringify(lastHealth)}`);
}

async function main() {
    console.log(`Market enrichment verification against ${BASE_URL}`);
    const light = await getJson('/api/market');
    if (!light.response.ok || !Array.isArray(light.payload)) {
        throw new Error(`Initial market request failed with HTTP ${light.response.status}`);
    }
    if (light.payload.length < MIN_SYMBOLS) {
        throw new Error(`Initial market universe has ${light.payload.length} symbols; expected at least ${MIN_SYMBOLS}`);
    }

    const ready = await waitForEnrichedSnapshot();
    const enriched = await getJson('/api/market');
    const cached = await getJson('/api/market');
    if (!enriched.response.ok || !Array.isArray(enriched.payload)) {
        throw new Error(`Enriched market request failed with HTTP ${enriched.response.status}`);
    }
    if (!cached.response.ok || !Array.isArray(cached.payload)) {
        throw new Error(`Cached market request failed with HTTP ${cached.response.status}`);
    }

    const universe = compareMarketUniverses(light.payload, enriched.payload);
    if (universe.missing.length > 0 || universe.unexpected.length > 0
        || universe.lightweightDuplicates.length > 0 || universe.enrichedDuplicates.length > 0) {
        throw new Error(`Market universe changed during enrichment: ${JSON.stringify(universe)}`);
    }
    if (ready.health.symbolCount !== universe.enrichedCount) {
        throw new Error(`Health symbolCount ${ready.health.symbolCount} differs from market ${universe.enrichedCount}`);
    }

    const coverage = summarizeMarketCoverage(enriched.payload, {
        requiredFields: REQUIRED_FIELDS,
        enhancedFields: ENHANCED_FIELDS,
        requiredNumericFields: REQUIRED_NUMERIC_FIELDS,
        enhancedNumericFields: ENHANCED_NUMERIC_FIELDS,
    });
    if (coverage.missingRequired.length > 0) {
        throw new Error(`Required market fields are missing: ${JSON.stringify(coverage.missingRequired)}`);
    }
    if (coverage.invalidNumeric.length > 0) {
        throw new Error(`Market numeric fields are invalid: ${JSON.stringify(coverage.invalidNumeric)}`);
    }
    const insufficient = Object.entries(coverage.enhancedCoverage)
        .filter(([, value]) => value.ratio < MIN_ENHANCED_COVERAGE);
    if (insufficient.length > 0) {
        throw new Error(`Enhanced field coverage below ${MIN_ENHANCED_COVERAGE}: ${JSON.stringify(Object.fromEntries(insufficient))}`);
    }

    console.log(JSON.stringify({
        status: 'passed',
        universe,
        coverage,
        timingsMs: {
            initialMarket: light.durationMs,
            enrichmentReady: ready.readyDurationMs,
            enrichedMarket: enriched.durationMs,
            cachedMarket: cached.durationMs,
        },
        headers: {
            initialQuality: light.response.headers.get('x-data-quality'),
            enrichedQuality: enriched.response.headers.get('x-data-quality'),
            enrichedSource: enriched.response.headers.get('x-data-source'),
            cachedSource: cached.response.headers.get('x-data-source'),
        },
    }, null, 2));
}

main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
});
