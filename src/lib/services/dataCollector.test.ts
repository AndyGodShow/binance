import assert from 'node:assert/strict';
import test from 'node:test';

import { summarizeDataDownloadDays } from './dataCollector.ts';

test('summarizeDataDownloadDays reports success when every day is downloaded or cached', () => {
    const result = summarizeDataDownloadDays([
        { date: '2026-07-01', status: 'downloaded' },
        { date: '2026-07-02', status: 'cached' },
    ]);

    assert.equal(result.status, 'success');
    assert.equal(result.totalDays, 2);
    assert.equal(result.completedDays, 2);
    assert.equal(result.failedDays, 0);
    assert.deepEqual(result.days, [
        { date: '2026-07-01', status: 'downloaded' },
        { date: '2026-07-02', status: 'cached' },
    ]);
});

test('summarizeDataDownloadDays reports partial when a curl download fails', () => {
    const result = summarizeDataDownloadDays([
        { date: '2026-07-01', status: 'downloaded' },
        {
            date: '2026-07-02',
            status: 'failed',
            stage: 'download',
            error: 'curl exited with code 22',
        },
    ]);

    assert.equal(result.status, 'partial');
    assert.equal(result.completedDays, 1);
    assert.equal(result.failedDays, 1);
    assert.deepEqual(result.days[1], {
        date: '2026-07-02',
        status: 'failed',
        stage: 'download',
        error: 'curl exited with code 22',
    });
});

test('summarizeDataDownloadDays reports failed when extraction fails for every day', () => {
    const result = summarizeDataDownloadDays([
        {
            date: '2026-07-01',
            status: 'failed',
            stage: 'extract',
            error: 'unzip exited with code 9',
        },
        {
            date: '2026-07-02',
            status: 'failed',
            stage: 'extract',
            error: 'unzip exited with code 9',
        },
    ]);

    assert.equal(result.status, 'failed');
    assert.equal(result.completedDays, 0);
    assert.equal(result.failedDays, 2);
    assert.deepEqual(result.days.map((day) => day.date), [
        '2026-07-01',
        '2026-07-02',
    ]);
});
