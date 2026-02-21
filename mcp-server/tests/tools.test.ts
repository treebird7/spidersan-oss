import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { mkdtemp, writeFile, mkdir, rm, chmod } from 'fs/promises';
import { tmpdir } from 'os';
import { dirname, resolve, join } from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const TEST_BRANCH = `test-branch-${Date.now()}`;
const TEST_FILES = ['src/test-file.ts'];

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..');
const serverPath = resolve(here, '..', 'dist', 'server.js');
const cliPath = resolve(repoRoot, 'dist', 'bin', 'spidersan.js');

let transport: StdioClientTransport;
let client: Client;
let repoDir: string;
let homeDir: string;
let binDir: string;

function unique(prefix: string) {
    return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function getText(result: any): string {
    return (result?.content ?? [])
        .filter((item: any) => item?.type === 'text' && typeof item.text === 'string')
        .map((item: any) => item.text)
        .join('\n');
}

function tryParseJson(text: string) {
    try {
        return JSON.parse(text);
    } catch {
        return null;
    }
}

async function callTool(name: string, args: Record<string, unknown> = {}) {
    const result = await client.callTool({ name, arguments: args });
    const text = getText(result);
    return { result, text, json: tryParseJson(text) };
}

describe.sequential('MCP tools integration', () => {
    beforeAll(async () => {
        repoDir = await mkdtemp(join(tmpdir(), 'spidersan-mcp-repo-'));
        homeDir = await mkdtemp(join(tmpdir(), 'spidersan-mcp-home-'));

        execSync('git init -b main', { cwd: repoDir, stdio: 'ignore' });
        execSync('git config user.email "test@example.com"', { cwd: repoDir });
        execSync('git config user.name "Test User"', { cwd: repoDir });

        await mkdir(join(repoDir, 'src'), { recursive: true });
        await writeFile(join(repoDir, 'README.md'), '# Test Repo\n');
        await writeFile(join(repoDir, 'src', 'test-file.ts'), 'export const test = 1;\n');

        execSync('git add .', { cwd: repoDir });
        execSync('git commit -m "init"', { cwd: repoDir, stdio: 'ignore' });

        binDir = join(repoDir, 'bin');
        await mkdir(binDir, { recursive: true });
        const scriptPath = join(binDir, 'spidersan');
        const script = `#!/usr/bin/env sh\nexec "${process.execPath}" "${cliPath}" "$@"\n`;
        await writeFile(scriptPath, script, { mode: 0o755 });
        await chmod(scriptPath, 0o755);

        transport = new StdioClientTransport({
            command: process.execPath,
            args: [serverPath],
            cwd: repoDir,
            env: {
                PATH: `${binDir}:${process.env.PATH ?? ''}`,
                HOME: homeDir,
            },
            stderr: 'pipe',
        });

        client = new Client(
            { name: 'spidersan-mcp-tests', version: '0.0.0' },
            { capabilities: {} }
        );

        await client.connect(transport);
    });

    afterAll(async () => {
        if (transport) {
            await transport.close();
        }
        if (repoDir) {
            await rm(repoDir, { recursive: true, force: true });
        }
        if (homeDir) {
            await rm(homeDir, { recursive: true, force: true });
        }
    });

    it('welcome returns structured data', async () => {
        const { result, text } = await callTool('welcome', { demo: false });
        expect(Array.isArray(result.content)).toBe(true);
        expect(text).toContain('SPIDERSAN WELCOMES YOU');
    });

    it('list_tools returns 22 items', async () => {
        const { text } = await callTool('list_tools');
        expect(text).toContain('Total: 22 tools available');
    });

    it('register_branch creates entry', async () => {
        const { text } = await callTool('register_branch', {
            branch: TEST_BRANCH,
            files: TEST_FILES,
            description: 'integration test registration',
            agent: 'tester',
            repo: 'mcp-server-tests',
        });
        expect(text).toMatch(/Registered|Updated/);

        const info = await callTool('get_branch_info', { branch: TEST_BRANCH });
        expect(info.text).toContain(`Branch: ${TEST_BRANCH}`);
    });

    it('get_branch_info retrieves data', async () => {
        const branch = unique('info');
        await callTool('register_branch', { branch, files: TEST_FILES, agent: 'tester' });

        const { text } = await callTool('get_branch_info', { branch });
        expect(text).toContain(`Branch: ${branch}`);
        expect(text).toContain('Status:');
    });

    it('mark_merged updates status', async () => {
        const branch = unique('merged');
        await callTool('register_branch', { branch, files: TEST_FILES, agent: 'tester' });

        await callTool('mark_merged', { branch });
        const { text } = await callTool('get_branch_info', { branch });
        expect(text).toMatch(/Status:\s+completed/);
    });

    it('mark_abandoned updates status', async () => {
        const branch = unique('abandoned');
        await callTool('register_branch', { branch, files: TEST_FILES, agent: 'tester' });

        await callTool('mark_abandoned', { branch });
        const { text } = await callTool('get_branch_info', { branch });
        expect(text).toMatch(/Status:\s+abandoned/);
    });

    it('list_branches returns active list', async () => {
        const branch = unique('list');
        await callTool('register_branch', { branch, files: TEST_FILES, agent: 'tester' });

        const { text } = await callTool('list_branches', { status: 'active' });
        expect(text).toContain(branch);
    });

    it('check_conflicts detects overlapping files', async () => {
        const file = `src/conflict-${Date.now()}.ts`;
        const branchA = unique('conflict-a');
        const branchB = unique('conflict-b');

        await callTool('register_branch', { branch: branchA, files: [file], agent: 'alpha' });
        await callTool('register_branch', { branch: branchB, files: [file], agent: 'beta' });

        const { text } = await callTool('check_conflicts');
        expect(text).toContain(file);
    });

    it('get_merge_order returns order', async () => {
        const branch = unique('order');
        await callTool('register_branch', { branch, files: [`src/${branch}.ts`], agent: 'order' });

        const { text } = await callTool('get_merge_order');
        expect(text).toContain('Recommended merge order');
        expect(text).toContain(branch);
    });

    it('ready_check returns JSON payload', async () => {
        const currentBranch = execSync('git branch --show-current', { cwd: repoDir, encoding: 'utf-8' }).trim();
        await callTool('register_branch', { branch: currentBranch, files: TEST_FILES, agent: 'tester' });

        const { json, text } = await callTool('ready_check', { branch: currentBranch, target: 'main' });
        const payload = json ?? tryParseJson(text);
        expect(payload).toBeTruthy();
        expect(typeof payload.ready).toBe('boolean');
    });

    it('branch_status returns branch list', async () => {
        const branch = unique('status');
        await callTool('register_branch', { branch, files: [`src/${branch}.ts`], agent: 'status' });

        const { json, text } = await callTool('branch_status', { includeStale: true });
        const payload = json ?? tryParseJson(text);
        expect(payload).toBeTruthy();
        expect(Array.isArray(payload.branches)).toBe(true);
        expect(typeof payload.count).toBe('number');
    });

    it('request_resolution and release_resolution work', async () => {
        const branch = unique('resolve');
        await callTool('register_branch', { branch, files: [`src/${branch}.ts`], agent: 'resolver' });

        const request = await callTool('request_resolution', { branch, agent: 'resolver' });
        expect(request.json?.success).toBe(true);
        expect(request.json?.claimedBy).toBe('resolver');

        const release = await callTool('release_resolution', { branch, agent: 'resolver' });
        expect(release.json?.released).toBe(true);
    });

    it('lock_files and unlock_files manage locks', async () => {
        const file = `src/lock-${Date.now()}.ts`;
        const lock = await callTool('lock_files', {
            files: [file],
            agent: 'locker',
            reason: 'integration test',
            ttl: 1,
        });
        expect(lock.json?.success).toBe(true);
        expect(lock.json?.lockToken).toBeTruthy();

        const unlock = await callTool('unlock_files', { files: [file], agent: 'locker' });
        expect(typeof unlock.json?.released).toBe('number');
        expect(unlock.json?.released).toBeGreaterThan(0);
    });

    it('who_owns reports ownership', async () => {
        const file = `src/owner-${Date.now()}.ts`;
        const branch = unique('owner');
        await callTool('register_branch', { branch, files: [file], agent: 'owner' });

        const { json } = await callTool('who_owns', { files: [file] });
        expect(json?.queried).toBe(1);
        expect(Array.isArray(json?.results)).toBe(true);
        expect(json?.results?.[0]?.file).toBe(file);
        expect(json?.results?.[0]?.owners).toContain('owner');
    });

    it('intent_scan detects conflicts', async () => {
        const file = `src/intent-${Date.now()}.ts`;
        const branch = unique('intent');
        await callTool('register_branch', { branch, files: [file], agent: 'other' });

        const { json } = await callTool('intent_scan', {
            files: [file],
            agent: 'self',
            taskId: 'wave4-integration-tests-002',
        });
        expect(Array.isArray(json?.conflicts)).toBe(true);
        expect(json?.conflicts?.length).toBeGreaterThan(0);
    });

    it('git_merge dry-run works', async () => {
        const branch = unique('merge');
        execSync(`git branch ${branch}`, { cwd: repoDir, stdio: 'ignore' });

        const { json, text } = await callTool('git_merge', {
            source: branch,
            target: 'main',
            strategy: 'merge',
            dryRun: true,
        });
        const payload = json ?? tryParseJson(text);
        expect(payload?.dryRun).toBe(true);
        expect(payload?.wouldMerge?.source).toBe(branch);
    });

    it('git_commit_and_push errors on no changes', async () => {
        const { json, text } = await callTool('git_commit_and_push', {
            files: [],
            message: 'test: no-op commit',
            autoMessage: false,
        });
        const payload = json ?? tryParseJson(text);
        expect(payload?.success).toBe(false);
    });

    it('create_pr validates inputs', async () => {
        const { json, text } = await callTool('create_pr', {
            branch: 'main',
            target: 'main',
            draft: true,
        });
        const payload = json ?? tryParseJson(text);
        expect(payload?.success).toBe(false);
        expect(String(payload?.error ?? '')).toContain('Source and target branches must be different');
    });

    it('start_watch and stop_watch respond', async () => {
        const start = await callTool('start_watch', {
            agent: 'watcher',
            dir: '.',
            hub: false,
            quiet: true,
        });
        expect(start.text).toContain('Watch mode started');

        const stop = await callTool('stop_watch');
        expect(stop.text).toMatch(/Watch mode stopped|No watch process found/);
    });
});
