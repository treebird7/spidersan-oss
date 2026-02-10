import { describe, it, expect, vi, beforeEach } from 'vitest';
import { conflictsCommand } from '../src/commands/conflicts';
import { execSync, execFileSync } from 'child_process';
import { getStorage } from '../src/storage/index';

// Mock child_process
vi.mock('child_process', () => ({
    execSync: vi.fn(),
    execFileSync: vi.fn(),
}));

// Mock storage
vi.mock('../src/storage/index', () => ({
    getStorage: vi.fn(),
}));

// Mock console to avoid clutter
global.console = {
    ...console,
    log: vi.fn(),
    error: vi.fn(),
};

// Mock process.exit
const mockExit = vi.spyOn(process, 'exit').mockImplementation((() => {}) as any);

describe('Security Vulnerability Reproduction: Command Injection', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should reproduce command injection in conflicts command', async () => {
        const mockStorage = {
            isInitialized: vi.fn().mockResolvedValue(true),
            get: vi.fn().mockImplementation(async (branch) => {
                if (branch === 'current-branch') {
                    return {
                        name: 'current-branch',
                        files: ['vulnerable.js; echo pwned; .js'],
                        status: 'active'
                    };
                }
                if (branch === 'other-branch') {
                    return {
                        name: 'other-branch',
                        files: ['vulnerable.js; echo pwned; .js'],
                        status: 'active'
                    };
                }
                return null;
            }),
            list: vi.fn().mockResolvedValue([
                {
                    name: 'current-branch',
                    files: ['vulnerable.js; echo pwned; .js'],
                    status: 'active'
                },
                {
                    name: 'other-branch',
                    files: ['vulnerable.js; echo pwned; .js'],
                    status: 'active'
                }
            ]),
        };

        (getStorage as any).mockResolvedValue(mockStorage);

        (execSync as any).mockImplementation((cmd: string) => {
            if (cmd.includes('git rev-parse --abbrev-ref HEAD')) {
                return 'current-branch';
            }
            return '';
        });

        // Invoke the command action via parseAsync
        // We simulate running: spidersan conflicts --semantic --branch current-branch
        // This triggers the semantic analysis path where execSync is called with file names
        await conflictsCommand.parseAsync(['node', 'spidersan', 'conflicts', '--semantic', '--branch', 'current-branch']);

        // Check if execFileSync was called with correct arguments (array) instead of execSync (string)
        // This confirms the vulnerability is fixed by avoiding shell interpolation

        expect(execFileSync).toHaveBeenCalledWith(
            'git',
            ['show', 'HEAD:vulnerable.js; echo pwned; .js'],
            expect.objectContaining({ encoding: 'utf-8' })
        );

        // Verify execSync is NOT called with the command string
        expect(execSync).not.toHaveBeenCalledWith(
            expect.stringContaining('git show HEAD:vulnerable.js; echo pwned'),
            expect.anything()
        );
    });
});
