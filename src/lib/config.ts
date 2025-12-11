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
        supabaseUrl?: string;
        supabaseKey?: string;
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
    },
};

const CONFIG_FILES = ['.spidersanrc', '.spidersanrc.json', '.spidersan.config.json'];

export async function loadConfig(basePath: string = process.cwd()): Promise<SpidersanConfig> {
    // Try each config file name
    for (const filename of CONFIG_FILES) {
        const configPath = join(basePath, filename);
        if (existsSync(configPath)) {
            try {
                const content = await readFile(configPath, 'utf-8');
                const userConfig = JSON.parse(content);
                return deepMerge(DEFAULT_CONFIG, userConfig);
            } catch (error) {
                console.warn(`Warning: Failed to parse ${filename}:`, error);
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
