#!/usr/bin/env node
/**
 * Spidersan CLI Entry Point
 *
 * Branch coordination for AI coding agents.
 */

import 'dotenv/config';
import { Command } from 'commander';
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
} from '../commands/index.js';

const program = new Command();

program
    .name('spidersan')
    .description('🕷️ Branch coordination for AI coding agents')
    .version('0.1.0');

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

program.parse();
