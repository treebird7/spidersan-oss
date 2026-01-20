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
    abandonCommand,
    mergedCommand,
    syncCommand,
    // Messaging
    sendCommand,
    inboxCommand,
    msgReadCommand,
    // Key management
    keygenCommand,
    keyImportCommand,
    keysCommand,
    // License
    activateCommand,
    statusCommand,
    // Session lifecycle
    wakeCommand,
    closeCommand,
    collabCommand,
    // Diagnostics
    doctorCommand,
    pulseCommand,
    completionsCommand,
    // Security Pipeline
    tensionCommand,
    auditMarkCommand,
    // Session logging
    logCommand,
    // Daemon mode
    watchCommand,
    radarCommand,
    // Demo/Onboarding
    demoCommand,
    // MCP Health
    mcpHealthCommand,
    mcpRestartCommand,
    // Task Torrenting
    torrentCommand,
    // Collab Sync
    collabSyncCommand,
    // Global Sync
    syncAllCommand,
    // Layer 3+4 Conflict Detection
    intentScanCommand,
    activeWindowsCommand,
    // Semantic Locking (CRDT)
    lockCommand,
    // Terminal UI
    tuiCommand,
    // File History
    whoTouchedCommand,
} from '../commands/index.js';

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

// Core commands (Free tier)
program.addCommand(initCommand);
program.addCommand(registerCommand);
program.addCommand(listCommand);
program.addCommand(conflictsCommand);
program.addCommand(mergeOrderCommand);
program.addCommand(readyCheckCommand);

// Branch lifecycle
program.addCommand(dependsCommand);
program.addCommand(staleCommand);
program.addCommand(cleanupCommand);
program.addCommand(abandonCommand);
program.addCommand(mergedCommand);
program.addCommand(syncCommand);

// Messaging (requires Supabase)
program.addCommand(sendCommand);
program.addCommand(inboxCommand);
program.addCommand(msgReadCommand);

// Key management (for encrypted messaging)
program.addCommand(keygenCommand);
program.addCommand(keyImportCommand);
program.addCommand(keysCommand);

// License management
program.addCommand(activateCommand);
program.addCommand(statusCommand);

// Session lifecycle
program.addCommand(wakeCommand);
program.addCommand(closeCommand);
collabCommand(program);

// Diagnostics
program.addCommand(doctorCommand);
program.addCommand(pulseCommand);
program.addCommand(completionsCommand);

// Security Pipeline (ssan + srlk)
program.addCommand(tensionCommand);
program.addCommand(auditMarkCommand);

// Session logging
program.addCommand(logCommand);

// Daemon mode
program.addCommand(watchCommand);
program.addCommand(radarCommand);

// Demo/Onboarding
program.addCommand(demoCommand);

// MCP Health
program.addCommand(mcpHealthCommand);
program.addCommand(mcpRestartCommand);

// Task Torrenting
program.addCommand(torrentCommand);

// Collab Sync (prevents merge conflicts)
program.addCommand(collabSyncCommand);

// Global Sync (all repos)
program.addCommand(syncAllCommand);

// Layer 3+4 Conflict Detection
program.addCommand(intentScanCommand);
program.addCommand(activeWindowsCommand);

// Semantic Locking (CRDT-based)
program.addCommand(lockCommand);

// Terminal UI
program.addCommand(tuiCommand);

// File History (forensics)
program.addCommand(whoTouchedCommand);

// Check for updates (non-blocking)
import { checkForUpdates } from '../lib/update-check.js';
checkForUpdates().catch(() => { });

program.parse();
