/**
 * spidersan registry-sync
 * 
 * Sync the local registry to/from other machines through the configured
 * storage.syncModule. Without one there is nothing to sync with: exit 1 and say
 * how to configure it.
 */

import { Command } from 'commander';
import { execFileSync } from 'child_process';
import { LocalStorage } from '../storage/local.js';
import { loadMachineIdentity } from '../lib/machine.js';
import { getRepoName, registryRepoNames } from '../lib/git.js';
import { resolveRegistrySync, syncModuleRequiredMessage } from '../storage/registry-sync.js';

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

export const registrySyncCommand = new Command('registry-sync')
    .description('Sync local registry to/from other machines (needs storage.syncModule)')
    .option('--push', 'Push local registry through the sync module')
    .option('--pull', 'Pull other machines\' registries through the sync module')
    .option('--status', 'Show sync status across all machines')
    .option('--repo <name>', 'Limit to specific repo (default: current)')
    .action(async (options) => {
        const supabase = await resolveRegistrySync();
        if (!supabase) {
            const [first, ...rest] = syncModuleRequiredMessage();
            console.error(`❌ ${first}`);
            for (const line of rest) console.error(line);
            process.exit(1);
            return;
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
            for (const name of result.abandonedBranches) console.log(`       - ${name}`);
            console.log(`\n  Machine: ${machine.name} (${machine.hostname})`);
            console.log(`  Repo: ${repoName}`);
        }

        // ── PULL ──
        if (options.pull) {
            console.log(`🕷️ Pulling registries for ${repoName} (excluding ${machine.name})...\n`);

            const views = await supabase.pullRegistries(options.repo ? [options.repo] : registryRepoNames(), machine.id);

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
