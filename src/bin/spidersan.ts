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
    // Demo/Onboarding
    demoCommand,
} from '../commands/index.js';

// Read version from package.json dynamically
const require = createRequire(import.meta.url);
const pkg = require('../../package.json');

const program = new Command();

program
    .name('spidersan')
    .description('🕷️ Branch coordination for AI coding agents')
    .version(pkg.version);

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

// Demo/Onboarding
program.addCommand(demoCommand);

// Check for updates (non-blocking)
import { checkForUpdates } from '../lib/update-check.js';
checkForUpdates().catch(() => { });

program.parse();
