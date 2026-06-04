import type { ConflictReport } from './conflict-analyzer.js';
import { TIER_LABELS, type ConflictTier } from './conflict-tier.js';

export interface RenderOptions {
    verbose?: boolean;
    showRecommendations?: boolean;
}

interface BranchConflict {
    branch: string;
    files: string[];
    tier: ConflictTier;
    symbolsByFile: Map<string, string[]>;
}

export function renderConflictReport(report: ConflictReport, options: RenderOptions = {}): string {
    if (report.conflicts.length === 0) {
        return '🕷️ No conflicts detected\n   ✅ You\'re good to merge!';
    }

    const lines: string[] = [];
    const branchConflicts = buildBranchConflicts(report);
    const branchSummary = summarizeBranchConflicts(branchConflicts);
    const showRecommendations = options.showRecommendations !== false;

    for (const conflict of branchConflicts) {
        const tierInfo = TIER_LABELS[conflict.tier];
        lines.push(`${tierInfo.icon} TIER ${conflict.tier} (${tierInfo.label}): ${conflict.branch}`);

        for (const file of conflict.files) {
            const fileConflict = report.conflicts.find((entry) => entry.file === file);
            const fileTier = fileConflict ? TIER_LABELS[fileConflict.tier] : tierInfo;
            lines.push(`   ${fileTier.icon} ${file}`);

            const symbolsOverlap = conflict.symbolsByFile.get(file) ?? [];
            if (options.verbose && symbolsOverlap.length > 0) {
                lines.push(`      ↳ symbols: ${symbolsOverlap.join(', ')}`);
            }
        }

        if (showRecommendations) {
            lines.push(`   → ${tierInfo.action}`);
        }

        lines.push('');
    }

    lines.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    lines.push(
        `📊 Summary: 🔴 ${branchSummary.tier3} BLOCK | 🟠 ${branchSummary.tier2} PAUSE | 🟡 ${branchSummary.tier1} WARN`,
    );

    const addAddHelper = renderAddAddResolution(report);
    if (addAddHelper) {
        lines.push(addAddHelper);
    }

    return lines.join('\n');
}

function summarizeBranchConflicts(conflicts: BranchConflict[]): { tier1: number; tier2: number; tier3: number } {
    let tier1 = 0, tier2 = 0, tier3 = 0;
    for (const conflict of conflicts) {
        if (conflict.tier === 1) tier1++;
        else if (conflict.tier === 2) tier2++;
        else if (conflict.tier === 3) tier3++;
    }
    return { tier1, tier2, tier3 };
}

function buildBranchConflicts(report: ConflictReport): BranchConflict[] {
    const branchOrder = inferBranchOrder(report);
    const branchOrderIndex = new Map(branchOrder.map((branch, index) => [branch, index]));
    const grouped = new Map<string, BranchConflict>();

    for (const conflict of report.conflicts) {
        for (const branch of conflict.branches) {
            let entry = grouped.get(branch.name);
            if (!entry) {
                entry = {
                    branch: branch.name,
                    files: [],
                    tier: 1,
                    symbolsByFile: new Map<string, string[]>(),
                };
                grouped.set(branch.name, entry);
            }

            if (!entry.files.includes(conflict.file)) {
                entry.files.push(conflict.file);
            }

            if (conflict.tier > entry.tier) {
                entry.tier = conflict.tier;
            }

            if (conflict.symbolsOverlap && conflict.symbolsOverlap.length > 0) {
                entry.symbolsByFile.set(conflict.file, [...conflict.symbolsOverlap]);
            }
        }
    }

    return [...grouped.values()].sort((left, right) => {
        if (right.tier !== left.tier) {
            return right.tier - left.tier;
        }

        return (branchOrderIndex.get(left.branch) ?? Number.MAX_SAFE_INTEGER)
            - (branchOrderIndex.get(right.branch) ?? Number.MAX_SAFE_INTEGER);
    });
}

function inferBranchOrder(report: ConflictReport): string[] {
    const adjacency = new Map<string, Set<string>>();
    const indegree = new Map<string, number>();
    const firstSeen = new Map<string, number>();
    let seenIndex = 0;

    const ensureBranch = (branch: string): void => {
        if (!adjacency.has(branch)) {
            adjacency.set(branch, new Set<string>());
        }
        if (!indegree.has(branch)) {
            indegree.set(branch, 0);
        }
        if (!firstSeen.has(branch)) {
            firstSeen.set(branch, seenIndex++);
        }
    };

    for (const conflict of report.conflicts) {
        const branchNames = conflict.branches.map((branch) => branch.name);
        for (const branch of branchNames) {
            ensureBranch(branch);
        }

        for (let index = 0; index < branchNames.length; index++) {
            for (let nextIndex = index + 1; nextIndex < branchNames.length; nextIndex++) {
                const from = branchNames[index];
                const to = branchNames[nextIndex];
                const edges = adjacency.get(from);
                if (!edges || edges.has(to)) {
                    continue;
                }

                edges.add(to);
                indegree.set(to, (indegree.get(to) ?? 0) + 1);
            }
        }
    }

    const queue = [...indegree.entries()]
        .filter(([, degree]) => degree === 0)
        .map(([branch]) => branch)
        .sort((left, right) => (firstSeen.get(left) ?? 0) - (firstSeen.get(right) ?? 0));
    const ordered: string[] = [];

    while (queue.length > 0) {
        const branch = queue.shift();
        if (!branch) {
            break;
        }

        ordered.push(branch);

        for (const next of adjacency.get(branch) ?? []) {
            const nextDegree = (indegree.get(next) ?? 0) - 1;
            indegree.set(next, nextDegree);
            if (nextDegree === 0) {
                queue.push(next);
                queue.sort((left, right) => (firstSeen.get(left) ?? 0) - (firstSeen.get(right) ?? 0));
            }
        }
    }

    if (ordered.length === indegree.size) {
        return ordered;
    }

    return [...firstSeen.entries()]
        .sort((left, right) => left[1] - right[1])
        .map(([branch]) => branch);
}

function renderAddAddResolution(report: ConflictReport): string {
    const addAddFiles = report.conflicts
        .map((conflict) => conflict.file)
        .filter((file) => /\.md$/.test(file) || /docs\//.test(file));

    if (addAddFiles.length === 0) {
        return '';
    }

    const uniqueFiles = [...new Set(addAddFiles)];

    return [
        '',
        '💡 Add/Add Conflict Helper',
        '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
        'Detected files added in both branches. Recommended actions:',
        '  1. Preserve incoming variant for auditability:',
        '       git checkout --theirs <file> && mv <file> <file>.<their-branch>.incoming && git add <file>.<their-branch>.incoming',
        '  2. Keep canonical version in main branch and include note linking the incoming variant.',
        '  3. Commit and continue rebase: git add -A && git rebase --continue',
        '',
        'Examples:',
        ...uniqueFiles.map((file) => `   • ${file} -> preserve incoming as ${file}.incoming`),
        '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
        '',
    ].join('\n');
}
