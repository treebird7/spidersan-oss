/**
 * spidersan verify-trunk
 *
 * Detect (and optionally fix) registry "trunk-poison": the trunk branch
 * (main/master/develop…) claiming files in the spidersan registry. A clean
 * auto-merge can silently re-poison main, so the post-merge hook gates on this.
 *
 * Promotes the 2026-06-15 `spidersan-post.sh` hook into a first-class command.
 */

import { Command } from 'commander';
import { getStorage } from '../storage/index.js';
import { getTrunkBranch } from '../lib/trunk.js';
import type { Branch } from '../storage/adapter.js';

interface VerifyTrunkOptions {
    json?: boolean;
    exitCode?: boolean;
    fix?: boolean;
}

interface PoisonedEntry {
    name: string;
    files: string[];
    fixed?: boolean;
}

/**
 * The set of branch names that MUST claim no files: the resolved trunk plus the
 * literal `main`/`master` (a repo can have stray entries for either even when
 * trunk resolves to something else). De-duplicated, order-stable.
 */
export function trunkEquivalentNames(trunk: string): string[] {
    const names = [trunk, 'main', 'master'];
    return [...new Set(names)];
}

export const verifyTrunkCommand = new Command('verify-trunk')
    .description('Detect registry trunk-poison (main/master must claim no files)')
    .option('--json', 'Output as JSON')
    .option('--fix', 'Reset every poisoned trunk-equivalent entry to files:[]')
    .option('--exit-code', 'Exit 1 when any trunk entry is poisoned — for hook gating')
    .action(async (options: VerifyTrunkOptions) => {
        const storage = await getStorage();

        if (!await storage.isInitialized()) {
            console.error('❌ Spidersan not initialized. Run: spidersan init');
            if (options.exitCode) process.exit(1);
            return;
        }

        const trunk = getTrunkBranch();
        const candidates = trunkEquivalentNames(trunk);

        const branches = await storage.list();
        const byName = new Map<string, Branch>(branches.map(b => [b.name, b] as const));

        const poisoned: PoisonedEntry[] = [];
        for (const name of candidates) {
            const branch = byName.get(name);
            if (branch && branch.files.length > 0) {
                poisoned.push({ name, files: [...branch.files] });
            }
        }

        // --fix: clear files:[] for every poisoned trunk-equivalent entry.
        if (options.fix) {
            for (const entry of poisoned) {
                await storage.update(entry.name, { files: [] });
                entry.fixed = true;
            }
        }

        if (options.json) {
            console.log(JSON.stringify({ trunk, poisoned: poisoned.length > 0, entries: poisoned }, null, 2));
        } else if (poisoned.length === 0) {
            console.log(`✅ trunk \`${trunk}\` is clean (files:[]).`);
        } else {
            for (const entry of poisoned) {
                const preview = entry.files.slice(0, 3).join(', ');
                const more = entry.files.length > 3 ? `, +${entry.files.length - 3} more` : '';
                if (entry.fixed) {
                    console.log(`🔧 \`${entry.name}\` had ${entry.files.length} file(s) (${preview}${more}) — reset to files:[].`);
                } else {
                    console.log(
                        `⚠️  TRUNK POISON: \`${entry.name}\` claims ${entry.files.length} file(s) in the registry ` +
                        `(${preview}${more}). A merge re-poisoned it (silent on clean auto-merge). ` +
                        `Reset to files:[] before pushing (run with --fix).`,
                    );
                }
            }
        }

        if (options.exitCode && poisoned.length > 0 && !options.fix) {
            process.exit(1);
        }
    });
