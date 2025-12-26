/**
 * Spidersan Configuration Loader
 * 
 * Loads and validates .spidersanrc configuration file.
 */

import { readFile } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';

export interface SpidersanConfig {
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
    readyCheck: {
        enableWipDetection: true,
        wipPatterns: ['TODO', 'FIXME', 'WIP', 'HACK', 'XXX'],
        excludeFiles: ['tests/**', '*.test.js', '*.test.ts', '*.md', '**/docs/**'],
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

const CONFIG_FILES = ['.spidersanrc', '.spidersanrc.json', '.spidersan.config.json'];

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

export async function loadConfig(basePath: string = process.cwd()): Promise<SpidersanConfig> {
    // Try each config file name
    for (const filename of CONFIG_FILES) {
        const configPath = join(basePath, filename);
        if (existsSync(configPath)) {
            try {
                const content = await readFile(configPath, 'utf-8');
                const userConfig = JSON.parse(content);

                // Validate config
                const errors = validateConfig(userConfig);
                if (errors.length > 0) {
                    console.warn(`⚠️  Config validation warnings in ${filename}:`);
                    errors.forEach(e => console.warn(`   ${e.path}: ${e.message}`));
                }

                return deepMerge(DEFAULT_CONFIG, userConfig);
            } catch (error) {
                if (error instanceof SyntaxError) {
                    console.error(`❌ Invalid JSON in ${filename}: ${error.message}`);
                    console.error('   Using default configuration instead.');
                } else {
                    console.warn(`Warning: Failed to read ${filename}:`, error);
                }
            }
        }
    }

    // Return defaults if no config found
    return DEFAULT_CONFIG;
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
