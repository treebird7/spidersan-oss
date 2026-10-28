/**
 * Lazy command registry for the spidersan CLI.
 *
 * Each entry carries the CLI name, the help-listing description, and a loader
 * that imports just that command's module and registers it onto `program`.
 * Most commands export a ready-built `Command`; the exception is the
 * attach-style `log` (which mutates program).
 *
 * `description` is duplicated here so the CLI's cold path (help / unknown
 * command) can render the full command listing from lightweight stubs WITHOUT
 * importing every command module. It must stay in sync with each command's real
 * `.description()` — `tests/bin-command-registry.test.ts` fails if it drifts.
 *
 * Array order is the help-listing order.
 */
import type { Command } from 'commander';

export interface CommandEntry {
    name: string;
    description: string;
    load: (program: Command) => Promise<unknown>;
}

export const COMMANDS: CommandEntry[] = [
    { name: 'init', description: 'Initialize Spidersan in the current project', load: async p => p.addCommand((await import('../commands/init.js')).initCommand) },
    { name: 'register', description: 'Register the current branch with files being modified', load: async p => p.addCommand((await import('../commands/register.js')).registerCommand) },
    { name: 'list', description: 'List all registered branches', load: async p => p.addCommand((await import('../commands/list.js')).listCommand) },
    { name: 'conflicts', description: 'Detect file conflicts between branches (with tiered blocking)', load: async p => p.addCommand((await import('../commands/conflicts.js')).conflictsCommand) },
    { name: 'merge-order', description: 'Get optimal merge order for all branches', load: async p => p.addCommand((await import('../commands/merge-order.js')).mergeOrderCommand) },
    { name: 'ready-check', description: 'Verify branch is ready to merge', load: async p => p.addCommand((await import('../commands/ready-check.js')).readyCheckCommand) },
    { name: 'depends', description: 'Set or show dependencies for a branch (deps merge first)', load: async p => p.addCommand((await import('../commands/depends.js')).dependsCommand) },
    { name: 'stale', description: 'Show stale branches (not updated recently)', load: async p => p.addCommand((await import('../commands/stale.js')).staleCommand) },
    { name: 'cleanup', description: 'Remove stale branches from registry', load: async p => p.addCommand((await import('../commands/cleanup.js')).cleanupCommand) },
    { name: 'abandon', description: 'Mark a branch as abandoned', load: async p => p.addCommand((await import('../commands/abandon.js')).abandonCommand) },
    { name: 'merged', description: 'Mark a branch as merged', load: async p => p.addCommand((await import('../commands/merged.js')).mergedCommand) },
    { name: 'sync', description: 'Sync registry with actual git branches', load: async p => p.addCommand((await import('../commands/sync.js')).syncCommand) },
    { name: 'watch', description: '🕷️ Watch files and auto-register changes (daemon mode)', load: async p => p.addCommand((await import('../commands/watch.js')).watchCommand) },
    { name: 'doctor', description: 'Diagnose common Spidersan issues', load: async p => p.addCommand((await import('../commands/doctor.js')).doctorCommand) },
    { name: 'config', description: 'View and edit Spidersan configuration', load: async p => p.addCommand((await import('../commands/config.js')).configCommand) },
    { name: 'registry-sync', description: 'Sync local registry to/from Supabase (cross-machine awareness)', load: async p => p.addCommand((await import('../commands/registry-sync.js')).registrySyncCommand) },
    { name: 'cross-conflicts', description: 'Detect file conflicts across machines (via Supabase)', load: async p => p.addCommand((await import('../commands/cross-conflicts.js')).crossConflictsCommand) },
    { name: 'git-watch', description: 'Subscribe to git-change notifications from GitHub webhooks', load: async p => p.addCommand((await import('../commands/git-watch.js')).gitWatchCommand) },
    { name: 'github-sync', description: 'Fetch branch/PR/CI status from GitHub for configured repos', load: async p => p.addCommand((await import('../commands/github-sync.js')).githubSyncCommand) },
    { name: 'pr-check', description: 'Check a PR\'s merge readiness (stacked base, red/behind state)', load: async p => p.addCommand((await import('../commands/pr-check.js')).prCheckCommand) },
    { name: 'verify-trunk', description: 'Detect registry trunk-poison (main/master must claim no files)', load: async p => p.addCommand((await import('../commands/verify-trunk.js')).verifyTrunkCommand) },
    { name: 'rebase-helper', description: 'Detect and help resolve local git rebase states (non-interactive guidance)', load: async p => p.addCommand((await import('../commands/rebase-helper.js')).rebaseHelperCommand) },
    { name: 'log', description: 'Show branch operation history', load: async p => { (await import('../commands/log.js')).logCommand(p); } },
    { name: 'context', description: 'Show aggregated repository context (registry, conflicts, git, colony)', load: async p => p.addCommand((await import('../commands/context.js')).contextCommand) },
];

/** name → loader, for O(1) hot-path dispatch. */
export const LOADER_BY_NAME = new Map(COMMANDS.map(c => [c.name, c.load]));
