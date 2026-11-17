/**
 * sp-poga — end to end, nothing mocked but process.exit: `conflicts --real` run
 * from a directory that is not a git repository.
 *
 * getCurrentBranch() throws there. It used to escape to the global
 * unhandledRejection handler: no JSON on stdout and exit 1, the "conflict" code.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, realpathSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { dirname, join } from 'path';
import { conflictsCommand } from '../src/commands/conflicts';

describe('conflicts --real outside a git repository', () => {
    let dir: string;
    let originalCwd: string;
    let ceiling: string | undefined;

    beforeEach(() => {
        originalCwd = process.cwd();
        dir = realpathSync(mkdtempSync(join(tmpdir(), 'ss-nongit-')));
        // Never discover a repository above the temp dir, wherever tmpdir() lives.
        ceiling = process.env.GIT_CEILING_DIRECTORIES;
        process.env.GIT_CEILING_DIRECTORIES = dirname(dir);
        process.chdir(dir);
    });

    afterEach(() => {
        process.chdir(originalCwd);
        if (ceiling === undefined) delete process.env.GIT_CEILING_DIRECTORIES;
        else process.env.GIT_CEILING_DIRECTORIES = ceiling;
        rmSync(dir, { recursive: true, force: true });
        vi.restoreAllMocks();
    });

    it('prints exactly one status "error" document and exits 2', async () => {
        const log = vi.spyOn(console, 'log').mockImplementation(() => {});
        vi.spyOn(console, 'error').mockImplementation(() => {});
        const exit = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
            throw new Error(`__exit:${code ?? 0}`);
        }) as never);
        (conflictsCommand as unknown as { _optionValues: Record<string, unknown> })._optionValues = { tier: '1' };

        await expect(
            conflictsCommand.parseAsync(['node', 'spidersan', 'conflicts', '--real', '--json', '--exit-code']),
        ).rejects.toThrow('__exit:2');

        expect(exit).toHaveBeenCalledTimes(1);
        const out = JSON.parse(log.mock.calls.map((c) => c.join(' ')).join('\n')); // throws on 0 or 2+ documents
        expect(out).toMatchObject({ status: 'error', pr: null, repo: null, results: [] });
        expect(out.errors).toHaveLength(1);
    });
});
