/**
 * spidersan tui
 * 
 * Launch interactive terminal dashboard
 */

import { Command } from 'commander';
import { SpidersanTUI } from '../tui/screen.js';

export const tuiCommand = new Command('tui')
    .description('Launch interactive terminal dashboard')
    .alias('dashboard')
    .action(() => {
        const tui = new SpidersanTUI();
        tui.start();
    });
