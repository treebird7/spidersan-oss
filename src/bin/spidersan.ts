#!/usr/bin/env node
/**
 * Spidersan CLI Entry Point
 * 
 * Branch coordination for AI coding agents.
 */

import { Command } from 'commander';
import { initCommand } from '../commands/init.js';
import { registerCommand } from '../commands/register.js';
import { listCommand } from '../commands/list.js';
import { conflictsCommand } from '../commands/conflicts.js';
import { mergeOrderCommand } from '../commands/merge-order.js';
import { readyCheckCommand } from '../commands/ready-check.js';

const program = new Command();

program
    .name('spidersan')
    .description('🕷️ Branch coordination for AI coding agents')
    .version('0.1.0');

// Free tier commands
program.addCommand(initCommand);
program.addCommand(registerCommand);
program.addCommand(listCommand);
program.addCommand(conflictsCommand);
program.addCommand(mergeOrderCommand);
program.addCommand(readyCheckCommand);

program.parse();
