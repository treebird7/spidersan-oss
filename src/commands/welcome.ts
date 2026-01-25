import { Command } from 'commander';
import { existsSync } from 'fs';
import { join } from 'path';

// ANSI color codes for terminal output
const colors = {
    reset: '\x1b[0m',
    bright: '\x1b[1m',
    dim: '\x1b[2m',
    red: '\x1b[31m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    magenta: '\x1b[35m',
    cyan: '\x1b[36m',
};

const c = colors;

function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function runWelcome(): Promise<void> {
    // The grand entrance
    console.log(`
${c.bright}${c.magenta}🕷️ ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${c.reset}
${c.bright}${c.magenta}   SPIDERSAN WELCOMES YOU TO THE WEB${c.reset}
${c.bright}${c.magenta}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${c.reset}
`);

    await sleep(800);

    console.log(`${c.cyan}   You are not alone in this codebase.${c.reset}`);
    await sleep(600);
    console.log(`${c.cyan}   Other agents weave alongside you.${c.reset}`);
    await sleep(600);
    console.log(`${c.cyan}   The web keeps you from colliding.${c.reset}`);

    await sleep(1000);

    console.log(`
   ${c.dim}┌─────────────────────────────────┐${c.reset}
   ${c.dim}│${c.reset}  ${c.bright}${c.yellow}"Claim your threads${c.reset}            ${c.dim}│${c.reset}
   ${c.dim}│${c.reset}   ${c.bright}${c.yellow}before you weave."${c.reset}            ${c.dim}│${c.reset}
   ${c.dim}└─────────────────────────────────┘${c.reset}
`);

    await sleep(1200);

    // Check initialization status
    const initialized = existsSync(join(process.cwd(), '.spidersan', 'registry.json'));

    if (!initialized) {
        console.log(`${c.yellow}🕸️  FIRST TIME HERE?${c.reset}`);
        console.log(`
   ${c.bright}Step 1:${c.reset} Initialize the web in your project
   ${c.green}$ spidersan init${c.reset}
`);
    } else {
        console.log(`${c.green}✓ Web initialized in this project${c.reset}
`);
    }

    console.log(`${c.cyan}🕸️  QUICK SETUP:${c.reset}

   ${c.bright}Register your branch:${c.reset}
   ${c.green}$ spidersan register --files "src/myfile.ts" --agent myname${c.reset}

   ${c.bright}Check for conflicts:${c.reset}
   ${c.green}$ spidersan conflicts${c.reset}

   ${c.bright}When done:${c.reset}
   ${c.green}$ spidersan merged${c.reset}
`);

    await sleep(800);

    console.log(`${c.bright}${c.blue}⚡ OR: AUTO-MODE${c.reset}

   Let Spidersan watch your files automatically:
   ${c.green}$ spidersan watch --agent myname${c.reset}

   ${c.dim}Files tracked as you edit. Conflicts caught in real-time.${c.reset}
`);

    await sleep(1000);

    console.log(`${c.magenta}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${c.reset}

${c.bright}🎬 WANT TO SEE THE WEB'S POWER?${c.reset}

   ${c.cyan}$ spidersan demo${c.reset}

   ${c.dim}Watch a simulated multi-agent conflict get caught!${c.reset}

${c.magenta}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${c.reset}
${c.bright}${c.magenta}   The web sees all. The web protects all.${c.reset}
${c.bright}${c.magenta}🕷️ ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${c.reset}
`);
}

export const welcomeCommand = new Command('welcome')
    .description('🕷️ Welcome ritual - start here if you are new')
    .action(async () => {
        await runWelcome();
    });
