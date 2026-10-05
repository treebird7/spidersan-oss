/**
 * Every `conflicts --<flag>` the AI layer suggests to users must be a real
 * option of the `conflicts` command. `--wake` was removed in sp-hnjf but kept
 * being recommended by reasoner.ts and event-handler.ts.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { conflictsCommand } from '../src/commands/conflicts.js';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const HINT_FILES = ['src/lib/ai/reasoner.ts', 'src/lib/ai/event-handler.ts'];

describe('AI conflicts flag hints', () => {
    const realFlags = new Set(conflictsCommand.options.map(o => o.long));

    for (const rel of HINT_FILES) {
        it(`${rel} only suggests real conflicts flags`, () => {
            const src = readFileSync(join(REPO_ROOT, rel), 'utf8');
            const hinted = [...src.matchAll(/(?<![\w-])conflicts (--[a-z][a-z-]*)/g)].map(m => m[1]!);
            expect(hinted.length).toBeGreaterThan(0);
            const bogus = hinted.filter(f => !realFlags.has(f));
            expect(bogus).toEqual([]);
        });
    }
});
