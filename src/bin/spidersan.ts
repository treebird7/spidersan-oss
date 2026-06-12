#!/usr/bin/env node
/**
 * Spidersan CLI Entry Point
 *
 * Branch coordination for AI coding agents.
 *
 * Startup performance: commands are lazy-loaded. Importing from
 * `../commands/index.js` would pull in all ~38 command modules (and their heavy
 * transitive deps — blessed, socket.io-client, chokidar, tree-sitter — ~700ms)
 * just to print `--version`. Instead we register only the invoked command's
 * module on the hot path, and fall back to loading everything only for help /
 * unknown / ecosystem commands.
 */

import 'dotenv/config';
import { Command } from 'commander';
import { createRequire } from 'module';

// Read version from package.json dynamically
const require = createRequire(import.meta.url);
const pkg = require('../../package.json');

const program = new Command();

// Global debug mode flag
let debugMode = false;
export const isDebugMode = () => debugMode;

// Global error handler for debug mode
process.on('uncaughtException', (error) => {
    if (debugMode) {
        console.error('\n🔴 UNCAUGHT EXCEPTION:');
        console.error(error.stack || error.message);
    } else {
        console.error(`❌ ${error.message}`);
        console.error('   Run with --debug for full stack trace');
    }
    process.exit(1);
});

process.on('unhandledRejection', (reason) => {
    if (debugMode) {
        console.error('\n🔴 UNHANDLED REJECTION:');
        console.error(reason);
    } else {
        console.error(`❌ Unhandled error: ${reason}`);
        console.error('   Run with --debug for full stack trace');
    }
    process.exit(1);
});

program
    .name('spidersan')
    .description('🕷️ Branch coordination for AI coding agents')
    .version(pkg.version)
    .option('-D, --debug', 'Enable verbose debug output with stack traces')
    .hook('preAction', (thisCommand) => {
        const opts = thisCommand.opts();
        if (opts.debug) {
            debugMode = true;
            console.log('🐛 Debug mode enabled\n');
        }
    });

/**
 * Lazy registry: command name → loader that imports just that command's module
 * and registers it onto `program`. Insertion order matches the help-listing
 * order. Most commands export a ready-built `Command`; the exceptions are the
 * `sync-advisor` factory, the attach-style `log`/`daily` (which mutate program),
 * and `ai.js` which exports several commands from one module.
 */
const COMMAND_LOADERS: Record<string, (p: Command) => Promise<unknown>> = {
    init:             async p => p.addCommand((await import('../commands/init.js')).initCommand),
    register:         async p => p.addCommand((await import('../commands/register.js')).registerCommand),
    list:             async p => p.addCommand((await import('../commands/list.js')).listCommand),
    conflicts:        async p => p.addCommand((await import('../commands/conflicts.js')).conflictsCommand),
    'merge-order':    async p => p.addCommand((await import('../commands/merge-order.js')).mergeOrderCommand),
    'ready-check':    async p => p.addCommand((await import('../commands/ready-check.js')).readyCheckCommand),
    depends:          async p => p.addCommand((await import('../commands/depends.js')).dependsCommand),
    stale:            async p => p.addCommand((await import('../commands/stale.js')).staleCommand),
    cleanup:          async p => p.addCommand((await import('../commands/cleanup.js')).cleanupCommand),
    rescue:           async p => p.addCommand((await import('../commands/rescue.js')).rescueCommand),
    abandon:          async p => p.addCommand((await import('../commands/abandon.js')).abandonCommand),
    merged:           async p => p.addCommand((await import('../commands/merged.js')).mergedCommand),
    sync:             async p => p.addCommand((await import('../commands/sync.js')).syncCommand),
    watch:            async p => p.addCommand((await import('../commands/watch.js')).watchCommand),
    doctor:           async p => p.addCommand((await import('../commands/doctor.js')).doctorCommand),
    config:           async p => p.addCommand((await import('../commands/config.js')).configCommand),
    auto:             async p => p.addCommand((await import('../commands/auto.js')).autoCommand),
    welcome:          async p => p.addCommand((await import('../commands/welcome.js')).welcomeCommand),
    'registry-sync':  async p => p.addCommand((await import('../commands/registry-sync.js')).registrySyncCommand),
    'cross-conflicts':async p => p.addCommand((await import('../commands/cross-conflicts.js')).crossConflictsCommand),
    pulse:            async p => p.addCommand((await import('../commands/pulse.js')).pulseCommand),
    'git-watch':      async p => p.addCommand((await import('../commands/git-watch.js')).gitWatchCommand),
    'fleet-status':   async p => p.addCommand((await import('../commands/fleet-status.js')).fleetStatusCommand),
    torrent:          async p => p.addCommand((await import('../commands/torrent.js')).torrentCommand),
    queen:            async p => p.addCommand((await import('../commands/queen.js')).queenCommand),
    bot:              async p => p.addCommand((await import('../commands/bot.js')).botCommand),
    'github-sync':    async p => p.addCommand((await import('../commands/github-sync.js')).githubSyncCommand),
    'sync-advisor':   async p => p.addCommand((await import('../commands/sync-advisor.js')).syncAdvisorCommand()),
    dashboard:        async p => p.addCommand((await import('../commands/dashboard.js')).dashboardCommand),
    'rebase-helper':  async p => p.addCommand((await import('../commands/rebase-helper.js')).rebaseHelperCommand),
    log:              async p => { (await import('../commands/log.js')).logCommand(p); },
    daily:            async p => { (await import('../commands/daily.js')).dailyCommand(p); },
    context:          async p => p.addCommand((await import('../commands/context.js')).contextCommand),
    ask:              async p => p.addCommand((await import('../commands/ai.js')).askCommand),
    advise:           async p => p.addCommand((await import('../commands/ai.js')).adviseCommand),
    explain:          async p => p.addCommand((await import('../commands/ai.js')).explainCommand),
    'ai-ping':        async p => p.addCommand((await import('../commands/ai.js')).aiPingCommand),
    'ai-setup':       async p => p.addCommand((await import('../commands/ai.js')).aiSetupCommand),
    'ai-telemetry':   async p => p.addCommand((await import('../commands/ai.js')).aiTelemetryCommand),
    'check-opt-out':  async p => p.addCommand((await import('../commands/ai.js')).checkOptOutCommand),
};

/** First non-option token in argv — the invoked top-level command, if any. */
function firstCommandToken(argv: string[]): string | undefined {
    for (const a of argv) {
        if (a === '--') break;
        if (!a.startsWith('-')) return a;
    }
    return undefined;
}

/** Cold path: register every core command (preserves help-listing order). */
async function loadAllCommands(p: Command): Promise<void> {
    for (const load of Object.values(COMMAND_LOADERS)) {
        await load(p);
    }
}

async function main(): Promise<void> {
    const args = process.argv.slice(2);
    const cmd = firstCommandToken(args);

    // Fast path for --version: no command modules needed at all.
    if (!cmd && (args.includes('--version') || args.includes('-V'))) {
        program.parse();
        return;
    }

    if (cmd && Object.prototype.hasOwnProperty.call(COMMAND_LOADERS, cmd)) {
        // Hot path: a known core command — load only that module. Core commands
        // always win over ecosystem ones (see dedup below), so ecosystem loading
        // is unnecessary here.
        await COMMAND_LOADERS[cmd](program);
    } else {
        // Cold path: help / no command / unknown command / ecosystem command.
        // Build the full tree so commander can list every command, route to an
        // ecosystem command, or emit a correct unknown-command error.
        await loadAllCommands(program);

        const { loadEcosystemCommands, getEcosystemStatus } = await import('../commands/ecosystem-loader.js');
        const ecosystemCommands = await loadEcosystemCommands();
        ecosystemCommands.forEach((command) => {
            const existing = program.commands.find(c => c.name() === command.name());
            if (existing) {
                if (isDebugMode()) {
                    console.log(`⚠️  Skipping duplicate ecosystem command: ${command.name()}`);
                }
                return;
            }
            program.addCommand(command);
        });

        const ecosystemStatus = getEcosystemStatus();
        if (ecosystemStatus.versionMismatch && ecosystemStatus.requiredRange && ecosystemStatus.coreVersion) {
            console.warn(
                `⚠️ Ecosystem expects spidersan@${ecosystemStatus.requiredRange}, but core is ${ecosystemStatus.coreVersion}`
            );
        }
    }

    // Check for updates (non-blocking)
    const { checkForUpdates } = await import('../lib/update-check.js');
    checkForUpdates().catch(() => { });

    program.parse();
}

void main();
