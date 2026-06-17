import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
    extractSymbols,
    findSymbolOverlaps,
    type FileSymbols,
} from '../src/lib/symbol-extractor.js';

describe('extractSymbols', () => {
    let dir: string;
    beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'ssan-symx-')); });
    afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

    function write(name: string, content: string): string {
        const p = join(dir, name);
        writeFileSync(p, content, 'utf-8');
        return p;
    }

    it('extracts exported symbols from a valid file (no parseError)', () => {
        const p = write('ok.ts', 'export const x = 1;\nexport function foo() {}\n');
        const r = extractSymbols(p);
        expect(r.parseError).toBeUndefined();
        expect(r.symbols.map(s => s.name).sort()).toEqual(['foo', 'x']);
    });

    it('genuinely empty file → empty symbols, NO parseError', () => {
        const p = write('empty.ts', '// just a comment\n');
        const r = extractSymbols(p);
        expect(r.parseError).toBeUndefined();
        expect(r.symbols).toEqual([]);
    });

    it('missing file → empty symbols, NO parseError', () => {
        const r = extractSymbols(join(dir, 'does-not-exist.ts'));
        expect(r.parseError).toBeUndefined();
        expect(r.symbols).toEqual([]);
    });

    it('syntactically broken file → parseError SET (not confused with empty)', () => {
        // ts-morph does NOT throw here; it silently yields ~0 symbols. The fix is
        // that we detect the syntax errors and flag the result as unreliable.
        const p = write('broken.ts', 'export const = = = }{ broken !!!\n');
        const r = extractSymbols(p);
        expect(r.parseError).toBeDefined();
    });

    it('a TYPE error (valid syntax) is NOT flagged — its symbols are real', () => {
        const p = write('typeerr.ts', 'export const y: NotARealType = 1;\n');
        const r = extractSymbols(p);
        expect(r.parseError).toBeUndefined();
        expect(r.symbols.map(s => s.name)).toContain('y');
    });
});

describe('findSymbolOverlaps', () => {
    const fs = (file: string, syms: Array<[string, number]>): FileSymbols => ({
        file,
        symbols: syms.map(([name, line]) => ({ name, kind: 'function' as const, line })),
    });

    it('reports a basic name overlap across branches', () => {
        const overlaps = findSymbolOverlaps(
            { branch: 'a', symbols: fs('f.ts', [['handle', 10]]) },
            { branch: 'b', symbols: fs('f.ts', [['handle', 20]]) },
        );
        expect(overlaps).toHaveLength(1);
        expect(overlaps[0].branches.map(b => b.line)).toEqual([10, 20]);
    });

    it('returns nothing when there is no shared name', () => {
        const overlaps = findSymbolOverlaps(
            { branch: 'a', symbols: fs('f.ts', [['alpha', 1]]) },
            { branch: 'b', symbols: fs('f.ts', [['beta', 2]]) },
        );
        expect(overlaps).toEqual([]);
    });

    it('does NOT drop duplicate-named left symbols (multimap, not last-wins)', () => {
        // Two declarations named `handle` on the left (e.g. overload signatures).
        // A name-keyed Map would keep only line 99 and lose line 10.
        const overlaps = findSymbolOverlaps(
            { branch: 'a', symbols: fs('f.ts', [['handle', 10], ['handle', 99]]) },
            { branch: 'b', symbols: fs('f.ts', [['handle', 20]]) },
        );
        expect(overlaps).toHaveLength(2);
        const leftLines = overlaps.map(o => o.branches[0].line).sort((x, y) => x - y);
        expect(leftLines).toEqual([10, 99]);
    });
});
