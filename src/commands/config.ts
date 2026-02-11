/**
 * spidersan config
 *
 * Manage Spidersan configuration (.spidersanrc).
 */

import { Command } from 'commander';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { createInterface } from 'readline/promises';
import { stdin as input, stdout as output } from 'process';
import { CONFIG_FILES, loadConfigWithSources } from '../lib/config.js';

const DEFAULT_CONFIG_FILENAME = CONFIG_FILES[0];

type Scope = 'local' | 'global';

function resolveScope(options: { global?: boolean }): Scope {
    return options.global ? 'global' : 'local';
}

function getScopeBasePath(scope: Scope): string {
    return scope === 'global' ? homedir() : process.cwd();
}

function findExistingConfigPath(scope: Scope): string | null {
    const base = getScopeBasePath(scope);
    for (const filename of CONFIG_FILES) {
        const candidate = join(base, filename);
        if (existsSync(candidate)) return candidate;
    }
    return null;
}

function resolveWritableConfigPath(scope: Scope): string {
    return findExistingConfigPath(scope) ?? join(getScopeBasePath(scope), DEFAULT_CONFIG_FILENAME);
}

function readConfigFile(path: string): Record<string, unknown> {
    if (!existsSync(path)) return {};
    try {
        const content = readFileSync(path, 'utf-8');
        return JSON.parse(content) as Record<string, unknown>;
    } catch {
        return {};
    }
}

function writeConfigFile(path: string, config: Record<string, unknown>, force: boolean = false): void {
    if (existsSync(path) && !force) {
        throw new Error(`Config file already exists: ${path}`);
    }
    const content = JSON.stringify(config, null, 2) + '\n';
    writeFileSync(path, content, 'utf-8');
}

function parseValue(raw: string): unknown {
    const trimmed = raw.trim();
    if (trimmed === 'true') return true;
    if (trimmed === 'false') return false;
    if (trimmed === 'null') return null;
    if (trimmed === 'undefined') return undefined;
    try {
        return JSON.parse(trimmed);
    } catch {
        return raw;
    }
}

function setNestedValue(obj: Record<string, unknown>, path: string, value: unknown): void {
    const parts = path.split('.').filter(Boolean);
    if (parts.length === 0) return;

    // Security: Prevent prototype pollution
    if (parts.some(p => p === '__proto__' || p === 'constructor' || p === 'prototype')) {
        throw new Error('Invalid config path: contains forbidden keys');
    }

    let current: Record<string, unknown> = obj;
    for (let i = 0; i < parts.length - 1; i++) {
        const key = parts[i];
        const next = current[key];
        if (typeof next !== 'object' || next === null || Array.isArray(next)) {
            current[key] = {};
        }
        current = current[key] as Record<string, unknown>;
    }
    current[parts[parts.length - 1]] = value as never;
}

function getNestedValue(obj: unknown, path: string): unknown {
    const parts = path.split('.').filter(Boolean);
    let current: unknown = obj;
    for (const part of parts) {
        // Security: Prevent accessing prototype properties
        if (part === '__proto__' || part === 'constructor' || part === 'prototype') return undefined;

        if (typeof current !== 'object' || current === null) return undefined;
        current = (current as Record<string, unknown>)[part];
    }
    return current;
}

function isEnvDisabled(value?: string): boolean {
    if (!value) return false;
    return ['0', 'false', 'no', 'off'].includes(value.toLowerCase());
}

function upsertEnvVar(content: string, key: string, value: string): string {
    const line = `${key}=${value}`;
    const regex = new RegExp(`^${key}=.*$`, 'm');
    if (regex.test(content)) {
        return content.replace(regex, line);
    }
    const trimmed = content.replace(/\s*$/, '');
    const suffix = trimmed.length > 0 ? '\n' : '';
    return `${trimmed}${suffix}${line}\n`;
}

async function writeSupabaseEnv(envPath: string, url: string, key: string): Promise<void> {
    let content = '';
    if (existsSync(envPath)) {
        content = readFileSync(envPath, 'utf-8');
    }
    content = upsertEnvVar(content, 'SUPABASE_URL', url);
    content = upsertEnvVar(content, 'SUPABASE_KEY', key);
    writeFileSync(envPath, content, 'utf-8');
}

async function runWizard(): Promise<void> {
    const rl = createInterface({ input, output });

    const ask = async (prompt: string): Promise<string> => {
        const answer = await rl.question(prompt);
        return answer.trim();
    };

    const askYesNo = async (prompt: string, defaultValue: boolean): Promise<boolean> => {
        const suffix = defaultValue ? 'Y/n' : 'y/N';
        const answer = (await ask(`${prompt} (${suffix}): `)).toLowerCase();
        if (!answer) return defaultValue;
        return ['y', 'yes'].includes(answer);
    };

    const askChoice = async (prompt: string, choices: string[], defaultValue: string): Promise<string> => {
        const label = choices.join('/');
        const answer = await ask(`${prompt} (${label}) [${defaultValue}]: `);
        if (!answer) return defaultValue;
        const normalized = answer.toLowerCase();
        const match = choices.find(c => c.toLowerCase() === normalized);
        return match ?? defaultValue;
    };

    try {
        console.log('🕷️ Spidersan Config Wizard');
        const scopeChoice = await askChoice('Save config locally or globally?', ['local', 'global'], 'local');
        const scope: Scope = scopeChoice === 'global' ? 'global' : 'local';
        const configPath = resolveWritableConfigPath(scope);
        if (existsSync(configPath)) {
            const overwrite = await askYesNo(`Config exists at ${configPath}. Overwrite?`, false);
            if (!overwrite) {
                console.log('ℹ️  Wizard cancelled (no changes made).');
                return;
            }
        }

        const agentName = await ask('Default agent name (optional): ');
        const ecosystemEnabled = await askYesNo('Enable ecosystem commands?', true);
        const storageType = await askChoice('Storage type', ['local', 'supabase'], 'local');
        let environment: string = 'production';

        if (storageType === 'supabase') {
            environment = await askChoice('Supabase environment', ['production', 'staging', 'local'], 'production');
        }

        const autoWatchEnabled = await askYesNo('Enable auto-watch shortcuts?', false);
        let autoWatchPaths: string[] = [];
        if (autoWatchEnabled) {
            const rawPaths = await ask('Auto-watch paths (comma-separated): ');
            autoWatchPaths = rawPaths
                .split(',')
                .map((p) => p.trim())
                .filter(Boolean);
            if (autoWatchPaths.length === 0) {
                console.log('ℹ️  No paths provided; auto-watch will remain disabled.');
            }
        }

        const config: Record<string, unknown> = {
            agent: { name: agentName || undefined },
            ecosystem: { enabled: ecosystemEnabled },
            storage: {
                type: storageType,
                environment,
            },
            autoWatch: {
                enabled: autoWatchEnabled && autoWatchPaths.length > 0,
                paths: autoWatchPaths,
                hub: false,
                hubSync: false,
                quiet: false,
                legacy: false,
            },
        };

        writeConfigFile(configPath, config, true);
        console.log(`✅ Config saved to ${configPath}`);

        if (storageType === 'supabase') {
            const envPath = join(process.cwd(), '.env');
            const writeEnv = await askYesNo(`Write SUPABASE_URL/KEY to ${envPath}?`, true);
            if (writeEnv) {
                const url = await ask('SUPABASE_URL: ');
                const key = await ask('SUPABASE_KEY: ');
                await writeSupabaseEnv(envPath, url, key);
                console.log(`✅ Updated ${envPath}`);
            } else {
                console.log('ℹ️  Skipped writing .env (set SUPABASE_URL/SUPABASE_KEY manually).');
            }
        }
    } finally {
        rl.close();
    }
}

export const configCommand = new Command('config')
    .description('View and edit Spidersan configuration');

// Export for testing
export const _testable = {
    setNestedValue,
    getNestedValue,
};

async function printConfig(options: { json?: boolean } = {}): Promise<void> {
    const result = await loadConfigWithSources();
    const envDisable = isEnvDisabled(process.env.SPIDERSAN_ECOSYSTEM) ||
        isEnvDisabled(process.env.SPIDERSAN_CORE_ONLY);
    const envSupabaseUrl = process.env.SUPABASE_URL;
    const envSupabaseKey = process.env.SUPABASE_KEY;

    if (options.json) {
        const payload = {
            config: result.config,
            sources: result.sources,
            ecosystem: {
                enabled: result.config.ecosystem.enabled && !envDisable,
                disabledByEnv: envDisable,
            },
            supabase: {
                envConfigured: Boolean(envSupabaseUrl && envSupabaseKey),
            },
        };
        console.log(JSON.stringify(payload, null, 2));
        return;
    }

    console.log('Spidersan Configuration');
    if (result.sources.length === 0) {
        console.log('  Sources: defaults only');
    } else {
        console.log('  Sources:');
        result.sources.forEach((source) => console.log(`   - ${source}`));
    }

    if (result.errors.length > 0) {
        console.log('  Warnings:');
        result.errors.forEach((err) => console.log(`   - ${err.path}: ${err.message}`));
    }

    console.log(`  Ecosystem: ${result.config.ecosystem.enabled && !envDisable ? 'enabled' : 'disabled'}`);
    if (envDisable) {
        console.log('   - disabled by environment override');
    }

    const agentName = result.config.agent.name?.trim();
    console.log(`  Agent: ${agentName ? agentName : 'not set'}`);

    const autoWatch = result.config.autoWatch;
    const autoStatus = autoWatch.enabled ? 'enabled' : 'disabled';
    const autoCount = autoWatch.paths.length;
    console.log(`  Auto Watch: ${autoStatus} (${autoCount} path${autoCount === 1 ? '' : 's'})`);

    console.log(`  Storage: ${result.config.storage.type} (${result.config.storage.environment ?? 'production'})`);
    console.log(`  Supabase env: ${envSupabaseUrl && envSupabaseKey ? 'configured' : 'not set'}`);
}

configCommand
    .option('--json', 'Output as JSON')
    .action(async (options) => {
        await printConfig(options);
    });

configCommand
    .command('show')
    .description('Show resolved configuration')
    .option('--json', 'Output as JSON')
    .action(async (options) => {
        await printConfig(options);
    });

configCommand
    .command('get <path>')
    .description('Get a config value (dot path)')
    .action(async (path: string) => {
        const result = await loadConfigWithSources();
        const value = getNestedValue(result.config, path);
        if (value === undefined) {
            console.log('undefined');
        } else if (typeof value === 'string') {
            console.log(value);
        } else {
            console.log(JSON.stringify(value, null, 2));
        }
    });

configCommand
    .command('set <path> <value>')
    .description('Set a config value (dot path)')
    .option('--global', 'Write to global config (~/.spidersanrc)')
    .action(async (path: string, value: string, options: { global?: boolean }) => {
        const scope = resolveScope(options);
        const configPath = resolveWritableConfigPath(scope);
        const config = readConfigFile(configPath);
        setNestedValue(config, path, parseValue(value));
        const content = JSON.stringify(config, null, 2) + '\n';
        writeFileSync(configPath, content, 'utf-8');
        console.log(`✅ Updated ${configPath}`);
    });

configCommand
    .command('init')
    .description('Create a minimal config file')
    .option('--global', 'Write to global config (~/.spidersanrc)')
    .option('--force', 'Overwrite if config already exists')
    .action((options: { global?: boolean; force?: boolean }) => {
        const scope = resolveScope(options);
        const configPath = resolveWritableConfigPath(scope);
        const config: Record<string, unknown> = {
            agent: { name: '' },
            ecosystem: { enabled: true },
            storage: { type: 'local', environment: 'production' },
            autoWatch: {
                enabled: false,
                paths: [],
                hub: false,
                hubSync: false,
                quiet: false,
                legacy: false,
            },
        };
        writeConfigFile(configPath, config, Boolean(options.force));
        console.log(`✅ Config initialized at ${configPath}`);
    });

configCommand
    .command('wizard')
    .alias('setup')
    .description('Interactive setup wizard')
    .action(async () => {
        await runWizard();
    });
