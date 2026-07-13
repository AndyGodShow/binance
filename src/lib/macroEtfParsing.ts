import type { BtcEtfFlowEntry, BtcEtfFlowSnapshot } from './macroTypes.ts';

interface BitboBtcEtfFlowApiPayload {
    data?: unknown;
}

const ETF_COLUMN_SYMBOLS = ['IBIT', 'FBTC', 'BITB', 'ARKB', 'BTCO', 'EZBC', 'BRRR', 'HODL', 'BTCW', 'GBTC', 'BTC', 'DEFI'];

function sanitizeFlowNumber(raw: string): number {
    const trimmed = raw.trim();
    if (!trimmed || trimmed === '-') {
        return 0;
    }

    const normalized = trimmed.replace(/,/g, '');
    const negativeWrapped = normalized.startsWith('(') && normalized.endsWith(')');
    const numeric = Number.parseFloat(normalized.replace(/[()]/g, ''));
    if (!Number.isFinite(numeric)) {
        return 0;
    }

    return negativeWrapped ? -numeric : numeric;
}

function parseFlowDate(raw: string): string | null {
    const match = raw.match(/^(\d{1,2})\s+([A-Za-z]{3})\s+(\d{4})$/);
    if (!match) {
        return null;
    }

    const [, day, month, year] = match;
    const parsed = Date.parse(`${month} ${day}, ${year} 00:00:00 UTC`);
    if (!Number.isFinite(parsed)) {
        return null;
    }

    return new Date(parsed).toISOString().slice(0, 10);
}

export function parseBtcEtfFlowText(text: string): BtcEtfFlowSnapshot {
    const lines = text
        .split(/\r?\n/)
        .map((line) => line.replace(/\s+/g, ' ').trim())
        .filter(Boolean);

    const dayRows: Array<{ date: string; flows: BtcEtfFlowEntry[]; total: number }> = [];

    for (let index = 0; index < lines.length; index += 1) {
        const isoDate = parseFlowDate(lines[index]);
        if (!isoDate) {
            continue;
        }

        const values = lines.slice(index + 1, index + 1 + ETF_COLUMN_SYMBOLS.length + 1);
        if (values.length < ETF_COLUMN_SYMBOLS.length + 1) {
            continue;
        }

        const flows = ETF_COLUMN_SYMBOLS.map((symbol, offset) => ({
            symbol,
            netInflowUsdMillion: sanitizeFlowNumber(values[offset]),
        })).filter((entry) => entry.netInflowUsdMillion !== 0);

        dayRows.push({
            date: isoDate,
            flows: flows.sort((left, right) => right.netInflowUsdMillion - left.netInflowUsdMillion),
            total: sanitizeFlowNumber(values[ETF_COLUMN_SYMBOLS.length]),
        });
    }

    if (dayRows.length === 0) {
        throw new Error('Unable to parse BTC ETF flow data');
    }

    const latest = dayRows[dayRows.length - 1];
    const rolling = dayRows.slice(-7);

    return {
        date: latest.date,
        totalNetInflowUsdMillion: latest.total,
        flows: latest.flows,
        rolling7dNetInflowUsdMillion: rolling.reduce((sum, row) => sum + row.total, 0),
        rolling7dPositiveDays: rolling.filter((row) => row.total > 0).length,
        rolling7dNegativeDays: rolling.filter((row) => row.total < 0).length,
    };
}

function decodeHtmlEntities(value: string): string {
    return value
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&#39;/g, "'")
        .replace(/&quot;/g, '"');
}

export function parseBitboBtcEtfFlowHtml(html: string): BtcEtfFlowSnapshot {
    const tableMatch = html.match(/<table class="stats-table larger-table">([\s\S]*?)<\/table>/i);
    if (!tableMatch) {
        throw new Error('Unable to locate Bitbo ETF flow table');
    }

    const rowMatches = [...tableMatch[1].matchAll(/<tr>([\s\S]*?)<\/tr>/gi)];
    if (rowMatches.length < 2) {
        throw new Error('Bitbo ETF flow table has no data rows');
    }

    const extractCells = (rowHtml: string) =>
        [...rowHtml.matchAll(/<span>([\s\S]*?)<\/span>/gi)].map((match) =>
            decodeHtmlEntities(match[1]).replace(/\s+/g, ' ').trim()
        );

    const headers = extractCells(rowMatches[0][1]);
    const dateIndex = headers.findIndex((header) => header === 'Date');
    const totalIndex = headers.findIndex((header) => header === 'Totals');
    if (dateIndex !== 0 || totalIndex === -1) {
        throw new Error('Bitbo ETF flow headers are missing expected columns');
    }

    const rows = rowMatches
        .slice(1)
        .map((match) => extractCells(match[1]))
        .filter((cells) => cells.length === headers.length)
        .map((cells) => {
            const date = Date.parse(`${cells[0]} UTC`);
            return {
                cells,
                date: Number.isFinite(date) ? new Date(date).toISOString().slice(0, 10) : null,
            };
        })
        .filter((row): row is { cells: string[]; date: string } => row.date !== null);

    if (rows.length === 0) {
        throw new Error('Bitbo ETF flow rows could not be parsed');
    }

    const rowsByNewestDate = [...rows].sort((left, right) => right.date.localeCompare(left.date));
    const latest = rowsByNewestDate[0];
    const latestFlows = headers
        .slice(1, totalIndex)
        .map((symbol, index) => ({
            symbol,
            netInflowUsdMillion: sanitizeFlowNumber(latest.cells[index + 1]),
        }))
        .filter((entry) => entry.netInflowUsdMillion !== 0)
        .sort((left, right) => right.netInflowUsdMillion - left.netInflowUsdMillion);

    const rolling = rowsByNewestDate.slice(0, 7);

    return {
        date: latest.date,
        totalNetInflowUsdMillion: sanitizeFlowNumber(latest.cells[totalIndex]),
        flows: latestFlows,
        rolling7dNetInflowUsdMillion: rolling.reduce((sum, row) => sum + sanitizeFlowNumber(row.cells[totalIndex]), 0),
        rolling7dPositiveDays: rolling.filter((row) => sanitizeFlowNumber(row.cells[totalIndex]) > 0).length,
        rolling7dNegativeDays: rolling.filter((row) => sanitizeFlowNumber(row.cells[totalIndex]) < 0).length,
    };
}

function parseBitboApiNumber(value: unknown): number {
    if (typeof value === 'number') {
        return Number.isFinite(value) ? value : 0;
    }
    if (typeof value !== 'string') {
        return 0;
    }

    const parsed = Number.parseFloat(value.replace(/,/g, ''));
    return Number.isFinite(parsed) ? parsed : 0;
}

export function parseBitboBtcEtfFlowApiResponse(payload: BitboBtcEtfFlowApiPayload): BtcEtfFlowSnapshot {
    const rows = Array.isArray(payload.data)
        ? payload.data
            .filter((row): row is unknown[] => Array.isArray(row))
            .map((row) => {
                const dateValue = typeof row[0] === 'string' ? row[0] : '';
                const date = /^\d{4}-\d{2}-\d{2}$/.test(dateValue) ? dateValue : null;
                const rawDailyEtfChangeBtc = parseBitboApiNumber(row[2]);
                const btcPrice = parseBitboApiNumber(row[5]);
                return {
                    date,
                    totalNetInflowUsdMillion: (rawDailyEtfChangeBtc * btcPrice) / 1_000_000,
                    btcPrice,
                };
            })
            .filter((row): row is { date: string; totalNetInflowUsdMillion: number; btcPrice: number } =>
                row.date !== null && Number.isFinite(row.totalNetInflowUsdMillion)
            )
            .sort((left, right) => right.date.localeCompare(left.date))
        : [];

    if (rows.length === 0) {
        throw new Error('Bitbo ETF flow API returned no parseable rows');
    }

    const latest = rows[0];
    const rolling = rows.slice(0, 7);

    return {
        date: latest.date,
        totalNetInflowUsdMillion: latest.totalNetInflowUsdMillion,
        btcPrice: latest.btcPrice || undefined,
        flows: [],
        rolling7dNetInflowUsdMillion: rolling.reduce((sum, row) => sum + row.totalNetInflowUsdMillion, 0),
        rolling7dPositiveDays: rolling.filter((row) => row.totalNetInflowUsdMillion > 0).length,
        rolling7dNegativeDays: rolling.filter((row) => row.totalNetInflowUsdMillion < 0).length,
    };
}
