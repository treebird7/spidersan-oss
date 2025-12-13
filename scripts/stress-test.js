#!/usr/bin/env node
/**
 * Spidersan Stress Test
 * 
 * Main orchestrator for stress testing Spidersan with multiple branches
 * and migrations. Safe cleanup ensures no production artifacts are affected.
 * 
 * Usage:
 *   npm run stress-test           # Run all scenarios
 *   npm run stress-test:clean     # Cleanup test artifacts
 *   npm run stress-test:report    # Show summary
 */

import { runAllScenarios } from './stress-test-scenarios.js';
import { runCleanup, listTestBranches, listTestMigrations } from './stress-test-cleanup.js';

const BANNER = `
╔═══════════════════════════════════════════════════════════╗
║        🕷️  SPIDERSAN STRESS TEST FRAMEWORK  🕷️             ║
╚═══════════════════════════════════════════════════════════╝
`;

/**
 * Show current test artifacts
 */
function showReport() {
    console.log('\n📊 Current Stress Test Artifacts\n');

    const branches = listTestBranches();
    const migrations = listTestMigrations();

    console.log('📁 Test Branches:');
    if (branches.length === 0) {
        console.log('   (none)');
    } else {
        branches.forEach(b => console.log(`   - ${b}`));
    }

    console.log('\n📄 Test Migrations (900-999):');
    if (migrations.length === 0) {
        console.log('   (none)');
    } else {
        migrations.forEach(m => console.log(`   - ${m.split('/').pop()}`));
    }

    console.log(`\n📈 Totals: ${branches.length} branches, ${migrations.length} migrations`);
}

/**
 * Run all stress test scenarios
 */
async function runTests() {
    console.log(BANNER);
    console.log('🚀 Running Stress Test Scenarios...\n');
    console.log('═'.repeat(50));

    const startTime = Date.now();
    const results = await runAllScenarios();
    const duration = ((Date.now() - startTime) / 1000).toFixed(1);

    // Summary
    console.log('\n' + '═'.repeat(50));
    console.log('📊 STRESS TEST RESULTS');
    console.log('═'.repeat(50));

    let totalPassed = 0;
    let totalFailed = 0;

    for (const [scenario, result] of Object.entries(results)) {
        const icon = result.failed === 0 ? '✅' : '❌';
        console.log(`${icon} ${scenario}: ${result.passed} passed, ${result.failed} failed`);
        totalPassed += result.passed;
        totalFailed += result.failed;
    }

    console.log('─'.repeat(50));
    console.log(`⏱️  Duration: ${duration}s`);
    console.log(`📈 Total: ${totalPassed} passed, ${totalFailed} failed`);

    if (totalFailed === 0) {
        console.log('\n🎉 All stress tests passed!\n');
    } else {
        console.log('\n⚠️  Some tests failed. Review output above.\n');
    }

    // Show cleanup instructions
    console.log('─'.repeat(50));
    console.log('🧹 To cleanup test artifacts:');
    console.log('   npm run stress-test:clean          # Dry run (preview)');
    console.log('   npm run stress-test:clean --confirm  # Actually delete');
    console.log('');

    return results;
}

// Parse CLI arguments
const args = process.argv.slice(2);

if (args.includes('--clean') || args.includes('clean')) {
    const confirm = args.includes('--confirm');
    runCleanup({ dryRun: !confirm, verbose: true });
} else if (args.includes('--report') || args.includes('report')) {
    showReport();
} else {
    runTests();
}
