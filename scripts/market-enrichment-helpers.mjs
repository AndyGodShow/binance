function hasValue(value) {
    return value !== undefined && value !== null && value !== '';
}

function symbolsOf(rows) {
    return rows.map((row) => row?.symbol).filter((symbol) => typeof symbol === 'string');
}

function duplicateSymbols(rows) {
    const seen = new Set();
    const duplicates = new Set();
    for (const symbol of symbolsOf(rows)) {
        if (seen.has(symbol)) duplicates.add(symbol);
        seen.add(symbol);
    }
    return [...duplicates].sort();
}

function sortedSymbols(rows) {
    return [...new Set(symbolsOf(rows))].sort();
}

export function compareMarketUniverses(lightweightRows, enrichedRows) {
    const lightweightSymbols = sortedSymbols(lightweightRows);
    const enrichedSymbols = sortedSymbols(enrichedRows);
    const lightweightSet = new Set(lightweightSymbols);
    const enrichedSet = new Set(enrichedSymbols);

    return {
        lightweightCount: lightweightSymbols.length,
        enrichedCount: enrichedSymbols.length,
        missing: lightweightSymbols.filter((symbol) => !enrichedSet.has(symbol)),
        unexpected: enrichedSymbols.filter((symbol) => !lightweightSet.has(symbol)),
        lightweightDuplicates: duplicateSymbols(lightweightRows),
        enrichedDuplicates: duplicateSymbols(enrichedRows),
    };
}

export function summarizeMarketCoverage(rows, options) {
    const missingRequired = [];
    for (const field of options.requiredFields) {
        const missingSymbols = rows
            .filter((row) => !hasValue(row?.[field]))
            .map((row) => row?.symbol ?? '<unknown>');
        if (missingSymbols.length > 0) {
            missingRequired.push({ field, count: missingSymbols.length, sampleSymbols: missingSymbols.slice(0, 10) });
        }
    }

    const enhancedCoverage = Object.fromEntries(options.enhancedFields.map((field) => {
        const count = rows.filter((row) => hasValue(row?.[field])).length;
        return [field, { count, ratio: rows.length > 0 ? count / rows.length : 0 }];
    }));

    const invalidNumeric = [];
    for (const field of options.requiredNumericFields ?? []) {
        const invalidSymbols = rows
            .filter((row) => !Number.isFinite(Number(row?.[field])))
            .map((row) => row?.symbol ?? '<unknown>');
        if (invalidSymbols.length > 0) {
            invalidNumeric.push({ field, count: invalidSymbols.length, sampleSymbols: invalidSymbols.slice(0, 10) });
        }
    }
    for (const field of options.enhancedNumericFields ?? []) {
        const invalidSymbols = rows
            .filter((row) => hasValue(row?.[field]) && !Number.isFinite(Number(row[field])))
            .map((row) => row?.symbol ?? '<unknown>');
        if (invalidSymbols.length > 0) {
            invalidNumeric.push({ field, count: invalidSymbols.length, sampleSymbols: invalidSymbols.slice(0, 10) });
        }
    }

    return { rowCount: rows.length, missingRequired, invalidNumeric, enhancedCoverage };
}

export function validateMarketHealthPayload(payload) {
    const issues = [];
    if (!payload || payload.service !== 'market') {
        return ['market health payload is malformed'];
    }
    if (payload.ready !== true) issues.push('market health is not ready');
    if (payload.dataQuality !== 'enriched') issues.push(`market health dataQuality is ${payload.dataQuality ?? 'missing'}`);
    if (payload.buildState !== 'ready') issues.push(`market health buildState is ${payload.buildState ?? 'missing'}`);
    if (payload.serving !== true) issues.push('market health is not serving data');
    if (!Number.isInteger(payload.symbolCount) || payload.symbolCount <= 0) issues.push('market health symbolCount is invalid');
    if (!Number.isFinite(payload.snapshotAgeSeconds) || payload.snapshotAgeSeconds < 0) issues.push('market health snapshotAgeSeconds is invalid');
    return issues;
}
