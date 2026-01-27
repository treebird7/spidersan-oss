/**
 * spidersan welcome
 *
 * Friendly onboarding and quick start for core CLI.
 */

import { Command } from 'commander';
import { existsSync } from 'fs';
import { join } from 'path';

const colors = {
    reset: '\x1b[0m',
    bright: '\x1b[1m',
    dim: '\x1b[2m',
    yellow: '\x1b[33m',
    magenta: '\x1b[35m',
    cyan: '\x1b[36m',
    green: '\x1b[32m',
};

const c = colors;

function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function runWelcome(): Promise<void> {
    console.log(`
${c.bright}${c.magenta}🕷️ ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${c.reset}
${c.bright}${c.magenta}   SPIDERSAN WELCOMES YOU TO THE WEB${c.reset}
${c.bright}${c.magenta}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${c.reset}
`);

    await sleep(500);
    console.log(`${c.cyan}   You are not alone in this codebase.${c.reset}`);
    await sleep(450);
    console.log(`${c.cyan}   Other agents weave alongside you.${c.reset}`);
    await sleep(450);
    console.log(`${c.cyan}   The web keeps you from colliding.${c.reset}`);
    await sleep(700);

    const initialized = existsSync(join(process.cwd(), '.spidersan', 'registry.json'));
    if (!initialized) {
        console.log(`
${c.yellow}🕸️  FIRST TIME HERE?${c.reset}
   ${c.bright}Step 1:${c.reset} Initialize the web in your project
   ${c.green}$ spidersan init${c.reset}
`);
    } else {
        console.log(`
${c.green}✓ Web initialized in this project${c.reset}
`);
    }

    console.log(`${c.cyan}🕸️  QUICK START:${c.reset}

   ${c.bright}Register your branch:${c.reset}
   ${c.green}$ spidersan register --files "src/myfile.ts" --agent myname${c.reset}

   ${c.bright}Check for conflicts:${c.reset}
   ${c.green}$ spidersan conflicts${c.reset}

   ${c.bright}When done:${c.reset}
   ${c.green}$ spidersan merged${c.reset}
`);

    await sleep(600);
    console.log(`${c.bright}${c.cyan}⚙️  CONFIG SETUP${c.reset}

   ${c.dim}Set your default agent + storage in a guided wizard:${c.reset}
   ${c.green}$ spidersan config wizard${c.reset}
`);

    await sleep(600);
    console.log(`${c.bright}${c.cyan}⚡ AUTO-WATCH${c.reset}

   ${c.dim}Start a background watcher from config paths:${c.reset}
   ${c.green}$ spidersan auto start${c.reset}

   ${c.dim}Or run a foreground watcher:${c.reset}
   ${c.green}$ spidersan watch --agent myname${c.reset}
`);

    await sleep(600);
    console.log(`${c.magenta}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${c.reset}
${c.bright}${c.magenta}   The web sees all. The web protects all.${c.reset}
${c.bright}${c.magenta}🕷️ ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${c.reset}
`);
}

export const welcomeCommand = new Command('welcome')
    .description('🕷️ Welcome ritual - start here if you are new')
    .action(async () => {
        await runWelcome();
    });
