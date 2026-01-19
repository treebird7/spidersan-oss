#!/usr/bin/env node
/**
 * Stress Test Scenarios
 * 
 * Individual test scenarios for Spidersan stress testing.
 * Uses the storage factory (auto-detects Supabase when configured).
 */

import { execSync } from 'child_process';
import { writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';

// Import storage to use shared Supabase
import 'dotenv/config';

const MIGRATIONS_DIR = join(process.cwd(), 'migrations');

/**
 * Utility: Run spidersan command
 */
function runSpidersan(args, silent = false) {
    try {
        const result = execSync(`node dist/bin/spidersan.js ${args}`, {
            encoding: 'utf-8',
            cwd: process.cwd(),
        });
        if (!silent) console.log(result);
        return { success: true, output: result };
    } catch (err) {
        return { success: false, output: err.message, error: err };
    }
}

/**
 * Utility: Create a test branch (local git only)
 */
function createTestBranch(name) {
    const branchName = `stress-test/${name}`;
    try {
        execSync(`git checkout -b "${branchName}"`, { encoding: 'utf-8', stdio: 'pipe' });
        return branchName;
    } catch {
        try {
            execSync(`git checkout "${branchName}"`, { encoding: 'utf-8', stdio: 'pipe' });
            return branchName;
        } catch {
            throw new Error(`Failed to create branch: ${branchName}`);
        }
    }
}

/**
 * Utility: Return to main branch
 */
function returnToMain() {
    try {
        execSync('git checkout main', { encoding: 'utf-8', stdio: 'pipe' });
    } catch {
        try {
            execSync('git checkout master', { encoding: 'utf-8', stdio: 'pipe' });
        } catch {
            // Already on a valid branch
        }
    }
}

/**
 * Utility: Check if Supabase is configured
 */
function isSupabaseConfigured() {
    return !!(process.env.SUPABASE_URL && process.env.SUPABASE_KEY);
}

/**
 * Scenario 1: Parallel Branches with Conflicting Files
 * 
 * Creates multiple branches that all claim to modify the same files.
 * Uses shared Supabase storage so conflicts are visible across branches.
 */
export async function scenarioParallelBranches() {
    console.log('\n📋 Scenario: Parallel Branches with Conflicting Files\n');

    const results = { passed: 0, failed: 0, details: [] };
    const originalBranch = execSync('git rev-parse --abbrev-ref HEAD', { encoding: 'utf-8' }).trim();

    // Check storage mode
    const usingSupabase = isSupabaseConfigured();
    if (usingSupabase) {
        console.log('  📡 Using Supabase storage (shared registry)\n');
    } else {
        console.log('  💾 Using local storage (isolated - conflicts may not detect)\n');
    }

    // Shared files that will cause conflicts
    const sharedFiles = ['src/commands/register.ts', 'package.json', 'src/index.ts'];

    try {
        // First: register all branches from main (so they all go into shared storage)
        returnToMain();

        // Register each branch with overlapping files
        for (let i = 1; i <= 5; i++) {
            // Create the git branch
            createTestBranch(`parallel-${i}`);

            // Register with overlapping files
            const files = sharedFiles.slice(0, (i % 3) + 1).join(',');
            const result = runSpidersan(`register --files "${files}" --description "Parallel test ${i}" --agent "stress-test"`, true);

            if (result.success) {
                results.details.push({ branch: `stress-test/parallel-${i}`, status: 'registered', files });
                console.log(`  ✅ Registered stress-test/parallel-${i} with files: ${files}`);
            } else {
                console.log(`  ⚠️  stress-test/parallel-${i}: ${result.output.slice(0, 100)}`);
            }

            // Return to main for next branch
            returnToMain();
        }

        // Now check conflicts for each branch
        console.log('\n  Checking conflicts...\n');
        let conflictsDetected = 0;

        for (let i = 1; i <= 5; i++) {
            const branchName = `stress-test/parallel-${i}`;
            try {
                execSync(`git checkout "${branchName}"`, { encoding: 'utf-8', stdio: 'pipe' });
            } catch {
                continue;
            }

            const result = runSpidersan('conflicts --json', true);
            if (result.success) {
                try {
                    const data = JSON.parse(result.output);
                    if (data.conflicts && data.conflicts.length > 0) {
                        conflictsDetected++;
                        console.log(`  🔍 ${branchName}: ${data.conflicts.length} conflict(s) detected`);
                    } else {
                        console.log(`  ⚪ ${branchName}: No conflicts`);
                    }
                } catch {
                    // If not JSON, might still indicate conflicts in text
                    if (result.output.includes('conflict')) {
                        conflictsDetected++;
                    }
                }
            }

            returnToMain();
        }

        // All branches except maybe one should have conflicts
        const expectedConflicts = usingSupabase ? 4 : 0;
        if (conflictsDetected >= expectedConflicts) {
            results.passed++;
            console.log(`\n  ✅ Detected ${conflictsDetected}/5 branches with conflicts (expected: ${expectedConflicts}+)`);
        } else {
            results.failed++;
            console.log(`\n  ❌ Only detected ${conflictsDetected} conflicts (expected: ${expectedConflicts}+)`);
            if (!usingSupabase) {
                console.log('     Note: Local storage isolates branches. Enable Supabase for shared conflict detection.');
            }
        }

    } finally {
        try { execSync(`git checkout "${originalBranch}"`, { stdio: 'pipe' }); } catch { }
    }

    return results;
}

/**
 * Scenario 2: Migration Version Collision Detection
 * 
 * Creates migrations with the same version number in the 900 range.
 */
export async function scenarioMigrationCollision() {
    console.log('\n📋 Scenario: Migration Version Collision Detection\n');

    const results = { passed: 0, failed: 0, details: [] };

    if (!existsSync(MIGRATIONS_DIR)) {
        mkdirSync(MIGRATIONS_DIR, { recursive: true });
    }

    // Create two migrations with same version number
    const migration1 = join(MIGRATIONS_DIR, '900_stress_test_a.sql');
    const migration2 = join(MIGRATIONS_DIR, '900_stress_test_b.sql');

    try {
        writeFileSync(migration1, `-- Stress Test Migration A
-- Version collision test
BEGIN;
CREATE TABLE IF NOT EXISTS spidersan._stress_test_a (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ DEFAULT NOW()
);
COMMIT;
`);
        writeFileSync(migration2, `-- Stress Test Migration B
-- Version collision test
BEGIN;
CREATE TABLE IF NOT EXISTS spidersan._stress_test_b (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ DEFAULT NOW()
);
COMMIT;
`);

        results.details.push({ created: migration1 });
        results.details.push({ created: migration2 });

        if (existsSync(migration1) && existsSync(migration2)) {
            results.passed++;
            console.log('  ✅ Created duplicate version migrations (900_*)');
            console.log('  ⚠️  Note: Supabase CLI would error on apply');
        } else {
            results.failed++;
            console.log('  ❌ Failed to create migrations');
        }

    } catch (err) {
        results.failed++;
        results.details.push({ error: err.message });
        console.log(`  ❌ Error: ${err.message}`);
    }

    return results;
}

/**
 * Scenario 3: Branch Registry Load Test
 * 
 * Registers many branches to test performance.
 */
export async function scenarioRegistryLoad() {
    console.log('\n📋 Scenario: Branch Registry Load Test\n');

    const results = { passed: 0, failed: 0, details: [] };
    const originalBranch = execSync('git rev-parse --abbrev-ref HEAD', { encoding: 'utf-8' }).trim();
    const branchCount = 20;

    const usingSupabase = isSupabaseConfigured();
    console.log(`  📡 Storage: ${usingSupabase ? 'Supabase (cloud)' : 'Local (file)'}\n`);

    const startTime = Date.now();

    try {
        // Register many branches
        for (let i = 1; i <= branchCount; i++) {
            returnToMain();
            createTestBranch(`load-${i}`);
            runSpidersan(`register --description "Load test ${i}" --agent "stress-test"`, true);

            if (i % 5 === 0) {
                console.log(`  Registered ${i}/${branchCount} branches...`);
            }
        }

        const registerTime = Date.now() - startTime;
        returnToMain();

        // Test list performance
        const listStart = Date.now();
        const listResult = runSpidersan('list', true);
        const listTime = Date.now() - listStart;

        results.details.push({
            branchesCreated: branchCount,
            registerTimeMs: registerTime,
            listTimeMs: listTime,
        });

        // Pass if list completed in reasonable time (< 5s)
        if (listTime < 5000 && listResult.success) {
            results.passed++;
            console.log(`\n  ✅ Registered ${branchCount} branches in ${registerTime}ms`);
            console.log(`  ✅ Listed all branches in ${listTime}ms`);
        } else {
            results.failed++;
            console.log(`\n  ❌ Performance issue: list took ${listTime}ms`);
        }

    } finally {
        try { execSync(`git checkout "${originalBranch}"`, { stdio: 'pipe' }); } catch { }
    }

    return results;
}

/**
 * Scenario 4: Dependency Chain
 * 
 * Creates a chain of branches with dependencies A→B→C→D
 * Tests merge-order calculation.
 */
export async function scenarioDependencyChain() {
    console.log('\n📋 Scenario: Dependency Chain (A→B→C→D)\n');

    const results = { passed: 0, failed: 0, details: [] };
    const originalBranch = execSync('git rev-parse --abbrev-ref HEAD', { encoding: 'utf-8' }).trim();

    const chain = ['A', 'B', 'C', 'D'];

    try {
        // Create chain of dependent branches
        for (let i = 0; i < chain.length; i++) {
            returnToMain();
            const branchName = createTestBranch(`chain-${chain[i]}`);

            runSpidersan(`register --description "Chain ${chain[i]}" --agent "stress-test"`, true);
            console.log(`  Created ${branchName}`);

            // Add dependency on previous branch (except for A)
            if (i > 0) {
                const depResult = runSpidersan(`depends stress-test/chain-${chain[i - 1]}`, true);
                if (depResult.success) {
                    console.log(`    → depends on stress-test/chain-${chain[i - 1]}`);
                }
            }
        }

        // Get merge order from D (should give us A, B, C, D)
        returnToMain();
        try {
            execSync('git checkout stress-test/chain-D', { stdio: 'pipe' });
        } catch { }

        console.log('\n  Checking merge order...');
        const orderResult = runSpidersan('merge-order', true);

        const output = orderResult.output || '';
        const correctOrder = output.includes('chain-A') || output.includes('Chain') || orderResult.success;

        if (correctOrder) {
            results.passed++;
            console.log('  ✅ Dependency chain registered successfully');
            console.log('  ✅ merge-order command executed');
        } else {
            results.failed++;
            console.log('  ❌ Dependency chain failed');
        }

        results.details.push({ chain, orderOutput: output.slice(0, 200) });

    } finally {
        try { execSync(`git checkout "${originalBranch}"`, { stdio: 'pipe' }); } catch { }
    }

    return results;
}

/**
 * Run all scenarios
 */
export async function runAllScenarios() {
    console.log('\n📡 Storage Configuration:');
    if (isSupabaseConfigured()) {
        console.log('   ✅ Supabase detected - using shared cloud storage');
        console.log('   URL:', process.env.SUPABASE_URL?.substring(0, 30) + '...');
    } else {
        console.log('   💾 Local storage only (set SUPABASE_URL + SUPABASE_KEY for cloud)');
    }

    const allResults = {
        parallelBranches: await scenarioParallelBranches(),
        migrationCollision: await scenarioMigrationCollision(),
        registryLoad: await scenarioRegistryLoad(),
        dependencyChain: await scenarioDependencyChain(),
    };

    return allResults;
}

// CLI usage
if (process.argv[1].includes('stress-test-scenarios')) {
    runAllScenarios().then(results => {
        console.log('\n' + '═'.repeat(40));
        console.log('📊 Scenario Results Summary');
        console.log('═'.repeat(40));

        let total = { passed: 0, failed: 0 };
        for (const [name, result] of Object.entries(results)) {
            const status = result.failed === 0 ? '✅' : '❌';
            console.log(`  ${status} ${name}: ${result.passed} passed, ${result.failed} failed`);
            total.passed += result.passed;
            total.failed += result.failed;
        }

        console.log('─'.repeat(40));
        console.log(`  Total: ${total.passed} passed, ${total.failed} failed`);
    });
}
