interface MultiframeKlineArchive {
    klines?: Array<{
        open: string;
    }>;
}

type MultiframeKlineRow = Array<number | string>;

export type MultiframeData = Record<string, { o15m: number; o1h: number; o4h: number }>;

interface FetchRequestedMultiframeDataOptions {
    concurrency: number;
    perSymbolTimeoutMs?: number;
    loadArchive: (symbol: string) => MultiframeKlineArchive | null | undefined;
    fetchKlines: (symbol: string) => Promise<unknown>;
}

function buildFromArchive(symbol: string, archive: MultiframeKlineArchive | null | undefined) {
    const klines = archive?.klines ?? [];
    if (klines.length === 0) {
        return null;
    }

    const currentIdx = klines.length - 1;
    const idx1h = Math.max(0, currentIdx - 4);
    const idx4h = Math.max(0, currentIdx - 16);

    return {
        symbol,
        o15m: Number.parseFloat(klines[currentIdx].open),
        o1h: Number.parseFloat(klines[idx1h].open),
        o4h: Number.parseFloat(klines[idx4h].open),
    };
}

function buildFromKlines(symbol: string, klines: unknown) {
    if (!Array.isArray(klines) || klines.length === 0) {
        return null;
    }

    const currentIdx = klines.length - 1;
    const idx1h = Math.max(0, currentIdx - 4);
    const idx4h = Math.max(0, currentIdx - 16);
    const current = klines[currentIdx] as MultiframeKlineRow;
    const oneHour = klines[idx1h] as MultiframeKlineRow;
    const fourHour = klines[idx4h] as MultiframeKlineRow;

    return {
        symbol,
        o15m: Number.parseFloat(String(current[1])),
        o1h: Number.parseFloat(String(oneHour[1])),
        o4h: Number.parseFloat(String(fourHour[1])),
    };
}

function isUsableResult(result: { o15m: number; o1h: number; o4h: number }) {
    return Number.isFinite(result.o15m) && result.o15m !== 0 &&
        Number.isFinite(result.o1h) &&
        Number.isFinite(result.o4h);
}

async function fetchOneSymbol(
    symbol: string,
    options: FetchRequestedMultiframeDataOptions,
) {
    const archiveResult = buildFromArchive(symbol, options.loadArchive(symbol));
    if (archiveResult && isUsableResult(archiveResult)) {
        return archiveResult;
    }

    try {
        const klines = await withOptionalTimeout(
            options.fetchKlines(symbol),
            options.perSymbolTimeoutMs,
        );
        const klineResult = buildFromKlines(symbol, klines);
        if (klineResult && isUsableResult(klineResult)) {
            return klineResult;
        }
    } catch {
        // Fall through to archive fallback below.
    }

    return archiveResult && isUsableResult(archiveResult) ? archiveResult : null;
}

async function withOptionalTimeout<T>(
    promise: Promise<T>,
    timeoutMs: number | undefined,
): Promise<T> {
    if (!timeoutMs || timeoutMs <= 0) {
        return promise;
    }

    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    try {
        return await Promise.race([
            promise,
            new Promise<T>((_, reject) => {
                timeoutId = setTimeout(() => {
                    reject(new Error('multiframe symbol timeout'));
                }, timeoutMs);
            }),
        ]);
    } finally {
        if (timeoutId) {
            clearTimeout(timeoutId);
        }
    }
}

export async function fetchRequestedMultiframeData(
    requestedSymbols: string[],
    options: FetchRequestedMultiframeDataOptions,
): Promise<MultiframeData> {
    const resultData: MultiframeData = {};
    const uniqueSymbols = Array.from(new Set(
        requestedSymbols
            .map((symbol) => symbol.trim().toUpperCase())
            .filter((symbol) => symbol.endsWith('USDT'))
    ));
    const concurrency = Math.max(1, Math.min(options.concurrency, uniqueSymbols.length || 1));

    for (let index = 0; index < uniqueSymbols.length; index += concurrency) {
        const chunk = uniqueSymbols.slice(index, index + concurrency);
        const results = await Promise.all(chunk.map((symbol) => fetchOneSymbol(symbol, options)));

        results.forEach((result) => {
            if (result) {
                resultData[result.symbol] = {
                    o15m: result.o15m,
                    o1h: result.o1h,
                    o4h: result.o4h,
                };
            }
        });
    }

    return resultData;
}
