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
import { COMMANDS, LOADER_BY_NAME } from './command-registry.js';

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

/** First non-option token in argv — the invoked top-level command, if any. */
function firstCommandToken(argv: string[]): string | undefined {
    for (const a of argv) {
        if (a === '--') break;
        if (!a.startsWith('-')) return a;
    }
    return undefined;
}

async function main(): Promise<void> {
    const args = process.argv.slice(2);
    const cmd = firstCommandToken(args);

    // Fast path for --version: no command modules needed at all.
    if (!cmd && (args.includes('--version') || args.includes('-V'))) {
        program.parse();
        return;
    }

    if (cmd && LOADER_BY_NAME.has(cmd)) {
        // Hot path: a known core command — load only that module. Core commands
        // always win over ecosystem ones (see dedup below), so ecosystem loading
        // is unnecessary here.
        await LOADER_BY_NAME.get(cmd)!(program);
    } else {
        // Cold path: help / no command / unknown command / ecosystem command.
        // Register lightweight stubs (name + description) so commander can render
        // the full command listing WITHOUT importing every module; a core command
        // is never *executed* here (it would have taken the hot path above), so
        // the stubs need no options or action. Ecosystem commands are loaded for
        // real below so they remain routable.
        for (const entry of COMMANDS) {
            program.command(entry.name).description(entry.description);
        }

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
