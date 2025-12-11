/**
 * spidersan merge-order
 * 
 * Get optimal merge order based on dependencies and conflicts.
 */

import { Command } from 'commander';
import { LocalStorage } from '../storage/index.js';
import type { Branch } from '../storage/adapter.js';

export const mergeOrderCommand = new Command('merge-order')
    .description('Get optimal merge order for all branches')
    .option('--json', 'Output as JSON')
    .action(async (options) => {
        const storage = new LocalStorage();

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

        // Topological sort with conflict awareness
        const order = topologicalSort(branches, conflictGraph);

        if (options.json) {
            console.log(JSON.stringify({ order: order.map(b => b.name) }, null, 2));
            return;
        }

        console.log('🕷️ Recommended Merge Order:\n');

        order.forEach((branch, i) => {
            const conflicts = conflictGraph.get(branch.name) || [];
            const status = conflicts.length === 0 ? '✅' : '⚠️';
            console.log(`  ${i + 1}. ${status} ${branch.name}`);

            if (conflicts.length > 0) {
                console.log(`     └─ After merging, rebase: ${conflicts.join(', ')}`);
            }
        });
    });

function buildConflictGraph(branches: Branch[]): Map<string, string[]> {
    const graph = new Map<string, string[]>();

    for (const branch of branches) {
        const conflicts: string[] = [];

        for (const other of branches) {
            if (branch.name === other.name) continue;

            const overlap = branch.files.some(f => other.files.includes(f));
            if (overlap) {
                conflicts.push(other.name);
            }
        }

        graph.set(branch.name, conflicts);
    }

    return graph;
}

function topologicalSort(branches: Branch[], conflicts: Map<string, string[]>): Branch[] {
    // Sort by: 1) fewest conflicts first, 2) oldest first
    return [...branches].sort((a, b) => {
        const conflictsA = conflicts.get(a.name)?.length || 0;
        const conflictsB = conflicts.get(b.name)?.length || 0;

        if (conflictsA !== conflictsB) {
            return conflictsA - conflictsB;
        }

        // Oldest first (FIFO)
        return new Date(a.registeredAt).getTime() - new Date(b.registeredAt).getTime();
    });
}
