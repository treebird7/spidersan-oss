/**
 * spidersan registry-sync
 * 
 * Sync local registry to/from Supabase for cross-machine awareness.
 * Part of F1: Supabase Registry Sync (spidersan-github-dashboard).
 */

import { Command } from 'commander';
import { readFile } from 'fs/promises';
import { existsSync } from 'fs';
import { join, basename } from 'path';
import { homedir } from 'os';
import { execFileSync } from 'child_process';
import { LocalStorage } from '../storage/local.js';
import { SupabaseStorage } from '../storage/supabase.js';
import { resolveSupabaseCredentials } from '../lib/supabase-credentials.js';
import { loadMachineIdentity } from '../lib/machine.js';
import { getRepoName } from '../lib/git.js';

/**
 * Get the repo root path.
 */
function getRepoPath(): string {
    try {
        return execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf-8' }).trim();
    } catch {
        return process.cwd();
    }
}

/**
 * Get a SupabaseStorage instance, or null if not configured.
 */
async function getSupabaseStorage(): Promise<SupabaseStorage | null> {
    // COLONY_SUPABASE_* used to sit in this chain as a last-resort fallback. It
    // is gone deliberately: colony is a different Supabase project, so that
    // fallback could push spider_registries into the wrong database (tb-ly0b).
    const creds = await resolveSupabaseCredentials();
    if (!creds) return null;
    return new SupabaseStorage(creds);
}

export const registrySyncCommand = new Command('registry-sync')
    .description('Sync local registry to/from Supabase (cross-machine awareness)')
    .option('--push', 'Push local registry to Supabase')
    .option('--pull', 'Pull other machines\' registries from Supabase')
    .option('--status', 'Show sync status across all machines')
    .option('--repo <name>', 'Limit to specific repo (default: current)')
    .action(async (options) => {
        const supabase = await getSupabaseStorage();
        if (!supabase) {
            console.error('❌ Supabase not configured. Set SUPABASE_URL and SUPABASE_KEY.');
            console.error('   Registry sync requires cloud storage for cross-machine awareness.');
            process.exit(1);
        }

        const machine = await loadMachineIdentity();
        const repoName = options.repo || getRepoName();

        // Default to --status if no flag specified
        if (!options.push && !options.pull && !options.status) {
            options.status = true;
        }

        // ── PUSH ──
        if (options.push) {
            console.log(`🕷️ Pushing registry from ${machine.name} (${repoName})...\n`);

            const localStorage = new LocalStorage();
            if (!await localStorage.isInitialized()) {
                console.error('❌ Spidersan not initialized. Run: spidersan init');
                process.exit(1);
            }

            const branches = await localStorage.list();
            const repoPath = getRepoPath();

            const result = await supabase.pushRegistry(machine, repoName, repoPath, branches);

            if (result.errors.length > 0) {
                for (const err of result.errors) {
                    console.error(`  ❌ ${err}`);
                }
                process.exit(1);
            }

            console.log(`  ✅ Pushed ${result.pushed} active branch(es)`);
            if (result.updated > 0) console.log(`  🔄 Updated ${result.updated} non-active branch(es)`);
            if (result.abandoned > 0) console.log(`  🗑️  Marked ${result.abandoned} removed branch(es) as abandoned`);
            console.log(`\n  Machine: ${machine.name} (${machine.hostname})`);
            console.log(`  Repo: ${repoName}`);
        }

        // ── PULL ──
        if (options.pull) {
            console.log(`🕷️ Pulling registries for ${repoName} (excluding ${machine.name})...\n`);

            const views = await supabase.pullRegistries(repoName, machine.id);

            if (views.length === 0) {
                console.log('  No other machines have registered branches for this repo.');
                return;
            }

            for (const view of views) {
                console.log(`  📡 ${view.machine_name} (${view.hostname}) — ${view.branches.length} branch(es)`);
                console.log(`     Last sync: ${new Date(view.last_synced).toLocaleString()}\n`);

                for (const branch of view.branches) {
                    const files = branch.files.length > 0 ? ` [${branch.files.length} files]` : '';
                    const agent = branch.agent ? ` (${branch.agent})` : '';
                    console.log(`     • ${branch.name}${agent}${files}`);
                    if (branch.description) {
                        console.log(`       ${branch.description}`);
                    }
                }
                console.log('');
            }
        }

        // ── STATUS ──
        if (options.status) {
            console.log(`🕷️ Registry sync status${options.repo ? ` (${repoName})` : ' (all repos)'}:\n`);

            const statuses = await supabase.getRegistryStatus(options.repo ? repoName : undefined);

            if (statuses.length === 0) {
                console.log('  No registries synced yet. Run: spidersan registry-sync --push');
                return;
            }

            // Table header
            console.log('  Machine      Hostname       Branches  Active  Repos            Last Sync');
            console.log('  ─────────    ──────────     ────────  ──────  ─────            ─────────');

            for (const s of statuses) {
                const isSelf = s.machine_id === machine.id ? ' ⭐' : '';
                const repos = s.repos.join(', ');
                const lastSync = new Date(s.last_sync).toLocaleString();
                console.log(
                    `  ${(s.machine_name + isSelf).padEnd(14)}` +
                    `${s.hostname.padEnd(15)}` +
                    `${String(s.branch_count).padEnd(10)}` +
                    `${String(s.active_count).padEnd(8)}` +
                    `${repos.padEnd(17)}` +
                    `${lastSync}`,
                );
            }
        }
    });
