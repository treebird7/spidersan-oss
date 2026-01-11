/**
 * Shared Agent Error Logging Utility
 * 
 * Logs errors to ~/.agent-errors/ with rotation.
 * Used by all Treebird agents for centralized error tracking.
 * 
 * @module agent-errors
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const AGENT_ERRORS_DIR = path.join(os.homedir(), '.agent-errors');
const MAX_LOG_SIZE = 1024 * 1024; // 1MB per log file
const MAX_LOG_FILES = 10; // Keep 10 rotated files

export interface AgentError {
    timestamp: string;
    agent: string;
    context: string;
    error: string;
    stack?: string;
    metadata?: Record<string, unknown>;
}

/**
 * Ensure the agent errors directory exists
 */
function ensureErrorsDir(): void {
    if (!fs.existsSync(AGENT_ERRORS_DIR)) {
        fs.mkdirSync(AGENT_ERRORS_DIR, { recursive: true });
    }
}

/**
 * Rotate log file if it exceeds MAX_LOG_SIZE
 */
function rotateLogIfNeeded(logPath: string): void {
    if (!fs.existsSync(logPath)) return;

    const stats = fs.statSync(logPath);
    if (stats.size < MAX_LOG_SIZE) return;

    // Rotate existing files
    for (let i = MAX_LOG_FILES - 1; i >= 1; i--) {
        const oldPath = `${logPath}.${i}`;
        const newPath = `${logPath}.${i + 1}`;
        if (fs.existsSync(oldPath)) {
            if (i === MAX_LOG_FILES - 1) {
                fs.unlinkSync(oldPath); // Delete oldest
            } else {
                fs.renameSync(oldPath, newPath);
            }
        }
    }

    // Rotate current log
    fs.renameSync(logPath, `${logPath}.1`);
}

/**
 * Log an error to the agent errors directory
 */
export function logAgentError(
    agent: string,
    context: string,
    error: Error | string,
    metadata?: Record<string, unknown>
): void {
    try {
        ensureErrorsDir();

        const logPath = path.join(AGENT_ERRORS_DIR, `${agent}.log`);
        rotateLogIfNeeded(logPath);

        const entry: AgentError = {
            timestamp: new Date().toISOString(),
            agent,
            context,
            error: error instanceof Error ? error.message : error,
            stack: error instanceof Error ? error.stack : undefined,
            metadata
        };

        const line = JSON.stringify(entry) + '\n';
        fs.appendFileSync(logPath, line);
    } catch {
        // Silently fail - don't let error logging cause more errors
        console.error(`[agent-errors] Failed to log error for ${agent}`);
    }
}

/**
 * Read recent errors for an agent
 */
export function readAgentErrors(agent: string, limit = 10): AgentError[] {
    try {
        const logPath = path.join(AGENT_ERRORS_DIR, `${agent}.log`);
        if (!fs.existsSync(logPath)) return [];

        const content = fs.readFileSync(logPath, 'utf-8');
        const lines = content.trim().split('\n').filter(l => l);

        return lines
            .slice(-limit)
            .map(line => JSON.parse(line) as AgentError)
            .reverse();
    } catch {
        return [];
    }
}

/**
 * Read all agent errors (summary)
 */
export function getAllAgentErrors(limit = 5): Record<string, AgentError[]> {
    try {
        ensureErrorsDir();

        const files = fs.readdirSync(AGENT_ERRORS_DIR)
            .filter(f => f.endsWith('.log') && !f.includes('.log.'));

        const result: Record<string, AgentError[]> = {};

        for (const file of files) {
            const agent = file.replace('.log', '');
            result[agent] = readAgentErrors(agent, limit);
        }

        return result;
    } catch {
        return {};
    }
}

/**
 * Wrapper for MCP calls with error logging
 */
export async function withErrorLogging<T>(
    agent: string,
    context: string,
    fn: () => Promise<T>,
    metadata?: Record<string, unknown>
): Promise<T> {
    try {
        return await fn();
    } catch (error) {
        logAgentError(agent, context, error as Error, metadata);
        throw error;
    }
}

/**
 * Get error log file path for an agent
 */
export function getErrorLogPath(agent: string): string {
    return path.join(AGENT_ERRORS_DIR, `${agent}.log`);
}

/**
 * Clear all errors for an agent
 */
export function clearAgentErrors(agent: string): boolean {
    try {
        const logPath = getErrorLogPath(agent);
        if (fs.existsSync(logPath)) {
            fs.unlinkSync(logPath);
        }
        return true;
    } catch {
        return false;
    }
}
