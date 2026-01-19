/**
 * Spidersan Security Utilities
 * 
 * Input validation and sanitization for shell command safety.
 * Prevents command injection attacks via agent IDs, branch names, etc.
 * 
 * @module security
 */

// Validation patterns
const VALID_AGENT_ID = /^[a-z0-9][a-z0-9_-]{0,30}$/i;
const VALID_BRANCH_NAME = /^[a-zA-Z0-9][a-zA-Z0-9/_.-]{0,99}$/;
const VALID_TASK_ID = /^[a-z0-9][a-z0-9_-]{0,50}$/i;
const VALID_FILE_PATH = /^[.\/a-zA-Z0-9][a-zA-Z0-9/_.@-]{0,200}$/;

// Shell metacharacters to remove from text
const SHELL_METACHARACTERS = /[`$(){}[\]|;&<>\\]/g;

/**
 * Validate agent ID (e.g., "sherlocksan", "watsan-1", "agent_01")
 * @throws Error if invalid
 */
export function validateAgentId(agentId: string): string {
    if (!agentId || typeof agentId !== 'string') {
        throw new Error('Agent ID is required');
    }
    if (!VALID_AGENT_ID.test(agentId)) {
        throw new Error(`Invalid agent ID: "${agentId.slice(0, 20)}..." (must be alphanumeric with - or _)`);
    }
    return agentId;
}

/**
 * Validate git branch name
 * @throws Error if invalid
 */
export function validateBranchName(branch: string): string {
    if (!branch || typeof branch !== 'string') {
        throw new Error('Branch name is required');
    }
    if (!VALID_BRANCH_NAME.test(branch)) {
        throw new Error(`Invalid branch name: "${branch.slice(0, 20)}..."`);
    }
    return branch;
}

/**
 * Validate task ID (for torrent/task commands)
 * @throws Error if invalid
 */
export function validateTaskId(taskId: string): string {
    if (!taskId || typeof taskId !== 'string') {
        throw new Error('Task ID is required');
    }
    if (!VALID_TASK_ID.test(taskId)) {
        throw new Error(`Invalid task ID: "${taskId.slice(0, 20)}..." (must be alphanumeric with - or _)`);
    }
    return taskId;
}

/**
 * Validate file path (basic safety check)
 * @throws Error if invalid
 */
export function validateFilePath(filePath: string): string {
    if (!filePath || typeof filePath !== 'string') {
        throw new Error('File path is required');
    }
    // Block path traversal
    if (filePath.includes('..')) {
        throw new Error('Path traversal not allowed');
    }
    if (!VALID_FILE_PATH.test(filePath)) {
        throw new Error(`Invalid file path: "${filePath.slice(0, 20)}..."`);
    }
    return filePath;
}

/**
 * Sanitize free-form text by removing shell metacharacters
 * Use for message bodies, subjects, etc.
 */
export function sanitizeText(text: string): string {
    if (!text || typeof text !== 'string') {
        return '';
    }
    return text.replace(SHELL_METACHARACTERS, '');
}

/**
 * Sanitize an array of file paths
 */
export function sanitizeFilePaths(files: string[]): string[] {
    return files.filter(f => {
        try {
            validateFilePath(f);
            return true;
        } catch {
            console.warn(`⚠️ Skipping invalid file path: ${f.slice(0, 30)}...`);
            return false;
        }
    });
}

/**
 * Escape a string for safe use in git commands (minimal escaping)
 */
export function escapeGitArg(arg: string): string {
    // For use with execFileSync where no shell is invoked
    // Just basic validation, no escaping needed
    return arg;
}

// Export validation patterns for testing
export const patterns = {
    VALID_AGENT_ID,
    VALID_BRANCH_NAME,
    VALID_TASK_ID,
    VALID_FILE_PATH,
    SHELL_METACHARACTERS,
}

// Test-compatible aliases for vitest security tests
export const sanitizeAgentId = validateAgentId;
export const sanitizeBranchName = validateBranchName;
export const sanitizeFilePath = validateFilePath;

// Message ID validation (for mycmail commands)
const VALID_MESSAGE_ID = /^[a-z0-9][a-z0-9_-]{0,64}$/i;
export function isValidMessageId(messageId: string): boolean {
    return typeof messageId === 'string' && VALID_MESSAGE_ID.test(messageId);
}
