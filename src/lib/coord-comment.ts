/**
 * Injects a one-line coordination notice directly into a file that's under
 * active same-branch conflict — the only channel guaranteed to reach an
 * agent that has never heard of spidersan: the next time it reads or
 * re-reads the file it's editing, the notice is just... there.
 *
 * Idempotent: replaces its own previous marker line in place rather than
 * stacking duplicates on every re-conflict.
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { extname } from 'path';

const MARKER = 'spidersan-coord:';

// ponytail: hardcoded extension→comment-syntax map, not a real language
// detector — add an entry if a language you care about isn't covered.
const LINE_COMMENT: Record<string, string> = {
    '.ts': '//', '.tsx': '//', '.js': '//', '.jsx': '//', '.mjs': '//', '.cjs': '//',
    '.go': '//', '.rs': '//', '.java': '//', '.c': '//', '.cpp': '//', '.h': '//', '.swift': '//',
    '.py': '#', '.rb': '#', '.sh': '#', '.yml': '#', '.yaml': '#', '.toml': '#',
};
const BLOCK_COMMENT: Record<string, [string, string]> = {
    '.md': ['<!--', '-->'],
    '.html': ['<!--', '-->'],
    '.css': ['/*', '*/'],
};

function formatMarkerLine(ext: string, text: string): string {
    if (BLOCK_COMMENT[ext]) {
        const [open, close] = BLOCK_COMMENT[ext];
        return `${open} ${MARKER} ${text} ${close}`;
    }
    const prefix = LINE_COMMENT[ext] ?? '#';
    return `${prefix} ${MARKER} ${text}`;
}

export function secondsAgo(isoTimestamp: string): number {
    return Math.max(0, Math.round((Date.now() - new Date(isoTimestamp).getTime()) / 1000));
}

/**
 * Prepend (or replace, if already present) a one-line coordination notice
 * at the top of `filePath`. Returns true if the file was written, false if
 * the file doesn't exist, is binary-looking, or the notice was unchanged.
 */
export function injectCoordComment(filePath: string, claimantAgent: string, claimedAtIso: string): boolean {
    if (!existsSync(filePath)) return false;

    let content: string;
    try {
        content = readFileSync(filePath, 'utf-8');
    } catch {
        return false; // binary or unreadable — don't touch it
    }
    if (content.includes('\0')) return false; // binary guard

    const ext = extname(filePath);
    const text = `also being edited right now by ${claimantAgent} (${secondsAgo(claimedAtIso)}s ago) — expect overwrites, re-check before saving.`;
    const markerLine = formatMarkerLine(ext, text);

    const lines = content.split('\n');
    const existingIdx = lines.findIndex(l => l.includes(MARKER));

    let newLines: string[];
    if (existingIdx !== -1) {
        if (lines[existingIdx] === markerLine) return false; // already up to date
        newLines = [...lines];
        newLines[existingIdx] = markerLine;
    } else {
        newLines = [markerLine, ...lines];
    }

    writeFileSync(filePath, newLines.join('\n'));
    return true;
}
