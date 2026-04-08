/**
 * spidersan merge-order
 * 
 * Get optimal merge order based on dependencies and conflicts.
 * Supports --blocking-count to prioritize tasks that block others (rarest-first).
 */

import { Command } from 'commander';
import { getStorage } from '../storage/index.js';
import type { Branch } from '../storage/adapter.js';

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

        const branches = await storage.list();

        if (branches.length === 0) {
            console.log('🕷️ No branches registered.');
            return;
        }

        // Build conflict graph
        const conflictGraph = buildConflictGraph(branches);

        // Calculate blocking counts (how many branches are blocked by each branch)
        const blockingCounts = options.blockingCount
            ? calculateBlockingCounts(branches, conflictGraph)
            : new Map<string, number>();

        // Topological sort with conflict awareness (optionally prioritize by blocking count)
        const order = topologicalSort(branches, conflictGraph, blockingCounts, options.blockingCount);

        if (options.json) {
            const result = order.map(b => ({
                name: b.name,
                blocksCount: blockingCounts.get(b.name) || 0,
                conflicts: conflictGraph.get(b.name) || []
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

        order.forEach((branch, i) => {
            const conflicts = conflictGraph.get(branch.name) || [];
            const blocksCount = blockingCounts.get(branch.name) || 0;

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
                const blockedBranches = getBlockedBranches(branch.name, branches, conflictGraph);
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

function buildConflictGraph(branches: Branch[]): Map<string, string[]> {
    const graph = new Map<string, string[]>();
    const conflictSets = new Map<string, Set<string>>();

    // Performance Optimization: Use an inverted index (file -> branches)
    // to map files to the branches that touch them.
    // This reduces time complexity from O(N^2 * M) to O(N * M) compared to nested branch-to-branch comparisons.
    const fileToBranches = new Map<string, string[]>();

    for (const branch of branches) {
        conflictSets.set(branch.name, new Set<string>());
        // Use Set to ensure unique files per branch
        for (const file of new Set(branch.files)) {
            let b = fileToBranches.get(file);
            if (!b) {
                b = [];
                fileToBranches.set(file, b);
            }
            b.push(branch.name);
        }
    }

    // Build conflicts using the inverted index
    for (const branchesModifyingFile of fileToBranches.values()) {
        if (branchesModifyingFile.length > 1) {
            for (let i = 0; i < branchesModifyingFile.length; i++) {
                const b1 = branchesModifyingFile[i];
                for (let j = i + 1; j < branchesModifyingFile.length; j++) {
                    const b2 = branchesModifyingFile[j];
                    conflictSets.get(b1)!.add(b2);
                    conflictSets.get(b2)!.add(b1);
                }
            }
        }
    }

    for (const branch of branches) {
        graph.set(branch.name, Array.from(conflictSets.get(branch.name)!));
    }

    return graph;
}

function topologicalSort(
    branches: Branch[],
    conflicts: Map<string, string[]>,
    blockingCounts: Map<string, number>,
    useBlockingOrder?: boolean
): Branch[] {
    return [...branches].sort((a, b) => {
        // If using blocking-count mode, sort by most blocking first (rarest-first)
        if (useBlockingOrder) {
            const blocksA = blockingCounts.get(a.name) || 0;
            const blocksB = blockingCounts.get(b.name) || 0;

            if (blocksA !== blocksB) {
                return blocksB - blocksA;  // Most blocking first
            }
        }

        // Default: fewest conflicts first
        const conflictsA = conflicts.get(a.name)?.length || 0;
        const conflictsB = conflicts.get(b.name)?.length || 0;

        if (conflictsA !== conflictsB) {
            return conflictsA - conflictsB;
        }

        // Oldest first (FIFO)
        return new Date(a.registeredAt).getTime() - new Date(b.registeredAt).getTime();
    });
}

/**
 * Calculate how many branches each branch blocks.
 * A branch "blocks" another if they share files (conflict).
 */
function calculateBlockingCounts(
    branches: Branch[],
    conflictGraph: Map<string, string[]>
): Map<string, number> {
    const counts = new Map<string, number>();

    for (const branch of branches) {
        // Count how many branches conflict with this one (= are blocked by it)
        const conflictingBranches = conflictGraph.get(branch.name) || [];
        counts.set(branch.name, conflictingBranches.length);
    }

    return counts;
}

/**
 * Get list of branch names that are blocked by a given branch.
 */
function getBlockedBranches(
    branchName: string,
    branches: Branch[],
    conflictGraph: Map<string, string[]>
): string[] {
    // Return the branches that this branch conflicts with
    return conflictGraph.get(branchName) || [];
}

