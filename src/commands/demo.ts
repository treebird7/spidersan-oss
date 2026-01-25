import { Command } from 'commander';

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

async function runDemo(): Promise<void> {
    console.log(`
${c.bright}${c.magenta}╔════════════════════════════════════════════════════════════╗
║                                                              ║
║   🕷️  SPIDERSAN DEMO - See It In Action                     ║
║                                                              ║
╚════════════════════════════════════════════════════════════╝${c.reset}
`);

    await sleep(1000);

    // Scenario setup
    console.log(`${c.cyan}📋 SCENARIO: Two AI agents working on the same codebase${c.reset}\n`);
    await sleep(1500);

    console.log(`${c.dim}Simulating a typical multi-agent workflow...${c.reset}\n`);
    await sleep(1200);

    // Agent 1 registers
    console.log(`${c.yellow}━━━ Agent 1: Claude (Session A) ━━━${c.reset}`);
    await sleep(800);
    console.log(`${c.green}✓${c.reset} Registering branch: ${c.bright}feature/auth${c.reset}`);
    await sleep(600);
    console.log(`${c.green}✓${c.reset} Files: ${c.cyan}src/auth.ts, src/middleware.ts${c.reset}`);
    await sleep(1000);

    console.log(`\n${c.dim}[Claude starts working on authentication...]${c.reset}\n`);
    await sleep(1500);

    // Agent 2 registers - conflict!
    console.log(`${c.yellow}━━━ Agent 2: Cursor (Session B) ━━━${c.reset}`);
    await sleep(800);
    console.log(`${c.green}✓${c.reset} Registering branch: ${c.bright}feature/api${c.reset}`);
    await sleep(600);
    console.log(`${c.green}✓${c.reset} Files: ${c.cyan}src/api.ts, src/middleware.ts${c.reset}`);
    await sleep(1000);

    // CONFLICT DETECTED
    console.log(`
${c.bright}${c.red}╔════════════════════════════════════════════════════════════╗
║  ⚠️  CONFLICT DETECTED!                                      ║
╚════════════════════════════════════════════════════════════╝${c.reset}
`);
    await sleep(1200);

    console.log(`${c.red}🔴 File: ${c.bright}src/middleware.ts${c.reset}`);
    await sleep(500);
    console.log(`${c.red}   ├─ ${c.yellow}feature/auth${c.reset} ${c.dim}(Claude)${c.reset}`);
    await sleep(400);
    console.log(`${c.red}   └─ ${c.yellow}feature/api${c.reset} ${c.dim}(Cursor)${c.reset}`);
    await sleep(1500);

    console.log(`
${c.cyan}💡 Spidersan caught this BEFORE you created a merge conflict!${c.reset}
`);
    await sleep(1200);

    // Resolution
    console.log(`${c.green}━━━ RESOLUTION OPTIONS ━━━${c.reset}`);
    await sleep(600);
    console.log(`${c.dim}1.${c.reset} Coordinate with the other agent`);
    await sleep(400);
    console.log(`${c.dim}2.${c.reset} Wait for their branch to merge first`);
    await sleep(400);
    console.log(`${c.dim}3.${c.reset} Split the work differently`);
    await sleep(1500);

    // Watch mode teaser
    console.log(`
${c.bright}${c.blue}━━━ NEW: WATCH MODE ━━━${c.reset}
${c.dim}Auto-register files as you edit them:${c.reset}

  ${c.cyan}$ spidersan watch --agent claude${c.reset}

${c.dim}Files are tracked automatically. Conflicts detected in real-time.${c.reset}
`);
    await sleep(1000);

    // Next steps
    console.log(`
${c.bright}${c.magenta}╔════════════════════════════════════════════════════════════╗
║  🚀 READY TO START?                                          ║
╚════════════════════════════════════════════════════════════╝${c.reset}

${c.bright}Quick Setup:${c.reset}

  ${c.cyan}1.${c.reset} Initialize in your project:
     ${c.green}$ spidersan init${c.reset}

  ${c.cyan}2.${c.reset} Register your branch:
     ${c.green}$ spidersan register --files "src/myfile.ts"${c.reset}

  ${c.cyan}3.${c.reset} Check for conflicts:
     ${c.green}$ spidersan conflicts${c.reset}

  ${c.cyan}4.${c.reset} Or just watch automatically:
     ${c.green}$ spidersan watch --agent myname${c.reset}

${c.bright}Learn More:${c.reset}
  📖 Repo:    ${c.cyan}https://github.com/treebird7/spidersan-oss${c.reset}
  🌐 Site:    ${c.cyan}http://treebird.uk${c.reset}
  📧 Help:    ${c.cyan}treebird@treebird.dev${c.reset}

${c.dim}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${c.reset}
${c.bright}🕷️ The web catches conflicts before they catch you.${c.reset}
`);
}

export const demoCommand = new Command('demo')
    .description('🕷️ Interactive demo - see Spidersan in action')
    .action(async () => {
        await runDemo();
    });
