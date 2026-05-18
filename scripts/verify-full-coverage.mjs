const baseUrl = process.env.BASE_URL || 'http://127.0.0.1:3000';
const batchSize = Number.parseInt(process.env.COVERAGE_BATCH_SIZE || '3', 10);
const maxBatches = Number.parseInt(process.env.COVERAGE_MAX_BATCHES || '0', 10);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function getJson(path, timeoutMs = 45000, attempts = 3) {
    let lastError;
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        try {
            const response = await fetch(`${baseUrl}${path}`, { signal: controller.signal });
            const text = await response.text();
            let json = null;
            try {
                json = text ? JSON.parse(text) : null;
            } catch {
                json = { parseError: text.slice(0, 160) };
            }

            if (response.ok) {
                return { ok: true, status: response.status, json };
            }
            lastError = new Error(`HTTP ${response.status}: ${text.slice(0, 160)}`);
        } catch (error) {
            lastError = error;
        } finally {
            clearTimeout(timer);
        }

        await sleep(1000 * attempt);
    }

    return { ok: false, error: String(lastError) };
}

function validSymbols(tickers) {
    return [...tickers]
        .filter((ticker) => /^[A-Z0-9]{1,20}USDT$/.test(ticker.symbol))
        .sort((left, right) => Number(right.quoteVolume) - Number(left.quoteVolume))
        .map((ticker) => ticker.symbol);
}

function chunk(items, size) {
    const chunks = [];
    for (let index = 0; index < items.length; index += size) {
        chunks.push(items.slice(index, index + size));
    }
    return chunks;
}

const light = await getJson('/api/market/light', 30000, 5);
if (!light.ok || !Array.isArray(light.json)) {
    throw new Error('market-light failed');
}

const symbols = validSymbols(light.json);
const allChunks = chunk(symbols, Math.max(1, batchSize));
const chunks = maxBatches > 0 ? allChunks.slice(0, maxBatches) : allChunks;
const marketCoverage = new Map();
const oiCoverage = new Map();
let marketHttpFailures = 0;
let oiHttpFailures = 0;

console.log(`symbols=${symbols.length}, batches=${chunks.length}/${allChunks.length}, batchSize=${batchSize}`);

for (let index = 0; index < chunks.length; index += 1) {
    const symbolsBatch = chunks[index];
    const query = encodeURIComponent(symbolsBatch.join(','));
    const market = await getJson(`/api/market/multiframe?symbols=${query}`, 45000, 3);

    if (market.ok && market.json && typeof market.json === 'object') {
        for (const symbol of symbolsBatch) {
            const row = market.json[symbol];
            if (
                row &&
                Number.isFinite(row.o15m) &&
                Number.isFinite(row.o1h) &&
                Number.isFinite(row.o4h)
            ) {
                marketCoverage.set(symbol, row);
            }
        }
    } else {
        marketHttpFailures += 1;
    }

    await sleep(350);

    const oi = await getJson(`/api/oi/multiframe?symbols=${query}`, 45000, 3);
    if (oi.ok && oi.json && typeof oi.json === 'object') {
        for (const symbol of symbolsBatch) {
            const row = oi.json[symbol];
            if (row && Number.isFinite(row.currentValue)) {
                oiCoverage.set(symbol, row);
            }
        }
    } else {
        oiHttpFailures += 1;
    }

    if ((index + 1) % 20 === 0 || index === chunks.length - 1) {
        console.log(
            `batch ${index + 1}/${chunks.length} market=${marketCoverage.size}/${symbols.length} ` +
            `oi=${oiCoverage.size}/${symbols.length} marketHttpFailures=${marketHttpFailures} ` +
            `oiHttpFailures=${oiHttpFailures}`
        );
    }

    await sleep(800);
}

const attemptedSymbols = chunks.flat();
const summary = {
    totalSymbols: symbols.length,
    attemptedSymbols: attemptedSymbols.length,
    batchSize,
    marketMultiframe: {
        covered: marketCoverage.size,
        missingAttempted: attemptedSymbols.filter((symbol) => !marketCoverage.has(symbol)).length,
        httpFailures: marketHttpFailures,
        sampleMissing: attemptedSymbols.filter((symbol) => !marketCoverage.has(symbol)).slice(0, 80),
    },
    oiMultiframe: {
        covered: oiCoverage.size,
        missingAttempted: attemptedSymbols.filter((symbol) => !oiCoverage.has(symbol)).length,
        httpFailures: oiHttpFailures,
        sampleMissing: attemptedSymbols.filter((symbol) => !oiCoverage.has(symbol)).slice(0, 80),
    },
};

console.log(`FINAL_SUMMARY ${JSON.stringify(summary)}`);
