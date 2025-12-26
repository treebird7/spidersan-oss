/**
 * Spidersan Error Classes
 * 
 * Structured error types for consistent error handling.
 */

export class SpidersanError extends Error {
    constructor(message: string, public readonly code: string) {
        super(message);
        this.name = 'SpidersanError';
    }
}

export class StorageError extends SpidersanError {
    constructor(message: string, public readonly operation: string) {
        super(message, 'STORAGE_ERROR');
        this.name = 'StorageError';
    }
}

export class ConfigError extends SpidersanError {
    constructor(message: string) {
        super(message, 'CONFIG_ERROR');
        this.name = 'ConfigError';
    }
}

export class GitError extends SpidersanError {
    constructor(message: string) {
        super(message, 'GIT_ERROR');
        this.name = 'GitError';
    }
}

export class LicenseError extends SpidersanError {
    constructor(message: string) {
        super(message, 'LICENSE_ERROR');
        this.name = 'LicenseError';
    }
}

export class SupabaseError extends SpidersanError {
    constructor(message: string, public readonly hint?: string) {
        super(message, 'SUPABASE_ERROR');
        this.name = 'SupabaseError';
    }
}

/**
 * Format error for CLI output
 */
export function formatError(error: unknown): string {
    if (error instanceof SpidersanError) {
        let msg = `❌ ${error.message}`;
        if (error instanceof SupabaseError && error.hint) {
            msg += `\n   Hint: ${error.hint}`;
        }
        return msg;
    }
    if (error instanceof Error) {
        return `❌ ${error.message}`;
    }
    return `❌ Unknown error: ${String(error)}`;
}

/**
 * Handle CLI errors consistently
 */
export function handleError(error: unknown, exitCode = 1): never {
    console.error(formatError(error));
    process.exit(exitCode);
}
