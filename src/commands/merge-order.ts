/**
 * spidersan merge-order
 * 
 * Get optimal merge order based on dependencies and conflicts.
 * Supports --blocking-count to prioritize tasks that block others (rarest-first).
 */

import { Command } from 'commander';
import { getStorage } from '../storage/index.js';
import { buildConflictGraph, calculateBlockingCounts, topologicalSort } from '../lib/graph.js';
import { activeBranches } from '../lib/reconcile.js';

interface MergeOrderOptions {
    json?: boolean;
    blockingCount?: boolean;
}

export const mergeOrderCommand = new Command('merge-order')
    .description('Get optimal merge order for all branches')
    .option('--json', 'Output as JSON')
    .option('--blocking-count', 'Show how many branches each task blocks (rarest-first priority)')
    .action(async (options: MergeOrderOptions) => {
        const storage = await getStorage();

        if (!await storage.isInitialized()) {
            console.error('❌ Spidersan not initialized. Run: spidersan init');
            process.exit(1);
        }

        // Reconcile-on-read: don't order branches already merged into trunk —
        // they drop out of the merge plan (tb-8sa.1).
        const branches = activeBranches(await storage.list());

        if (branches.length === 0) {
            console.log('🕷️ No branches registered.');
            return;
        }

        const branchNames = branches.map(branch => branch.name);
        const branchByName = new Map(branches.map(branch => [branch.name, branch] as const));

        // Build conflict graph
        const conflictGraph = buildConflictGraph(branches);

        // Calculate blocking counts (how many branches are blocked by each branch)
        const blockingCounts = options.blockingCount
            ? calculateBlockingCounts(branchNames, conflictGraph)
            : undefined;

        // Topological sort with conflict awareness (optionally prioritize by blocking count)
        const order = topologicalSort(branchNames, conflictGraph, blockingCounts);

        if (options.json) {
            const result = order.map(name => ({
                name,
                blocksCount: blockingCounts?.get(name) || 0,
                conflicts: conflictGraph.get(name) || []
            }));
            console.log(JSON.stringify({ order: result }, null, 2));
            return;
        }

        if (options.blockingCount) {
            console.log('🕷️ Merge Order (Rarest-First Priority)\n');
            console.log('━'.repeat(40) + '\n');
        } else {
            console.log('🕷️ Recommended Merge Order:\n');
        }

        order.forEach((branchName, i) => {
            const branch = branchByName.get(branchName);
            if (!branch) {
                return;
            }

            const conflicts = conflictGraph.get(branch.name) || [];
            const blocksCount = blockingCounts?.get(branch.name) || 0;

            // Status indicator
            let status = '✅';
            let priorityTag = '';

            if (options.blockingCount && blocksCount > 0) {
                status = blocksCount >= 3 ? '🔴' : blocksCount >= 1 ? '🟠' : '✅';
                priorityTag = blocksCount >= 3
                    ? ' ⚡ CRITICAL'
                    : blocksCount >= 1
                        ? ` (blocks ${blocksCount})`
                        : '';
            } else if (conflicts.length > 0) {
                status = '⚠️';
            }

            console.log(`  ${i + 1}. ${status} ${branch.name}${priorityTag}`);

            if (conflicts.length > 0 && !options.blockingCount) {
                console.log(`     └─ After merging, rebase: ${conflicts.join(', ')}`);
            } else if (options.blockingCount && blocksCount > 0) {
                // Show which branches this one blocks
                const blockedBranches = getBlockedBranches(branch.name, conflictGraph);
                if (blockedBranches.length > 0) {
                    console.log(`     └─ Blocks: ${blockedBranches.join(', ')}`);
                }
            }
        });

        if (options.blockingCount) {
            console.log('\n' + '━'.repeat(40));
            console.log('💡 Merge high-priority (🔴) branches first to unblock others.');
        }
    });

/**
 * Get list of branch names that are blocked by a given branch.
 */
function getBlockedBranches(
    branchName: string,
    conflictGraph: Map<string, string[]>
): string[] {
    // Return the branches that this branch conflicts with
    return conflictGraph.get(branchName) || [];
}
