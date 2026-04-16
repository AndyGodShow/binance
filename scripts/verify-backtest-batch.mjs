const DEFAULT_BASE_URL = process.env.BASE_URL || 'http://127.0.0.1:3000';
const DEFAULT_SYMBOL_LIMIT = Number.parseInt(process.env.SYMBOL_LIMIT || '30', 10);
const DEFAULT_CONCURRENCY = Number.parseInt(process.env.CONCURRENCY || '3', 10);

const DAY_MS = 24 * 60 * 60 * 1000;
const BACKTEST_VALIDATION_LIMIT = 1500;
const HISTORICAL_LOOKBACK_BUFFER_MS = 35 * DAY_MS;
const EXECUTION_VALIDATION_OFFSET_MS = 50 * 60 * 60 * 1000;
const EXECUTION_VALIDATION_CHUNK_MS = 1200 * 60 * 1000;
const now = Date.now();
const startTime = now - (30 * DAY_MS);
const endTime = now;
const lookbackStartTime = Math.max(0, startTime - HISTORICAL_LOOKBACK_BUFFER_MS);

function isBacktestSymbolCandidate(symbol) {
    return /^[A-Z0-9]+USDT$/.test(symbol);
}

function intervalToMs(interval) {
    const match = interval.match(/^(\d+)(m|h|d|w|M)$/);
    if (!match) {
        return 0;
    }

    const value = Number.parseInt(match[1], 10);
    const unit = match[2];

    switch (unit) {
        case 'm':
            return value * 60 * 1000;
        case 'h':
            return value * 60 * 60 * 1000;
        case 'd':
            return value * 24 * 60 * 60 * 1000;
        case 'w':
            return value * 7 * 24 * 60 * 60 * 1000;
        case 'M':
            return value * 30 * 24 * 60 * 60 * 1000;
        default:
            return 0;
    }
}

function estimateStageMinCount(start, end, interval, fallbackMinimum) {
    const intervalMs = intervalToMs(interval);
    if (!intervalMs) {
        return fallbackMinimum;
    }

    const estimatedBars = Math.max(1, Math.floor((end - start) / intervalMs));
    return Math.max(fallbackMinimum, Math.min(BACKTEST_VALIDATION_LIMIT, Math.floor(estimatedBars * 0.7)));
}

function buildSignalValidationStages(signalInterval) {
    const intervalMs = intervalToMs(signalInterval);
    if (!intervalMs) {
        return [];
    }

    const fullRangeBars = Math.max(1, Math.floor((endTime - startTime) / intervalMs));
    if (fullRangeBars <= BACKTEST_VALIDATION_LIMIT) {
        return [{
            name: `signal-${signalInterval}`,
            url: buildUrl('/api/backtest/klines', {
                symbol: '__SYMBOL__',
                interval: signalInterval,
                startTime: String(startTime),
                endTime: String(endTime),
                limit: String(BACKTEST_VALIDATION_LIMIT),
                includeAuxiliary: 'false',
            }),
            minCount: estimateStageMinCount(startTime, endTime, signalInterval, 24),
        }];
    }

    const firstStageEnd = Math.min(endTime, startTime + (intervalMs * (BACKTEST_VALIDATION_LIMIT - 1)));
    const lastStageStart = Math.max(startTime, endTime - (intervalMs * (BACKTEST_VALIDATION_LIMIT - 1)));

    return [
        {
            name: `signal-${signalInterval}-head`,
            url: buildUrl('/api/backtest/klines', {
                symbol: '__SYMBOL__',
                interval: signalInterval,
                startTime: String(startTime),
                endTime: String(firstStageEnd),
                limit: String(BACKTEST_VALIDATION_LIMIT),
                includeAuxiliary: 'false',
            }),
            minCount: Math.max(240, Math.floor(BACKTEST_VALIDATION_LIMIT * 0.8)),
        },
        {
            name: `signal-${signalInterval}-tail`,
            url: buildUrl('/api/backtest/klines', {
                symbol: '__SYMBOL__',
                interval: signalInterval,
                startTime: String(lastStageStart),
                endTime: String(endTime),
                limit: String(BACKTEST_VALIDATION_LIMIT),
                includeAuxiliary: 'false',
            }),
            minCount: Math.max(240, Math.floor(BACKTEST_VALIDATION_LIMIT * 0.8)),
        },
    ];
}

function buildExecutionValidationStages(executionInterval) {
    const firstStageStart = Math.min(endTime, startTime + EXECUTION_VALIDATION_OFFSET_MS);
    const firstStageEnd = Math.min(endTime, firstStageStart + EXECUTION_VALIDATION_CHUNK_MS);
    const stages = [{
        name: `execution-${executionInterval}-1`,
        url: buildUrl('/api/backtest/klines', {
            symbol: '__SYMBOL__',
            interval: executionInterval,
            startTime: String(firstStageStart),
            endTime: String(firstStageEnd),
            limit: String(BACKTEST_VALIDATION_LIMIT),
            includeAuxiliary: 'false',
        }),
        minCount: estimateStageMinCount(firstStageStart, firstStageEnd, executionInterval, 60),
    }];

    const secondStageStart = firstStageEnd + 1;
    if (secondStageStart < endTime) {
        const secondStageEnd = Math.min(endTime, secondStageStart + EXECUTION_VALIDATION_CHUNK_MS);
        stages.push({
            name: `execution-${executionInterval}-2`,
            url: buildUrl('/api/backtest/klines', {
                symbol: '__SYMBOL__',
                interval: executionInterval,
                startTime: String(secondStageStart),
                endTime: String(secondStageEnd),
                limit: String(BACKTEST_VALIDATION_LIMIT),
                includeAuxiliary: 'false',
            }),
            minCount: estimateStageMinCount(secondStageStart, secondStageEnd, executionInterval, 60),
        });
    }

    return stages;
}

function buildValidationStages() {
    return [
        ...buildSignalValidationStages('1h'),
        {
            name: 'mtf-5m',
            url: buildUrl('/api/backtest/klines', {
                symbol: '__SYMBOL__',
                interval: '5m',
                startTime: String(lookbackStartTime),
                endTime: String(endTime),
                limit: String(BACKTEST_VALIDATION_LIMIT),
                includeAuxiliary: 'false',
            }),
            minCount: 120,
        },
        {
            name: 'mtf-15m',
            url: buildUrl('/api/backtest/klines', {
                symbol: '__SYMBOL__',
                interval: '15m',
                startTime: String(lookbackStartTime),
                endTime: String(endTime),
                limit: String(BACKTEST_VALIDATION_LIMIT),
                includeAuxiliary: 'false',
            }),
            minCount: 8,
        },
        {
            name: 'mtf-4h',
            url: buildUrl('/api/backtest/klines', {
                symbol: '__SYMBOL__',
                interval: '4h',
                startTime: String(lookbackStartTime),
                endTime: String(endTime),
                limit: String(BACKTEST_VALIDATION_LIMIT),
                includeAuxiliary: 'false',
            }),
            minCount: 8,
        },
        {
            name: 'mtf-1d',
            url: buildUrl('/api/backtest/klines', {
                symbol: '__SYMBOL__',
                interval: '1d',
                startTime: String(lookbackStartTime),
                endTime: String(endTime),
                limit: String(BACKTEST_VALIDATION_LIMIT),
                includeAuxiliary: 'false',
            }),
            minCount: 21,
        },
        ...buildExecutionValidationStages('1m'),
    ];
}

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

function isRetryableStatus(status) {
    return status === 408 || status === 429 || status >= 500;
}

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
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
        .map((ticker) => ticker.symbol)
        .filter(isBacktestSymbolCandidate);
}

async function verifySymbol(symbol) {
    const failures = [];
    const stages = buildValidationStages();

    for (const stage of stages) {
        let response = null;

        for (let attempt = 0; attempt < 3; attempt += 1) {
            response = await getJson(stage.url.replace('__SYMBOL__', symbol));
            if (response.ok || !isRetryableStatus(response.status) || attempt === 2) {
                break;
            }

            await sleep(250 * (attempt + 1));
        }

        const count = Array.isArray(response?.json?.data) ? response.json.data.length : 0;

        if (!response?.ok) {
            failures.push({
                symbol,
                stage: stage.name,
                status: response?.status ?? 0,
                body: response?.text?.slice(0, 200) ?? 'Request failed',
            });
            break;
        }

        if (count < stage.minCount) {
            failures.push({
                symbol,
                stage: stage.name,
                status: response.status,
                body: `Insufficient dataset (${count} < ${stage.minCount})`,
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
        console.log(`${index + 1}/${symbols.length} ${symbol} ${failures.length > 0 ? 'SKIP' : 'OK'}`);
        return failures;
    });

    const skipped = results.flat();
    const passedCount = results.filter((failures) => failures.length === 0).length;

    if (passedCount === 0) {
        console.error(JSON.stringify(skipped, null, 2));
        process.exitCode = 1;
        return;
    }

    if (skipped.length > 0) {
        console.log(`Skipped ${skipped.length} symbols during preflight validation.`);
        console.log(JSON.stringify(skipped, null, 2));
    }

    console.log(`Batch-style verification passed for ${passedCount}/${symbols.length} sampled symbols.`);
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
