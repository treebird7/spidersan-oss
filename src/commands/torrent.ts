/**
 * spidersan torrent
 * 
 * Task Torrenting integration - manage branches for parallel task execution.
 * BitTorrent-inspired approach: tasks are "seeded" by one agent, "downloaded" by others.
 */

import { Command } from 'commander';
import { execFileSync } from 'child_process';
import { getStorage } from '../storage/index.js';
import type { Branch } from '../storage/adapter.js';
import { validateTaskId } from '../lib/security.js';

// Config
const HUB_URL = process.env.HUB_URL || 'https://hub.treebird.uk';

interface TorrentCreateOptions {
    agent?: string;
    parent?: string;
}

interface TorrentStatusOptions {
    json?: boolean;
    parent?: string;
}

interface TorrentClaimOptions {
    agent?: string;
}

function getCurrentBranch(): string {
    try {
        return execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { encoding: 'utf-8' }).trim();
    } catch {
        throw new Error('Not in a git repository');
    }
}

function createBranchForTask(taskId: string): void {
    const safeTaskId = validateTaskId(taskId);
    const branchName = `task/${safeTaskId}`;
    try {
        // Check if branch exists
        execFileSync('git', ['rev-parse', '--verify', branchName], { encoding: 'utf-8', stdio: 'pipe' });
        console.log(`   Branch ${branchName} already exists, checking out...`);
        execFileSync('git', ['checkout', branchName], { encoding: 'utf-8' });
    } catch {
        // Branch doesn't exist, create it
        execFileSync('git', ['checkout', '-b', branchName], { encoding: 'utf-8' });
    }
}

/**
 * Parse task ID to extract parent if nested (e.g., DASH-001-A -> parent is DASH-001)
 */
function getParentTaskId(taskId: string): string | null {
    // Pattern: PARENT-CHILD (e.g., DASH-001-A, SEC-002-B)
    const match = taskId.match(/^(.+)-[A-Za-z]$/);
    return match ? match[1] : null;
}

/**
 * Check for conflicts with other task branches
 */
async function checkForConflicts(branchName: string): Promise<{ branch: string; files: string[] }[]> {
    const storage = await getStorage();
    const branches = await storage.list();
    const currentBranch = await storage.get(branchName);

    if (!currentBranch) return [];

    const conflicts: { branch: string; files: string[] }[] = [];

    for (const other of branches) {
        if (other.name === branchName || other.status !== 'active') continue;
        if (!other.name.startsWith('task/')) continue; // Only check other task branches

        const overlap = currentBranch.files.filter(f => other.files.includes(f));
        if (overlap.length > 0) {
            conflicts.push({ branch: other.name, files: overlap });
        }
    }

    return conflicts;
}

// Main torrent command with subcommands
export const torrentCommand = new Command('torrent')
    .description('🔄 Task Torrenting - manage branches for parallel task execution');

// Subcommand: torrent create <task-id>
torrentCommand
    .command('create <task-id>')
    .description('Create a branch for a task (e.g., spidersan torrent create DASH-001)')
    .option('-a, --agent <agent>', 'Agent claiming this task')
    .option('-p, --parent <parent-task>', 'Parent task ID (for nested decomposition)')
    .action(async (taskId: string, options: TorrentCreateOptions) => {
        const safeTaskId = validateTaskId(taskId);
        const storage = await getStorage();

        if (!await storage.isInitialized()) {
            console.error('❌ Spidersan not initialized. Run: spidersan init');
            process.exit(1);
        }

        const branchName = `task/${safeTaskId}`;
        const agent = options.agent || process.env.SPIDERSAN_AGENT || 'unknown';
        const parentTaskId = options.parent || getParentTaskId(safeTaskId);

        console.log(`
🔄 TASK TORRENTING: Create Branch
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Task:   ${safeTaskId}
Branch: ${branchName}
Agent:  ${agent}
Parent: ${parentTaskId || '(none)'}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
        `);

        // Create git branch
        createBranchForTask(safeTaskId);
        console.log(`✅ Created and checked out: ${branchName}`);

        // Register in Spidersan
        const existing = await storage.get(branchName);
        if (existing) {
            await storage.update(branchName, {
                agent,
                status: 'active',
                description: parentTaskId ? `Child of ${parentTaskId}` : undefined
            });
        } else {
            await storage.register({
                name: branchName,
                files: [],
                status: 'active',
                agent,
                description: parentTaskId ? `Child of ${parentTaskId}` : undefined
            });
        }
        console.log(`✅ Registered in Spidersan`);

        // Try to notify Hub
        try {
            await fetch(`${HUB_URL}/api/tasks/${safeTaskId}/claim`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ agent, branch: branchName })
            });
            console.log(`✅ Notified Hub`);
        } catch {
            console.log(`⚠️ Could not notify Hub (offline?)`);
        }

        console.log(`
💡 Next steps:
   1. Make your changes
   2. git add && git commit
   3. spidersan torrent complete ${safeTaskId}
        `);
    });

// Subcommand: torrent status
torrentCommand
    .command('status')
    .description('Show all active task branches and their status')
    .option('--json', 'Output as JSON')
    .option('-p, --parent <parent-task>', 'Filter by parent task')
    .action(async (options: TorrentStatusOptions) => {
        const storage = await getStorage();

        if (!await storage.isInitialized()) {
            console.error('❌ Spidersan not initialized. Run: spidersan init');
            process.exit(1);
        }

        const branches = await storage.list();
        const taskBranches = branches.filter(b =>
            b.name.startsWith('task/') && b.status === 'active'
        );

        // Filter by parent if specified
        const filtered = options.parent
            ? taskBranches.filter(b => {
                const taskId = b.name.replace('task/', '');
                return taskId.startsWith(options.parent!) || getParentTaskId(taskId) === options.parent;
            })
            : taskBranches;

        if (options.json) {
            console.log(JSON.stringify({ tasks: filtered }, null, 2));
            return;
        }

        if (filtered.length === 0) {
            console.log('🔄 No active task branches.');
            console.log('   Use: spidersan torrent create <task-id>');
            return;
        }

        console.log(`
🔄 TASK TORRENTING: Status
━━━━━━━━━━━━━━━━━━━━━━━━━━
Active Tasks: ${filtered.length}
━━━━━━━━━━━━━━━━━━━━━━━━━━
        `);

        // Group by parent
        const byParent = new Map<string, Branch[]>();
        for (const branch of filtered) {
            const taskId = branch.name.replace('task/', '');
            const parent = getParentTaskId(taskId) || 'root';
            if (!byParent.has(parent)) byParent.set(parent, []);
            byParent.get(parent)!.push(branch);
        }

        for (const [parent, tasks] of byParent) {
            if (parent !== 'root') {
                console.log(`\n📦 Parent: ${parent}`);
            }

            for (const task of tasks) {
                const taskId = task.name.replace('task/', '');
                const conflicts = await checkForConflicts(task.name);
                const status = conflicts.length > 0 ? '⚠️' : '✅';
                const agentTag = task.agent ? ` (${task.agent})` : '';

                console.log(`   ${status} ${taskId}${agentTag}`);
                if (task.files.length > 0) {
                    console.log(`      Files: ${task.files.slice(0, 3).join(', ')}${task.files.length > 3 ? '...' : ''}`);
                }
                if (conflicts.length > 0) {
                    console.log(`      ⚠️ Conflicts with: ${conflicts.map(c => c.branch).join(', ')}`);
                }
            }
        }
    });

// Subcommand: torrent complete <task-id>
torrentCommand
    .command('complete <task-id>')
    .description('Mark a task as complete and prepare for merge')
    .option('-a, --agent <agent>', 'Agent completing this task')
    .action(async (taskId: string, options: TorrentClaimOptions) => {
        const storage = await getStorage();
        const safeTaskId = validateTaskId(taskId);
        const branchName = `task/${safeTaskId}`;
        const agent = options.agent || process.env.SPIDERSAN_AGENT || 'unknown';

        const branch = await storage.get(branchName);
        if (!branch) {
            console.error(`❌ Task branch not found: ${branchName}`);
            console.log(`   Run: spidersan torrent create ${safeTaskId}`);
            process.exit(1);
        }

        // Mark as completed
        await storage.update(branchName, { status: 'completed' });

        console.log(`
🎉 TASK COMPLETE: ${safeTaskId}
━━━━━━━━━━━━━━━━━━━━━━━━━━
Branch:    ${branchName}
Agent:     ${agent}
Files:     ${branch.files.length}
━━━━━━━━━━━━━━━━━━━━━━━━━━
        `);

        // Check for conflicts before merge recommendation
        const conflicts = await checkForConflicts(branchName);
        if (conflicts.length > 0) {
            console.log(`⚠️ Conflicts detected! Resolve before merging:`);
            conflicts.forEach(c => {
                console.log(`   • ${c.branch}: ${c.files.join(', ')}`);
            });
        } else {
            console.log(`✅ No conflicts - ready to merge!`);
        }

        // Try to notify Hub
        try {
            await fetch(`${HUB_URL}/api/tasks/${safeTaskId}/complete`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ agent, branch: branchName })
            });
            console.log(`✅ Notified Hub`);
        } catch {
            console.log(`⚠️ Could not notify Hub (offline?)`);
        }

        console.log(`
💡 Next steps:
   1. Push your branch: git push origin ${branchName}
   2. Create PR or merge: git checkout main && git merge ${branchName}
   3. Clean up: spidersan merged ${branchName}
        `);
    });

// Subcommand: torrent merge-order
torrentCommand
    .command('merge-order')
    .description('Get optimal merge order for all task branches')
    .option('--json', 'Output as JSON')
    .action(async (options: { json?: boolean }) => {
        const storage = await getStorage();
        const branches = await storage.list();
        const taskBranches = branches.filter(b =>
            b.name.startsWith('task/') &&
            (b.status === 'active' || b.status === 'completed')
        );

        if (taskBranches.length === 0) {
            console.log('🔄 No task branches to merge.');
            return;
        }

        // Build conflict graph
        const conflictGraph = new Map<string, string[]>();
        for (const branch of taskBranches) {
            const conflicts: string[] = [];
            for (const other of taskBranches) {
                if (branch.name === other.name) continue;
                const overlap = branch.files.some(f => other.files.includes(f));
                if (overlap) conflicts.push(other.name);
            }
            conflictGraph.set(branch.name, conflicts);
        }

        // Sort: completed first, then by fewest conflicts
        const sorted = [...taskBranches].sort((a, b) => {
            // Completed tasks first
            if (a.status === 'completed' && b.status !== 'completed') return -1;
            if (b.status === 'completed' && a.status !== 'completed') return 1;

            // Fewest conflicts first
            const conflictsA = conflictGraph.get(a.name)?.length || 0;
            const conflictsB = conflictGraph.get(b.name)?.length || 0;
            return conflictsA - conflictsB;
        });

        if (options.json) {
            console.log(JSON.stringify({
                order: sorted.map(b => ({
                    name: b.name,
                    taskId: b.name.replace('task/', ''),
                    status: b.status,
                    conflicts: conflictGraph.get(b.name) || []
                }))
            }, null, 2));
            return;
        }

        console.log(`
🔄 TASK TORRENTING: Merge Order
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
        `);

        sorted.forEach((branch, i) => {
            const taskId = branch.name.replace('task/', '');
            const conflicts = conflictGraph.get(branch.name) || [];
            const statusIcon = branch.status === 'completed' ? '✅' : '🔄';
            const conflictIcon = conflicts.length > 0 ? '⚠️' : '';

            console.log(`   ${i + 1}. ${statusIcon} ${taskId} ${conflictIcon}`);
            if (conflicts.length > 0) {
                console.log(`      └─ Rebase after: ${conflicts.map(c => c.replace('task/', '')).join(', ')}`);
            }
        });

        console.log(`
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
💡 Merge ✅ completed tasks first, then handle 🔄 active.
        `);
    });

// Subcommand: torrent tree
torrentCommand
    .command('tree')
    .description('Show nested task branches as a tree structure')
    .option('--json', 'Output as JSON')
    .action(async (options: { json?: boolean }) => {
        const storage = await getStorage();
        const branches = await storage.list();
        const taskBranches = branches.filter(b => b.name.startsWith('task/'));

        if (taskBranches.length === 0) {
            console.log('🔄 No task branches found.');
            return;
        }

        // Build tree structure
        interface TaskNode {
            id: string;
            branch: string;
            status: string;
            agent?: string;
            files: string[];
            children: TaskNode[];
        }

        const nodeMap = new Map<string, TaskNode>();
        const roots: TaskNode[] = [];

        // First pass: create all nodes
        for (const branch of taskBranches) {
            const taskId = branch.name.replace('task/', '');
            const node: TaskNode = {
                id: taskId,
                branch: branch.name,
                status: branch.status,
                agent: branch.agent,
                files: branch.files,
                children: []
            };
            nodeMap.set(taskId, node);
        }

        // Second pass: build tree
        for (const [taskId, node] of nodeMap) {
            const parentId = getParentTaskId(taskId);
            if (parentId && nodeMap.has(parentId)) {
                nodeMap.get(parentId)!.children.push(node);
            } else {
                roots.push(node);
            }
        }

        if (options.json) {
            console.log(JSON.stringify({ tree: roots }, null, 2));
            return;
        }

        console.log(`
🌲 TASK TREE (Nested Branches)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
        `);

        // Recursive tree printer
        function printNode(node: TaskNode, indent: string, isLast: boolean): void {
            const branch = isLast ? '└─' : '├─';
            const statusIcon = node.status === 'completed' ? '✅' :
                node.status === 'active' ? '🔄' : '⚫';
            const agentTag = node.agent ? ` (${node.agent})` : '';

            console.log(`${indent}${branch} ${statusIcon} ${node.id}${agentTag}`);

            const nextIndent = indent + (isLast ? '   ' : '│  ');
            node.children.forEach((child, i) => {
                printNode(child, nextIndent, i === node.children.length - 1);
            });
        }

        roots.forEach((root, i) => {
            printNode(root, '', i === roots.length - 1);
        });

        // Summary
        const total = taskBranches.length;
        const completed = taskBranches.filter(b => b.status === 'completed').length;
        const active = taskBranches.filter(b => b.status === 'active').length;
        const parents = roots.length;
        const children = total - roots.filter(r => r.children.length === 0).length;

        console.log(`
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📊 Total: ${total} | Parents: ${parents} | Nested: ${children}
   ✅ ${completed} complete | 🔄 ${active} active
        `);
    });

// Subcommand: torrent decompose <parent-id>
torrentCommand
    .command('decompose <parent-id>')
    .description('Create child tasks from a parent (e.g., decompose DASH into DASH-A, DASH-B, DASH-C)')
    .option('-c, --count <count>', 'Number of child tasks to create', '3')
    .option('-a, --agent <agent>', 'Agent creating the decomposition')
    .action(async (parentId: string, options: { count?: string; agent?: string }) => {
        const storage = await getStorage();
        const safeParentId = validateTaskId(parentId);
        const count = parseInt(options.count || '3', 10);
        const agent = options.agent || process.env.SPIDERSAN_AGENT || 'unknown';
        const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

        console.log(`
🔀 DECOMPOSING: ${safeParentId}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Creating ${count} child tasks...
        `);

        const created: string[] = [];
        for (let i = 0; i < Math.min(count, 26); i++) {
            const childId = `${safeParentId}-${letters[i]}`;
            const branchName = `task/${childId}`;

            // Register child task (don't create git branch, just register)
            await storage.register({
                name: branchName,
                files: [],
                status: 'active',
                agent: undefined, // Not claimed yet
                description: `Child of ${parentId}`
            });

            created.push(childId);
            console.log(`   📦 ${childId}`);
        }

        console.log(`
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
✅ Created ${created.length} child tasks

💡 Next: Agents can claim with:
   spidersan torrent create ${created[0]} --agent <name>
        `);
    });
