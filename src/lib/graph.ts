export type NodeId = string;

function compareNodeIds(
    left: NodeId,
    right: NodeId,
    blockingCounts?: Map<NodeId, number>
): number {
    if (blockingCounts) {
        const leftCount = blockingCounts.get(left) ?? 0;
        const rightCount = blockingCounts.get(right) ?? 0;

        if (leftCount !== rightCount) {
            return rightCount - leftCount;
        }
    }

    return left.localeCompare(right);
}

function normalizeGraph(
    nodes: NodeId[],
    graph: Map<NodeId, NodeId[]>
): Map<NodeId, NodeId[]> {
    const knownNodes = new Set(nodes);
    const normalized = new Map<NodeId, NodeId[]>();

    for (const node of nodes) {
        const neighbors = graph.get(node) ?? [];
        const uniqueNeighbors = new Set<NodeId>();

        for (const neighbor of neighbors) {
            if (neighbor !== node && knownNodes.has(neighbor)) {
                uniqueNeighbors.add(neighbor);
            }
        }

        normalized.set(node, Array.from(uniqueNeighbors).sort((left, right) => left.localeCompare(right)));
    }

    return normalized;
}

/**
 * Build a conflict adjacency map: for each branch, which other branches
 * share overlapping files?
 * Pure function — takes branch data, returns a Map.
 */
export function buildConflictGraph(
    branches: Array<{ name: string; files: string[] }>
): Map<NodeId, NodeId[]> {
    const fileToBranches = new Map<string, Set<NodeId>>();

    for (const branch of branches) {
        for (const file of new Set(branch.files)) {
            let branchNames = fileToBranches.get(file);
            if (!branchNames) {
                branchNames = new Set<NodeId>();
                fileToBranches.set(file, branchNames);
            }

            branchNames.add(branch.name);
        }
    }

    const graph = new Map<NodeId, NodeId[]>();

    for (const branch of branches) {
        const conflicts = new Set<NodeId>();

        for (const file of new Set(branch.files)) {
            const branchNames = fileToBranches.get(file);
            if (!branchNames) {
                continue;
            }

            for (const otherBranch of branchNames) {
                if (otherBranch !== branch.name) {
                    conflicts.add(otherBranch);
                }
            }
        }

        graph.set(branch.name, Array.from(conflicts).sort((left, right) => left.localeCompare(right)));
    }

    return graph;
}

/**
 * Topological sort with tie-breaking by blocking count.
 * Returns branches in recommended merge order.
 * Cycles are broken by inserting branches at earliest valid position.
 * blockingCounts is optional; when omitted, sort is alphabetical within tied groups.
 */
export function topologicalSort(
    nodes: NodeId[],
    graph: Map<NodeId, NodeId[]>,
    blockingCounts?: Map<NodeId, number>
): NodeId[] {
    const normalizedGraph = normalizeGraph(nodes, graph);
    const inDegree = new Map<NodeId, number>();
    const remaining = new Set<NodeId>(nodes);
    const available: NodeId[] = [];
    const order: NodeId[] = [];

    for (const node of nodes) {
        inDegree.set(node, 0);
    }

    for (const neighbors of normalizedGraph.values()) {
        for (const neighbor of neighbors) {
            inDegree.set(neighbor, (inDegree.get(neighbor) ?? 0) + 1);
        }
    }

    for (const node of nodes) {
        if ((inDegree.get(node) ?? 0) === 0) {
            available.push(node);
        }
    }

    available.sort((left, right) => compareNodeIds(left, right, blockingCounts));

    while (remaining.size > 0) {
        let current = available.shift();

        if (!current) {
            current = Array.from(remaining).sort((left, right) => compareNodeIds(left, right, blockingCounts))[0];
        }

        if (!current || !remaining.has(current)) {
            continue;
        }

        remaining.delete(current);
        order.push(current);

        for (const neighbor of normalizedGraph.get(current) ?? []) {
            const nextDegree = (inDegree.get(neighbor) ?? 0) - 1;
            inDegree.set(neighbor, nextDegree);

            if (nextDegree === 0 && remaining.has(neighbor)) {
                available.push(neighbor);
            }
        }

        available.sort((left, right) => compareNodeIds(left, right, blockingCounts));
    }

    return order;
}

/**
 * For each node, count how many other nodes are (transitively) blocked by it.
 * Used for rarest-first prioritization.
 */
export function calculateBlockingCounts(
    nodes: NodeId[],
    graph: Map<NodeId, NodeId[]>
): Map<NodeId, number> {
    const normalizedGraph = normalizeGraph(nodes, graph);
    const counts = new Map<NodeId, number>();

    for (const node of nodes) {
        const seen = new Set<NodeId>();
        const stack = [...(normalizedGraph.get(node) ?? [])];

        while (stack.length > 0) {
            const current = stack.pop();
            if (!current || current === node || seen.has(current)) {
                continue;
            }

            seen.add(current);

            for (const neighbor of normalizedGraph.get(current) ?? []) {
                if (!seen.has(neighbor) && neighbor !== node) {
                    stack.push(neighbor);
                }
            }
        }

        counts.set(node, seen.size);
    }

    return counts;
}
