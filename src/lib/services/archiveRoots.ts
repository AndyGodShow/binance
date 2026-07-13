import fs from 'node:fs';
import path from 'node:path';
import { readArchiveEnv } from '../env.ts';

const DEFAULT_PRIMARY_ARCHIVE_DIR = path.join(/* turbopackIgnore: true */ process.cwd(), 'data', 'market-archive-v2');
const LEGACY_ARCHIVE_DIR = path.join(/* turbopackIgnore: true */ process.cwd(), 'data', 'historical');

function normalizeArchiveRoot(root: string | undefined): string {
    if (!root || root.trim().length === 0) {
        return DEFAULT_PRIMARY_ARCHIVE_DIR;
    }

    return path.isAbsolute(root) ? root : path.join(/* turbopackIgnore: true */ process.cwd(), root);
}

export function getArchiveWriteRoot(): string {
    return normalizeArchiveRoot(readArchiveEnv().marketArchiveRoot);
}

function getLegacyArchiveRoot(): string {
    return LEGACY_ARCHIVE_DIR;
}

export function getArchiveReadRoots(): string[] {
    return [
        getArchiveWriteRoot(),
        getLegacyArchiveRoot(),
    ].filter((root, index, roots) => roots.indexOf(root) === index);
}

export function buildPrimaryArchivePath(symbol: string, ...segments: string[]): string {
    return path.join(/* turbopackIgnore: true */ getArchiveWriteRoot(), symbol.toUpperCase(), ...segments);
}

export function resolveReadableArchivePath(symbol: string, ...segments: string[]): string | null {
    const normalizedSymbol = symbol.toUpperCase();

    for (const root of getArchiveReadRoots()) {
        const candidate = path.join(/* turbopackIgnore: true */ root, normalizedSymbol, ...segments);
        if (fs.existsSync(candidate)) {
            return candidate;
        }
    }

    return null;
}

export function getArchiveReportDir(): string {
    return path.join(/* turbopackIgnore: true */ getArchiveWriteRoot(), '_reports');
}
