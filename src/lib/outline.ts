/**
 * outline.ts — spike: symbol extraction for non-TS languages via `ast-grep outline`.
 *
 * Optional: needs the `ast-grep` binary on PATH. Returns null when it is missing
 * or fails, so callers can skip (never conclude "no conflicts" from null).
 */
import { execFileSync } from 'child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { compareSymbols, type SymbolConflict, type SymbolInfo } from './ast.js';

interface OutlineItem {
    symbolType: string;
    name: string;
    range: { byteOffset: { start: number; end: number }; start: { line: number }; end: { line: number } };
    members?: OutlineItem[];
}

/** ext includes the dot, e.g. '.py'. Only function/class/method symbols are kept. */
export function outlineSymbols(content: string, ext: string): SymbolInfo[] | null {
    const dir = mkdtempSync(join(tmpdir(), 'spidersan-outline-'));
    try {
        const file = join(dir, `f${ext}`);
        writeFileSync(file, content);
        const out = execFileSync('ast-grep', ['outline', '--json=compact', file], {
            encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'],
        });
        const files = JSON.parse(out);
        // `[]` = ast-grep doesn't know this file type; that is "unknown", not "no symbols"
        if (!Array.isArray(files) || files.length === 0) return null;
        const items: OutlineItem[] = files[0].items ?? [];
        const bytes = Buffer.from(content);
        const symbols: SymbolInfo[] = [];
        const add = (it: OutlineItem, parent?: string) => {
            const type = it.symbolType as SymbolInfo['type'];
            if (type !== 'function' && type !== 'class' && type !== 'method') return;
            symbols.push({
                name: it.name, type,
                startLine: it.range.start.line + 1, endLine: it.range.end.line + 1,
                ...(parent ? { parent } : {}),
                // byteOffset, not line slicing: exact text of the symbol
                content: bytes.subarray(it.range.byteOffset.start, it.range.byteOffset.end).toString('utf-8'),
            });
            it.members?.forEach(m => add(m, it.name));
        };
        items.forEach(it => add(it));
        return symbols;
    } catch {
        return null;
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
}

/** Same contract as ASTParser.findSymbolConflicts, for any language ast-grep outlines. null = unavailable. */
export function findOutlineConflicts(
    ext: string,
    contentA: string, labelA: string,
    contentB: string, labelB: string,
    baseContent?: string
): SymbolConflict[] | null {
    const a = outlineSymbols(contentA, ext);
    const b = outlineSymbols(contentB, ext);
    const base = baseContent === undefined ? undefined : outlineSymbols(baseContent, ext);
    if (!a || !b || base === null) return null;
    return compareSymbols(a, labelA, b, labelB, base);
}
