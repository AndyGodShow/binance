import assert from 'node:assert/strict';
import test from 'node:test';

import path from 'node:path';

import {
    buildPrimaryArchivePath,
    getArchiveReportDir,
    getArchiveReadRoots,
    getArchiveWriteRoot,
    resolveReadableArchivePath,
} from './archiveRoots.ts';

test('getArchiveWriteRoot defaults to market-archive-v2 under data', () => {
    const original = process.env.MARKET_ARCHIVE_ROOT;
    delete process.env.MARKET_ARCHIVE_ROOT;

    try {
        assert.equal(
            getArchiveWriteRoot(),
            path.join(process.cwd(), 'data', 'market-archive-v2'),
        );
    } finally {
        if (original === undefined) {
            delete process.env.MARKET_ARCHIVE_ROOT;
        } else {
            process.env.MARKET_ARCHIVE_ROOT = original;
        }
    }
});

test('getArchiveReadRoots returns primary root first and legacy historical root second', () => {
    const original = process.env.MARKET_ARCHIVE_ROOT;
    process.env.MARKET_ARCHIVE_ROOT = '/tmp/custom-archive-root';

    try {
        assert.deepEqual(getArchiveReadRoots(), [
            '/tmp/custom-archive-root',
            path.join(process.cwd(), 'data', 'historical'),
        ]);
    } finally {
        if (original === undefined) {
            delete process.env.MARKET_ARCHIVE_ROOT;
        } else {
            process.env.MARKET_ARCHIVE_ROOT = original;
        }
    }
});

test('buildPrimaryArchivePath normalizes symbol casing inside the primary archive', () => {
    const original = process.env.MARKET_ARCHIVE_ROOT;
    process.env.MARKET_ARCHIVE_ROOT = '/tmp/custom-archive-root';

    try {
        assert.equal(
            buildPrimaryArchivePath('btcusdt', 'klines', '1h', 'merged.csv'),
            '/tmp/custom-archive-root/BTCUSDT/klines/1h/merged.csv',
        );
    } finally {
        if (original === undefined) {
            delete process.env.MARKET_ARCHIVE_ROOT;
        } else {
            process.env.MARKET_ARCHIVE_ROOT = original;
        }
    }
});

test('getArchiveReportDir places reports inside the primary archive root', () => {
    const original = process.env.MARKET_ARCHIVE_ROOT;
    process.env.MARKET_ARCHIVE_ROOT = '/tmp/custom-archive-root';

    try {
        assert.equal(getArchiveReportDir(), '/tmp/custom-archive-root/_reports');
    } finally {
        if (original === undefined) {
            delete process.env.MARKET_ARCHIVE_ROOT;
        } else {
            process.env.MARKET_ARCHIVE_ROOT = original;
        }
    }
});

test('resolveReadableArchivePath falls back to the legacy historical root when primary is empty', async () => {
    const original = process.env.MARKET_ARCHIVE_ROOT;
    process.env.MARKET_ARCHIVE_ROOT = '/tmp/custom-archive-root';

    const fs = await import('node:fs/promises');
    const legacyPath = path.join(process.cwd(), 'data', 'historical', 'TESTUSDT', 'klines', '1h', 'merged.csv');

    await fs.mkdir(path.dirname(legacyPath), { recursive: true });
    await fs.writeFile(legacyPath, 'header\n', 'utf-8');

    try {
        assert.equal(
            resolveReadableArchivePath('testusdt', 'klines', '1h', 'merged.csv'),
            legacyPath,
        );
    } finally {
        await fs.rm(path.join(process.cwd(), 'data', 'historical', 'TESTUSDT'), { recursive: true, force: true });
        if (original === undefined) {
            delete process.env.MARKET_ARCHIVE_ROOT;
        } else {
            process.env.MARKET_ARCHIVE_ROOT = original;
        }
    }
});
