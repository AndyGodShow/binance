import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

const repoRoot = process.cwd();

test('strategy scanner uses the enriched strategy market endpoint', () => {
    const pageSource = readFileSync(join(repoRoot, 'src/app/page.tsx'), 'utf8');

    assert.match(pageSource, /\/api\/market\/strategy/);
});

test('strategy market endpoint has its own route', () => {
    assert.equal(existsSync(join(repoRoot, 'src/app/api/market/strategy/route.ts')), true);
});
