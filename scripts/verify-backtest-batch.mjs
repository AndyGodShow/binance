const DEFAULT_BASE_URL = process.env.BASE_URL || 'http://127.0.0.1:3000';
const DEFAULT_SYMBOL_LIMIT = Number.parseInt(process.env.SYMBOL_LIMIT || '30', 10);
const DEFAULT_CONCURRENCY = Number.parseInt(process.env.CONCURRENCY || '3', 10);

const DAY_MS = 24 * 60 * 60 * 1000;
const now = Date.now();
const startTime = now - (30 * DAY_MS);
const endTime = now;
const lookbackStartTime = Math.max(0, startTime - (35 * DAY_MS));
const executionStartTime = startTime + (50 * 60 * 60 * 1000);
const executionChunkMs = 1200 * 60 * 1000;

async function getJson(url) {
    const response = await fetch(url);
    const text = await response.text();

    let json = null;
    try {
        json = JSON.parse(text);
    } catch {
        json = null;
    }

    return {
        ok: response.ok,
        status: response.status,
        json,
        text,
    };
}

function buildUrl(path, query) {
    const params = new URLSearchParams(query);
    return `${DEFAULT_BASE_URL}${path}?${params.toString()}`;
}

async function fetchTopSymbols(limit) {
    const response = await getJson(`${DEFAULT_BASE_URL}/api/market`);
    if (!response.ok || !Array.isArray(response.json)) {
        throw new Error(`Failed to fetch market symbols: HTTP ${response.status}`);
    }

    return response.json
        .filter((ticker) =>
            ticker &&
            typeof ticker.symbol === 'string' &&
            typeof ticker.quoteVolume === 'string' &&
            ticker.symbol.endsWith('USDT')
        )
        .sort((a, b) => parseFloat(b.quoteVolume || '0') - parseFloat(a.quoteVolume || '0'))
        .slice(0, limit)
        .map((ticker) => ticker.symbol);
}

async function verifySymbol(symbol) {
    const failures = [];
    const stages = [
        {
            name: 'signal-1h',
            url: buildUrl('/api/backtest/klines', {
                symbol,
                interval: '1h',
                startTime: String(startTime),
                endTime: String(endTime),
                limit: '1500',
            }),
            requireData: true,
        },
        {
            name: 'mtf-5m',
            url: buildUrl('/api/backtest/klines', {
                symbol,
                interval: '5m',
                startTime: String(lookbackStartTime),
                endTime: String(endTime),
                limit: '1500',
                includeAuxiliary: 'false',
            }),
            requireData: false,
        },
        {
            name: 'mtf-15m',
            url: buildUrl('/api/backtest/klines', {
                symbol,
                interval: '15m',
                startTime: String(lookbackStartTime),
                endTime: String(endTime),
                limit: '1500',
                includeAuxiliary: 'false',
            }),
            requireData: false,
        },
        {
            name: 'execution-1m-1',
            url: buildUrl('/api/backtest/klines', {
                symbol,
                interval: '1m',
                startTime: String(executionStartTime),
                endTime: String(Math.min(endTime, executionStartTime + executionChunkMs)),
                limit: '1500',
                includeAuxiliary: 'false',
            }),
            requireData: false,
        },
        {
            name: 'execution-1m-2',
            url: buildUrl('/api/backtest/klines', {
                symbol,
                interval: '1m',
                startTime: String(executionStartTime + executionChunkMs + 1),
                endTime: String(Math.min(endTime, executionStartTime + (executionChunkMs * 2) + 1)),
                limit: '1500',
                includeAuxiliary: 'false',
            }),
            requireData: false,
        },
    ];

    for (const stage of stages) {
        const response = await getJson(stage.url);
        const count = Array.isArray(response.json?.data) ? response.json.data.length : 0;

        if (!response.ok) {
            failures.push({
                symbol,
                stage: stage.name,
                status: response.status,
                body: response.text.slice(0, 200),
            });
            break;
        }

        if (stage.requireData && count === 0) {
            failures.push({
                symbol,
                stage: stage.name,
                status: response.status,
                body: 'Empty dataset',
            });
            break;
        }
    }

    return failures;
}

async function runWithConcurrency(items, concurrency, worker) {
    const results = new Array(items.length);
    let nextIndex = 0;

    async function runWorker() {
        while (nextIndex < items.length) {
            const currentIndex = nextIndex;
            nextIndex += 1;
            results[currentIndex] = await worker(items[currentIndex], currentIndex);
        }
    }

    await Promise.all(
        Array.from({ length: Math.min(concurrency, items.length) }, () => runWorker())
    );

    return results;
}

async function main() {
    const symbols = await fetchTopSymbols(DEFAULT_SYMBOL_LIMIT);
    console.log(`Verifying ${symbols.length} symbols against ${DEFAULT_BASE_URL} with concurrency=${DEFAULT_CONCURRENCY}`);

    const results = await runWithConcurrency(symbols, DEFAULT_CONCURRENCY, async (symbol, index) => {
        const failures = await verifySymbol(symbol);
        console.log(`${index + 1}/${symbols.length} ${symbol} ${failures.length > 0 ? 'FAIL' : 'OK'}`);
        return failures;
    });

    const failures = results.flat();
    if (failures.length > 0) {
        console.error(JSON.stringify(failures, null, 2));
        process.exitCode = 1;
        return;
    }

    console.log('All sampled symbols passed batch-style verification.');
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
