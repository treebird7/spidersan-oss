/**
 * spidersan claim / release / whos-here
 *
 * Git-grammar coord-pair on top of the same registry `watch` already writes
 * to. `claim`/`release` are absolute, last-writer-wins — no negotiation, no
 * CRDT, just a ground-truth stamp of "who has this file right now" (mirrors
 * `git add`/`git reset`: stage an intent, unstage it).
 *
 * An agent never needs to call these directly — `watch` calls the same
 * claim logic automatically on every registered file change, so an agent
 * that's never heard of spidersan still shows up in `claims`. These commands
 * exist for an agent (or a human) that IS aware and wants to claim ahead of
 * editing, or to inspect who else is active.
 */

import { Command } from 'commander';
import { getStorage } from '../storage/index.js';
import { getCurrentBranch } from '../lib/git.js';
import { validateAgentId, validateFilePath } from '../lib/security.js';

export function mergeClaims(
    existing: Record<string, { agent: string; at: string }> | undefined,
    files: string[],
    agent: string,
    at: string = new Date().toISOString(),
): Record<string, { agent: string; at: string }> {
    const merged = { ...existing };
    for (const file of files) {
        merged[file] = { agent, at };
    }
    return merged;
}

async function claimFiles(files: string[], agent: string): Promise<void> {
    const storage = await getStorage();
    if (!await storage.isInitialized()) {
        console.error('❌ Spidersan not initialized. Run: spidersan init');
        process.exit(1);
    }
    files.forEach(validateFilePath);
    validateAgentId(agent);

    const branch = getCurrentBranch();
    const existing = await storage.get(branch);
    const claims = mergeClaims(existing?.claims, files, agent);
    const allFiles = existing ? [...new Set([...existing.files, ...files])] : files;

    if (existing) {
        await storage.update(branch, { files: allFiles, agent, claims });
    } else {
        await storage.register({ name: branch, files: allFiles, status: 'active', agent, claims });
    }

    console.log(`🕷️ Claimed on \`${branch}\` as ${agent}: ${files.join(', ')}`);
}

async function releaseFiles(files: string[], agent: string): Promise<void> {
    const storage = await getStorage();
    if (!await storage.isInitialized()) {
        console.error('❌ Spidersan not initialized. Run: spidersan init');
        process.exit(1);
    }
    files.forEach(validateFilePath);
    validateAgentId(agent);

    const branch = getCurrentBranch();
    const existing = await storage.get(branch);
    if (!existing?.claims) {
        console.log(`🕷️ Nothing claimed on \`${branch}\` — nothing to release.`);
        return;
    }

    const claims = { ...existing.claims };
    let released = 0;
    for (const file of files) {
        // Absolute/ground-truth: only the claiming agent can release its own claim.
        if (claims[file]?.agent === agent) {
            delete claims[file];
            released++;
        }
    }

    await storage.update(branch, { claims });
    console.log(`🕷️ Released ${released}/${files.length} claim(s) on \`${branch}\` for ${agent}.`);
}

async function whosHere(file: string | undefined): Promise<void> {
    const storage = await getStorage();
    if (!await storage.isInitialized()) {
        console.error('❌ Spidersan not initialized. Run: spidersan init');
        process.exit(1);
    }

    const branch = getCurrentBranch();
    const existing = await storage.get(branch);
    const claims = existing?.claims ?? {};

    const entries = file
        ? Object.entries(claims).filter(([f]) => f === file)
        : Object.entries(claims);

    if (entries.length === 0) {
        console.log(file ? `🕷️ No one has claimed ${file} on \`${branch}\`.` : `🕷️ No active claims on \`${branch}\`.`);
        return;
    }

    console.log(`🕷️ Active claims on \`${branch}\`:`);
    for (const [f, claim] of entries) {
        console.log(`   ${f} — ${claim.agent} (${claim.at})`);
    }
}

export const claimCommand = new Command('claim')
    .description('🕷️ Claim file(s) on the current branch for an agent')
    .argument('<files>', 'Comma-separated file paths')
    .requiredOption('-a, --agent <agent>', 'Agent identifier')
    .action(async (files: string, options: { agent: string }) => {
        await claimFiles(files.split(',').map(f => f.trim()).filter(Boolean), options.agent);
    });

export const releaseCommand = new Command('release')
    .description('🕷️ Release file(s) you previously claimed')
    .argument('<files>', 'Comma-separated file paths')
    .requiredOption('-a, --agent <agent>', 'Agent identifier')
    .action(async (files: string, options: { agent: string }) => {
        await releaseFiles(files.split(',').map(f => f.trim()).filter(Boolean), options.agent);
    });

export const whosHereCommand = new Command('whos-here')
    .description("🕷️ Show who's actively claimed which files on the current branch")
    .argument('[file]', 'Limit to one file')
    .action(async (file: string | undefined) => {
        await whosHere(file);
    });
