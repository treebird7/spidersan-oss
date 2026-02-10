/**
 * Spidersan Configuration Loader
 * 
 * Loads and validates .spidersanrc configuration file.
 */

import { readFile } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

export interface SpidersanConfig {
    ecosystem: {
        enabled: boolean;
    };
    agent: {
        name?: string;
    };
    autoWatch: {
        enabled: boolean;
        paths: string[];
        hub: boolean;
        hubSync: boolean;
        quiet: boolean;
        legacy: boolean;
    };
    readyCheck: {
        enableWipDetection: boolean;
        wipPatterns: string[];
        excludeFiles: string[];
        enableExperimentalDetection: boolean;
        experimentalPatterns: string[];
        enableBuildCheck: boolean;
    };
    conflicts: {
        highSeverityPatterns: string[];
        mediumSeverityPatterns: string[];
    };
    storage: {
        type: 'local' | 'supabase';
        environment?: 'production' | 'staging' | 'local';
        supabaseUrl?: string;
        supabaseKey?: string;
        supabaseUrlStaging?: string;
        supabaseKeyStaging?: string;
    };
}

const DEFAULT_CONFIG: SpidersanConfig = {
    ecosystem: {
        enabled: true,
    },
    agent: {
        name: '',
    },
    autoWatch: {
        enabled: false,
        paths: [],
        hub: false,
        hubSync: false,
        quiet: false,
        legacy: false,
    },
    readyCheck: {
        enableWipDetection: true,
        wipPatterns: ['TODO', 'FIXME', 'WIP', 'HACK', 'XXX'],
        excludeFiles: ['tests/**', '*.test.js', '*.test.ts', '*.md', '**/docs/**', '**/package-lock.json', '**/yarn.lock', '**/pnpm-lock.yaml'],
        enableExperimentalDetection: false,
        experimentalPatterns: ['experimental/', 'test-'],
        enableBuildCheck: true,
    },
    conflicts: {
        highSeverityPatterns: ['package\\.json$', 'migrations/', '\\.env', 'middleware\\.', 'route\\.ts$'],
        mediumSeverityPatterns: ['components/ui/', 'lib/', 'hooks/', 'utils/'],
    },
    storage: {
        type: 'local',
        environment: 'production',
    },
};

export const CONFIG_FILES = ['.spidersanrc', '.spidersanrc.json', '.spidersan.config.json'];

interface ValidationError {
    path: string;
    message: string;
}

function validateConfig(config: unknown): ValidationError[] {
    const errors: ValidationError[] = [];

    if (typeof config !== 'object' || config === null) {
        errors.push({ path: '', message: 'Config must be an object' });
        return errors;
    }

    const obj = config as Record<string, unknown>;

    // Validate ecosystem
    if (obj.ecosystem !== undefined) {
        if (typeof obj.ecosystem !== 'object' || obj.ecosystem === null) {
            errors.push({ path: 'ecosystem', message: 'Must be an object' });
        } else {
            const eco = obj.ecosystem as Record<string, unknown>;
            if (eco.enabled !== undefined && typeof eco.enabled !== 'boolean') {
                errors.push({ path: 'ecosystem.enabled', message: 'Must be a boolean' });
            }
        }
    }

    // Validate readyCheck
    if (obj.readyCheck !== undefined) {
        if (typeof obj.readyCheck !== 'object' || obj.readyCheck === null) {
            errors.push({ path: 'readyCheck', message: 'Must be an object' });
        } else {
            const rc = obj.readyCheck as Record<string, unknown>;
            if (rc.wipPatterns !== undefined && !Array.isArray(rc.wipPatterns)) {
                errors.push({ path: 'readyCheck.wipPatterns', message: 'Must be an array of strings' });
            }
            if (rc.excludeFiles !== undefined && !Array.isArray(rc.excludeFiles)) {
                errors.push({ path: 'readyCheck.excludeFiles', message: 'Must be an array of strings' });
            }
            if (rc.enableWipDetection !== undefined && typeof rc.enableWipDetection !== 'boolean') {
                errors.push({ path: 'readyCheck.enableWipDetection', message: 'Must be a boolean' });
            }
        }
    }

    // Validate agent
    if (obj.agent !== undefined) {
        if (typeof obj.agent !== 'object' || obj.agent === null) {
            errors.push({ path: 'agent', message: 'Must be an object' });
        } else {
            const agent = obj.agent as Record<string, unknown>;
            if (agent.name !== undefined && typeof agent.name !== 'string') {
                errors.push({ path: 'agent.name', message: 'Must be a string' });
            }
        }
    }

    // Validate autoWatch
    if (obj.autoWatch !== undefined) {
        if (typeof obj.autoWatch !== 'object' || obj.autoWatch === null) {
            errors.push({ path: 'autoWatch', message: 'Must be an object' });
        } else {
            const aw = obj.autoWatch as Record<string, unknown>;
            if (aw.enabled !== undefined && typeof aw.enabled !== 'boolean') {
                errors.push({ path: 'autoWatch.enabled', message: 'Must be a boolean' });
            }
            if (aw.paths !== undefined) {
                if (!Array.isArray(aw.paths) || !aw.paths.every((p) => typeof p === 'string')) {
                    errors.push({ path: 'autoWatch.paths', message: 'Must be an array of strings' });
                }
            }
            if (aw.hub !== undefined && typeof aw.hub !== 'boolean') {
                errors.push({ path: 'autoWatch.hub', message: 'Must be a boolean' });
            }
            if (aw.hubSync !== undefined && typeof aw.hubSync !== 'boolean') {
                errors.push({ path: 'autoWatch.hubSync', message: 'Must be a boolean' });
            }
            if (aw.quiet !== undefined && typeof aw.quiet !== 'boolean') {
                errors.push({ path: 'autoWatch.quiet', message: 'Must be a boolean' });
            }
            if (aw.legacy !== undefined && typeof aw.legacy !== 'boolean') {
                errors.push({ path: 'autoWatch.legacy', message: 'Must be a boolean' });
            }
        }
    }

    // Validate storage
    if (obj.storage !== undefined) {
        if (typeof obj.storage !== 'object' || obj.storage === null) {
            errors.push({ path: 'storage', message: 'Must be an object' });
        } else {
            const st = obj.storage as Record<string, unknown>;
            if (st.type !== undefined && !['local', 'supabase'].includes(st.type as string)) {
                errors.push({ path: 'storage.type', message: 'Must be "local" or "supabase"' });
            }
            if (st.environment !== undefined && !['production', 'staging', 'local'].includes(st.environment as string)) {
                errors.push({ path: 'storage.environment', message: 'Must be "production", "staging", or "local"' });
            }
        }
    }

    return errors;
}

export function getConfigPaths(basePath: string = process.cwd(), includeGlobal: boolean = true): string[] {
    const paths: string[] = [];

    if (includeGlobal) {
        const home = homedir();
        CONFIG_FILES.forEach((filename) => paths.push(join(home, filename)));
    }

    CONFIG_FILES.forEach((filename) => paths.push(join(basePath, filename)));
    return paths;
}

export async function loadConfigWithSources(
    basePath: string = process.cwd(),
    options: { includeGlobal?: boolean } = {}
): Promise<{ config: SpidersanConfig; sources: string[]; errors: ValidationError[] }> {
    const includeGlobal = options.includeGlobal !== false;
    const sources: string[] = [];
    const errors: ValidationError[] = [];
    let merged: SpidersanConfig = DEFAULT_CONFIG;

    const configPaths = getConfigPaths(basePath, includeGlobal);
    for (const configPath of configPaths) {
        if (!existsSync(configPath)) continue;
        try {
            const content = await readFile(configPath, 'utf-8');
            const userConfig = JSON.parse(content);

            const validationErrors = validateConfig(userConfig);
            if (validationErrors.length > 0) {
                errors.push(...validationErrors.map(err => ({ ...err, path: `${configPath}:${err.path || ''}`.replace(/:$/, '') })));
            }

            merged = deepMerge(merged, userConfig);
            sources.push(configPath);
        } catch (error) {
            if (error instanceof SyntaxError) {
                errors.push({ path: configPath, message: `Invalid JSON: ${error.message}` });
            } else {
                errors.push({ path: configPath, message: 'Failed to read config file' });
            }
        }
    }

    return { config: merged, sources, errors };
}

export async function loadConfig(basePath: string = process.cwd()): Promise<SpidersanConfig> {
    const result = await loadConfigWithSources(basePath);
    if (result.errors.length > 0) {
        console.warn('⚠️  Config validation warnings:');
        result.errors.forEach(e => console.warn(`   ${e.path}: ${e.message}`));
    }
    return result.config;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function deepMerge(target: any, source: any): any {
    const result = { ...target };

    for (const key in source) {
        if (source[key] !== undefined) {
            if (typeof source[key] === 'object' && !Array.isArray(source[key]) && source[key] !== null) {
                result[key] = deepMerge(result[key] || {}, source[key]);
            } else {
                result[key] = source[key];
            }
        }
    }

    return result;
}

export function getWipPatterns(config: SpidersanConfig): RegExp[] {
    return config.readyCheck.wipPatterns.map(p => new RegExp(p, 'i'));
}

export function getExcludePatterns(config: SpidersanConfig): string[] {
    return config.readyCheck.excludeFiles;
}

export function getHighSeverityPatterns(config: SpidersanConfig): RegExp[] {
    return config.conflicts.highSeverityPatterns.map(p => new RegExp(p));
}

export function getMediumSeverityPatterns(config: SpidersanConfig): RegExp[] {
    return config.conflicts.mediumSeverityPatterns.map(p => new RegExp(p));
}
