/**
 * Parity test for KNOWN_SPIDERSAN_COMMANDS in src/lib/ai/reasoner.ts.
 *
 * The Set is hand-maintained. This test asserts it stays in sync with:
 *   1. Every command token the same file's SCENARIO_PLAYBOOK coaches the model to emit.
 *   2. Every top-level command file in src/commands/.
 *
 * If either assertion fails, the validator will flag legitimate model output as hallucinated
 * (false positive) or accept invented commands (false negative). Fix by updating the Set,
 * renaming the command in the playbook, or deleting the stale file — whichever matches intent.
 *
 * Added after a ts-review of fc78ec4 surfaced the drift.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..');
const REASONER_PATH = join(REPO_ROOT, 'src/lib/ai/reasoner.ts');
const COMMANDS_DIR = join(REPO_ROOT, 'src/commands');

// Files in src/commands/ that aren't themselves commands (routers, helpers, subcommand hosts).
// ai.ts exports several subcommands (ask/advise/explain/ai-ping/ai-setup/ai-telemetry/check-opt-out);
// those are covered by the SCENARIO_PLAYBOOK test below, not the filesystem test.
const NON_COMMAND_FILES = new Set(['index.ts', 'ecosystem-loader.ts', 'ai.ts']);

function extractKnownSet(source: string): Set<string> {
    const match = source.match(/const KNOWN_SPIDERSAN_COMMANDS\s*=\s*new Set\(\[([\s\S]*?)\]\)/);
    if (!match) throw new Error('KNOWN_SPIDERSAN_COMMANDS literal not found in reasoner.ts');
    const tokens = match[1]!.match(/'([^']+)'/g) ?? [];
    return new Set(tokens.map(t => t.slice(1, -1)));
}

function extractPlaybookCommands(source: string): Set<string> {
    // SCENARIO_PLAYBOOK uses two shapes we can reliably extract:
    //   1. `spidersan <cmd>` — fully-qualified reference in backticks.
    //   2. `Commands:` lines listing steps separated by →. Each step's first word is the command,
    //      optionally prefixed with `spidersan ` which we strip.
    // We ignore flags, placeholders, CLI name tokens, and quoted-string noise.

    const result = new Set<string>();
    // "spidersan" itself is the CLI name, not a subcommand — exclude if surfaced.
    const IGNORE = new Set(['spidersan']);
    const add = (t: string) => {
        if (/^[a-z][a-z0-9-]*$/.test(t) && !IGNORE.has(t)) result.add(t);
    };

    // Shape 1: fully-qualified backtick references.
    for (const m of source.matchAll(/`spidersan\s+([a-z][a-z0-9-]*)/g)) {
        add(m[1]!);
    }

    // Shape 2: "Commands:" lines. Split only on → (splitting on comma fires inside
    // quoted arg strings like `--files "f1,f2"`). Strip a leading `spidersan ` from
    // each step, then take the first word.
    for (const m of source.matchAll(/^Commands:\s*(.+)$/gm)) {
        for (const rawStep of m[1]!.split(/→/)) {
            const step = rawStep.trim().replace(/^spidersan\s+/, '');
            const firstToken = step.match(/^([a-z][a-z0-9-]*)\b/);
            if (firstToken) add(firstToken[1]!);
        }
    }

    return result;
}

describe('reasoner — KNOWN_SPIDERSAN_COMMANDS parity', () => {
    const reasonerSource = readFileSync(REASONER_PATH, 'utf-8');
    const known = extractKnownSet(reasonerSource);

    it('Set is populated', () => {
        expect(known.size).toBeGreaterThan(10);
    });

    it('every command in SCENARIO_PLAYBOOK is in the Set', () => {
        const playbookCommands = extractPlaybookCommands(reasonerSource);
        const missing = [...playbookCommands].filter(c => !known.has(c)).sort();
        expect(
            missing,
            `Commands referenced in SCENARIO_PLAYBOOK but missing from KNOWN_SPIDERSAN_COMMANDS: [${missing.join(', ')}]. ` +
            `Fix by adding them to the Set, or renaming/removing the playbook reference.`,
        ).toEqual([]);
    });

    it('every top-level command file in src/commands/ is in the Set', () => {
        const files = readdirSync(COMMANDS_DIR)
            .filter(f => f.endsWith('.ts') && !NON_COMMAND_FILES.has(f))
            .map(f => f.replace(/\.ts$/, ''))
            .sort();
        const missing = files.filter(f => !known.has(f));
        expect(
            missing,
            `Command files present in src/commands/ but missing from KNOWN_SPIDERSAN_COMMANDS: [${missing.join(', ')}].`,
        ).toEqual([]);
    });
});
