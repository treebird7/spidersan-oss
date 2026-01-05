import { Command } from 'commander';
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// Config
const MCP_CONFIG_PATH = path.join(os.homedir(), '.gemini', 'antigravity', 'mcp_config.json');

interface McpServerConfig {
    command: string;
    args: string[];
    env?: Record<string, string>;
}

interface McpConfig {
    mcpServers: Record<string, McpServerConfig>;
}

/**
 * Read MCP config from Antigravity config file
 */
function readMcpConfig(): McpConfig | null {
    try {
        if (!fs.existsSync(MCP_CONFIG_PATH)) {
            console.log(`⚠️ MCP config not found: ${MCP_CONFIG_PATH}`);
            return null;
        }
        const content = fs.readFileSync(MCP_CONFIG_PATH, 'utf-8');
        return JSON.parse(content) as McpConfig;
    } catch (err) {
        console.log(`❌ Failed to read MCP config: ${err}`);
        return null;
    }
}

/**
 * Validate MCP config JSON syntax and file paths
 */
function validateConfig(config: McpConfig): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    for (const [name, serverConfig] of Object.entries(config.mcpServers)) {
        // Check if command exists (for node, check the script path)
        if (serverConfig.command === 'node' && serverConfig.args.length > 0) {
            const scriptPath = serverConfig.args[0];
            if (!fs.existsSync(scriptPath)) {
                errors.push(`${name}: Script not found: ${scriptPath}`);
            }
        }
    }

    return { valid: errors.length === 0, errors };
}

/**
 * Kill all MCP processes
 */
function killMcpProcesses(dryRun: boolean = false): number {
    let killed = 0;

    try {
        // Find all MCP-related processes
        const output = execSync('ps aux | grep -E "mcp|MCP" | grep node | grep -v grep', {
            encoding: 'utf-8',
            stdio: ['pipe', 'pipe', 'pipe']
        }).trim();

        if (!output) {
            console.log('📭 No MCP processes found');
            return 0;
        }

        const lines = output.split('\n');

        for (const line of lines) {
            const parts = line.split(/\s+/);
            if (parts.length < 2) continue;

            const pid = parseInt(parts[1], 10);
            const command = parts.slice(10).join(' ').substring(0, 60);

            if (dryRun) {
                console.log(`   Would kill PID ${pid}: ${command}...`);
            } else {
                try {
                    execSync(`kill ${pid}`, { stdio: 'ignore' });
                    console.log(`   Killed PID ${pid}: ${command}...`);
                    killed++;
                } catch {
                    // Process might already be dead
                }
            }
        }
    } catch {
        // No processes found - that's okay
    }

    return killed;
}

/**
 * Restart Antigravity using osascript (macOS only)
 */
function restartAntigravity(): boolean {
    try {
        console.log('🔄 Restarting Antigravity...');
        execSync('osascript -e \'quit app "Antigravity"\'', { stdio: 'ignore' });

        // Wait a moment for clean shutdown
        execSync('sleep 2');

        // Relaunch
        execSync('open -a Antigravity', { stdio: 'ignore' });

        console.log('✅ Antigravity restarted');
        return true;
    } catch (err) {
        console.log(`❌ Failed to restart Antigravity: ${err}`);
        return false;
    }
}

export const mcpRestartCommand = new Command('mcp-restart')
    .description('🔄 Kill MCP processes and restart Antigravity to reload connections')
    .option('--validate', 'Validate mcp_config.json before restart')
    .option('--dry-run', 'Show what would be killed without actually killing')
    .option('--force', 'Force restart Antigravity using osascript (macOS only)')
    .option('--kill-only', 'Only kill MCPs, don\'t restart Antigravity')
    .action(async (options: { validate?: boolean; dryRun?: boolean; force?: boolean; killOnly?: boolean }) => {
        console.log(`
🔄 MCP Restart
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`);

        // Step 1: Read and optionally validate config
        const config = readMcpConfig();
        if (!config) {
            console.log('❌ Cannot proceed without valid config');
            process.exit(1);
        }

        console.log(`📋 Found ${Object.keys(config.mcpServers).length} MCP servers in config`);

        if (options.validate) {
            console.log('\n🔍 Validating config...');
            const { valid, errors } = validateConfig(config);

            if (!valid) {
                console.log('❌ Validation failed:');
                for (const error of errors) {
                    console.log(`   ${error}`);
                }
                if (!options.dryRun) {
                    console.log('\n⚠️ Fix these issues before restarting');
                    process.exit(1);
                }
            } else {
                console.log('✅ Config valid');
            }
        }

        // Step 2: Kill MCP processes
        console.log(`\n${options.dryRun ? '🔍 Dry run - ' : ''}Killing MCP processes...`);
        const killed = killMcpProcesses(options.dryRun);

        if (!options.dryRun) {
            console.log(`\n🧹 Killed ${killed} MCP process(es)`);
        }

        // Step 3: Restart or instruct
        if (options.killOnly) {
            console.log('\n✅ MCPs killed. Run `spidersan mcp-health --auto-restart` to restart them.');
        } else if (options.force) {
            console.log('');
            restartAntigravity();
        } else {
            console.log(`
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

🕷️ MCPs killed. To reconnect:

   Option 1: Restart Antigravity manually
   
   Option 2: Run with --force to auto-restart:
   $ spidersan mcp-restart --force

   Option 3: Just restart MCPs without Antigravity:
   $ spidersan mcp-health --auto-restart
`);
        }
    });
