import type { Command } from 'commander';
import { createRequire } from 'module';

interface EcosystemStatus {
    available: boolean;
    loaded: boolean;
    coreVersion?: string;
    ecosystemVersion?: string;
    requiredRange?: string;
    versionMismatch?: boolean;
    error?: string;
}

const require = createRequire(import.meta.url);
const status: EcosystemStatus = { available: false, loaded: false };

function readCoreVersion(): string | undefined {
    try {
        const pkg = require('../../package.json');
        return pkg.version as string | undefined;
    } catch {
        return undefined;
    }
}

function readEcosystemPackage(): { version?: string; peerDependencies?: Record<string, string> } | null {
    try {
        return require('spidersan-ecosystem/package.json') as {
            version?: string;
            peerDependencies?: Record<string, string>;
        };
    } catch {
        return null;
    }
}

function parseMajor(value: string): number | null {
    const match = value.match(/(\d+)/);
    if (!match) return null;
    const major = parseInt(match[1], 10);
    return Number.isNaN(major) ? null : major;
}

function isMajorMismatch(coreVersion?: string, requiredRange?: string): boolean {
    if (!coreVersion || !requiredRange) return false;
    const coreMajor = parseMajor(coreVersion);
    const requiredMajor = parseMajor(requiredRange);
    if (coreMajor === null || requiredMajor === null) return false;
    return coreMajor !== requiredMajor;
}

async function loadEcosystemModule(): Promise<unknown | null> {
    try {
        const module = await import('spidersan-ecosystem');
        status.available = true;
        const ecosystemPkg = readEcosystemPackage();
        status.coreVersion = readCoreVersion();
        status.ecosystemVersion = ecosystemPkg?.version;
        status.requiredRange = ecosystemPkg?.peerDependencies?.spidersan;
        status.versionMismatch = isMajorMismatch(status.coreVersion, status.requiredRange);
        return module;
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (!message.includes('Cannot find package')) {
            status.error = message;
        }
        return null;
    }
}

export async function loadEcosystemCommands(): Promise<Command[]> {
    const module = await loadEcosystemModule();
    if (!module) return [];
    const mod = module as { getCommands?: () => Command[] | Promise<Command[]>; default?: unknown };
    const getCommands = typeof mod.getCommands === 'function'
        ? mod.getCommands
        : typeof (mod.default as { getCommands?: unknown })?.getCommands === 'function'
            ? (mod.default as { getCommands: () => Command[] | Promise<Command[]> }).getCommands
            : null;
    if (!getCommands) return [];
    const commands = await getCommands();
    if (Array.isArray(commands)) {
        status.loaded = true;
        return commands;
    }
    return [];
}

export function getEcosystemStatus(): EcosystemStatus {
    return { ...status };
}
