#!/usr/bin/env node
/**
 * Spidersan CLI Entry Point
 *
 * Branch coordination for AI coding agents.
 */

import 'dotenv/config';
import { Command } from 'commander';
import { createRequire } from 'module';
import {
    initCommand,
    registerCommand,
    listCommand,
    conflictsCommand,
    mergeOrderCommand,
    readyCheckCommand,
    dependsCommand,
    staleCommand,
    cleanupCommand,
    rescueCommand,
    abandonCommand,
    mergedCommand,
    syncCommand,
    watchCommand,
    doctorCommand,
    configCommand,
    autoCommand,
    welcomeCommand,
    loadEcosystemCommands,
    getEcosystemStatus,
} from '../commands/index.js';
import { checkForUpdates } from '../lib/update-check.js';

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

// Core commands
program.addCommand(initCommand);
program.addCommand(registerCommand);
program.addCommand(listCommand);
program.addCommand(conflictsCommand);
program.addCommand(mergeOrderCommand);
program.addCommand(readyCheckCommand);
program.addCommand(dependsCommand);
program.addCommand(staleCommand);
program.addCommand(cleanupCommand);
program.addCommand(rescueCommand);
program.addCommand(abandonCommand);
program.addCommand(mergedCommand);
program.addCommand(syncCommand);
program.addCommand(watchCommand);
program.addCommand(doctorCommand);
program.addCommand(configCommand);
program.addCommand(autoCommand);
program.addCommand(welcomeCommand);

async function main(): Promise<void> {
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

    // Check for updates (non-blocking)
    checkForUpdates().catch(() => { });

    program.parse();
}

void main();
