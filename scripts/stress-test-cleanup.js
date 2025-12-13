#!/usr/bin/env node
/**
 * Stress Test Cleanup Module
 * 
 * Safe cleanup of stress test artifacts with multiple safeguards.
 * NEVER deletes anything outside the designated test prefixes.
 * Supports both local and Supabase storage.
 */

import 'dotenv/config';
import { execSync } from 'child_process';
import { readdirSync, unlinkSync, existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

// Safety constraints - ONLY these patterns can be deleted
const SAFE_PATTERNS = {
    branchPrefix: 'stress-test/',      // Git branches starting with this
    migrationRange: /^9\d{2}_/,        // Migrations 900-999 only
    tablePrefix: '_stress_test',       // Tables with this in name
};

// Migration directory
const MIGRATIONS_DIR = join(process.cwd(), 'migrations');

/**
 * Check if Supabase is configured
 */
function isSupabaseConfigured() {
    return !!(process.env.SUPABASE_URL && process.env.SUPABASE_KEY);
}

/**
 * List all stress test branches
 */
export function listTestBranches() {
    try {
        const output = execSync('git branch --list "stress-test/*"', { encoding: 'utf-8' });
        return output
            .split('\n')
            .map(b => b.trim().replace(/^\* /, ''))
            .filter(Boolean);
    } catch {
        return [];
    }
}

/**
 * List all stress test migrations (900-999 range)
 */
export function listTestMigrations() {
    if (!existsSync(MIGRATIONS_DIR)) return [];

    return readdirSync(MIGRATIONS_DIR)
        .filter(f => SAFE_PATTERNS.migrationRange.test(f))
        .map(f => join(MIGRATIONS_DIR, f));
}

/**
 * Delete stress test branches (git)
 */
export async function cleanupBranches(options = { dryRun: true, verbose: true }) {
    const branches = listTestBranches();

    if (branches.length === 0) {
        if (options.verbose) console.log('  No stress-test branches found');
        return { deleted: [], skipped: [] };
    }

    const deleted = [];
    const skipped = [];

    for (const branch of branches) {
        // Safety check - must start with prefix
        if (!branch.startsWith(SAFE_PATTERNS.branchPrefix)) {
            skipped.push({ name: branch, reason: 'Does not match safe prefix' });
            continue;
        }

        if (options.dryRun) {
            if (options.verbose) console.log(`  [DRY RUN] Would delete branch: ${branch}`);
            deleted.push(branch);
        } else {
            try {
                execSync(`git branch -D "${branch}"`, { encoding: 'utf-8' });
                if (options.verbose) console.log(`  🗑️  Deleted branch: ${branch}`);
                deleted.push(branch);
            } catch (err) {
                skipped.push({ name: branch, reason: err.message });
            }
        }
    }

    return { deleted, skipped };
}

/**
 * Delete stress test migration files
 */
export async function cleanupMigrations(options = { dryRun: true, verbose: true }) {
    const migrations = listTestMigrations();

    if (migrations.length === 0) {
        if (options.verbose) console.log('  No stress-test migrations found');
        return { deleted: [], skipped: [] };
    }

    const deleted = [];
    const skipped = [];

    for (const migrationPath of migrations) {
        const filename = migrationPath.split('/').pop();

        // Safety check - must match 900-999 range
        if (!SAFE_PATTERNS.migrationRange.test(filename)) {
            skipped.push({ name: filename, reason: 'Does not match safe range (900-999)' });
            continue;
        }

        if (options.dryRun) {
            if (options.verbose) console.log(`  [DRY RUN] Would delete migration: ${filename}`);
            deleted.push(filename);
        } else {
            try {
                unlinkSync(migrationPath);
                if (options.verbose) console.log(`  🗑️  Deleted migration: ${filename}`);
                deleted.push(filename);
            } catch (err) {
                skipped.push({ name: filename, reason: err.message });
            }
        }
    }

    return { deleted, skipped };
}

/**
 * Clean local registry entries for stress test branches
 */
export async function cleanupLocalRegistry(options = { dryRun: true, verbose: true }) {
    const registryPath = join(process.cwd(), '.spidersan', 'registry.json');

    if (!existsSync(registryPath)) {
        if (options.verbose) console.log('  No local registry file found');
        return { deleted: [], skipped: [] };
    }

    try {
        const registry = JSON.parse(readFileSync(registryPath, 'utf-8'));

        const deleted = [];
        const toDelete = [];

        for (const branchName of Object.keys(registry.branches || {})) {
            if (branchName.startsWith(SAFE_PATTERNS.branchPrefix)) {
                toDelete.push(branchName);
            }
        }

        if (toDelete.length === 0) {
            if (options.verbose) console.log('  No stress-test entries in local registry');
            return { deleted: [], skipped: [] };
        }

        if (options.dryRun) {
            for (const name of toDelete) {
                if (options.verbose) console.log(`  [DRY RUN] Would remove local entry: ${name}`);
                deleted.push(name);
            }
        } else {
            for (const name of toDelete) {
                delete registry.branches[name];
                if (options.verbose) console.log(`  🗑️  Removed local entry: ${name}`);
                deleted.push(name);
            }
            writeFileSync(registryPath, JSON.stringify(registry, null, 2));
        }

        return { deleted, skipped: [] };
    } catch (err) {
        if (options.verbose) console.log(`  Warning: Could not clean local registry: ${err.message}`);
        return { deleted: [], skipped: [] };
    }
}

/**
 * Clean Supabase branch registry entries for stress test branches
 */
export async function cleanupSupabaseRegistry(options = { dryRun: true, verbose: true }) {
    if (!isSupabaseConfigured()) {
        if (options.verbose) console.log('  Supabase not configured, skipping');
        return { deleted: [], skipped: [] };
    }

    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_KEY;

    try {
        // List stress-test branches in Supabase
        const listUrl = `${url}/rest/v1/branch_registry?branch_name=like.stress-test%2F*&select=branch_name`;
        const listResponse = await fetch(listUrl, {
            headers: {
                'apikey': key,
                'Authorization': `Bearer ${key}`,
            },
        });

        if (!listResponse.ok) {
            if (options.verbose) console.log(`  Warning: Could not fetch Supabase branches`);
            return { deleted: [], skipped: [] };
        }

        const rows = await listResponse.json();
        const branches = rows.map(r => r.branch_name);

        if (branches.length === 0) {
            if (options.verbose) console.log('  No stress-test entries in Supabase');
            return { deleted: [], skipped: [] };
        }

        const deleted = [];
        const skipped = [];

        for (const branchName of branches) {
            // Safety check
            if (!branchName.startsWith(SAFE_PATTERNS.branchPrefix)) {
                skipped.push({ name: branchName, reason: 'Does not match safe prefix' });
                continue;
            }

            if (options.dryRun) {
                if (options.verbose) console.log(`  [DRY RUN] Would remove Supabase entry: ${branchName}`);
                deleted.push(branchName);
            } else {
                // Mark as abandoned (soft delete) - safer than hard delete
                const updateUrl = `${url}/rest/v1/branch_registry?branch_name=eq.${encodeURIComponent(branchName)}`;
                const updateResponse = await fetch(updateUrl, {
                    method: 'PATCH',
                    headers: {
                        'apikey': key,
                        'Authorization': `Bearer ${key}`,
                        'Content-Type': 'application/json',
                        'Prefer': 'return=representation',
                    },
                    body: JSON.stringify({ state: 'abandoned' }),
                });

                if (updateResponse.ok) {
                    if (options.verbose) console.log(`  🗑️  Marked abandoned in Supabase: ${branchName}`);
                    deleted.push(branchName);
                } else {
                    skipped.push({ name: branchName, reason: 'Update failed' });
                }
            }
        }

        return { deleted, skipped };
    } catch (err) {
        if (options.verbose) console.log(`  Warning: Supabase cleanup error: ${err.message}`);
        return { deleted: [], skipped: [] };
    }
}

/**
 * Run full cleanup
 */
export async function runCleanup(options = { dryRun: true, verbose: true }) {
    console.log('\n🧹 Spidersan Stress Test Cleanup\n');

    if (options.dryRun) {
        console.log('⚠️  DRY RUN MODE - Nothing will be deleted\n');
    }

    console.log('📁 Git Branches:');
    const branchResult = await cleanupBranches(options);

    console.log('\n📄 Migration Files:');
    const migrationResult = await cleanupMigrations(options);

    console.log('\n📋 Local Registry Entries:');
    const localRegistryResult = await cleanupLocalRegistry(options);

    console.log('\n☁️  Supabase Registry Entries:');
    const supabaseRegistryResult = await cleanupSupabaseRegistry(options);

    // Summary
    console.log('\n' + '─'.repeat(40));
    const total = branchResult.deleted.length +
        migrationResult.deleted.length +
        localRegistryResult.deleted.length +
        supabaseRegistryResult.deleted.length;

    if (options.dryRun) {
        console.log(`\n✅ Would clean up ${total} item(s)`);
        console.log('\nRun with --confirm to actually delete');
    } else {
        console.log(`\n✅ Cleaned up ${total} item(s)`);
    }

    return {
        branches: branchResult,
        migrations: migrationResult,
        localRegistry: localRegistryResult,
        supabaseRegistry: supabaseRegistryResult,
    };
}

// CLI usage
if (process.argv[1].includes('stress-test-cleanup')) {
    const confirm = process.argv.includes('--confirm');
    runCleanup({ dryRun: !confirm, verbose: true });
}
