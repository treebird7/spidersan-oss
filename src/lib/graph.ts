export type NodeId = string;

function compareNodeIds(
    left: NodeId,
    right: NodeId,
    blockingCounts?: Map<NodeId, number>,
    tieBreak?: Map<NodeId, number>
): number {
    for (const scores of [blockingCounts, tieBreak]) {
        if (scores) {
            const leftCount = scores.get(left) ?? 0;
            const rightCount = scores.get(right) ?? 0;

            if (leftCount !== rightCount) {
                return rightCount - leftCount;
            }
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
 * Fold declared dependencies into a conflict graph as DIRECTED edges.
 * An edge u→v gives v in-degree, so v sorts after u: "A depends on B"
 * becomes edge B→A (B merges first). Because conflict edges are symmetric,
 * a dependent that ALSO file-overlaps its dep (the normal stacked-branch
 * case) forms a 2-cycle that would swallow the dep edge and fall back to
 * alphabetical cycle-breaking — so the opposing dependent→dep edge is
 * REMOVED: the declared direction wins over the undirected conflict.
 * Unknown/self deps are dropped by topologicalSort's normalization.
 * Returns a new map; inputs untouched.
 */
export function addDependencyEdges(
    graph: Map<NodeId, NodeId[]>,
    branches: Array<{ name: string; dependsOn?: string[] }>
): Map<NodeId, NodeId[]> {
    const merged = new Map<NodeId, NodeId[]>();
    for (const [node, neighbors] of graph.entries()) {
        merged.set(node, [...neighbors]);
    }

    for (const branch of branches) {
        for (const dep of branch.dependsOn ?? []) {
            const out = merged.get(dep) ?? [];
            if (!out.includes(branch.name)) {
                out.push(branch.name);
            }
            merged.set(dep, out);

            const back = merged.get(branch.name);
            if (back) {
                merged.set(branch.name, back.filter((n) => n !== dep));
            }
        }
    }

    return merged;
}

/**
 * Topological sort with tie-breaking by blocking count.
 * Returns branches in recommended merge order.
 * Cycles are broken by inserting branches at earliest valid position.
 * blockingCounts is optional; when omitted, sort is alphabetical within tied groups.
 * tieBreak, when given, orders nodes whose blockingCounts score is equal.
 */
export function topologicalSort(
    nodes: NodeId[],
    graph: Map<NodeId, NodeId[]>,
    blockingCounts?: Map<NodeId, number>,
    tieBreak?: Map<NodeId, number>
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

    available.sort((left, right) => compareNodeIds(left, right, blockingCounts, tieBreak));

    while (remaining.size > 0) {
        let current = available.shift();

        if (!current) {
            current = Array.from(remaining).sort((left, right) => compareNodeIds(left, right, blockingCounts, tieBreak))[0];
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

        available.sort((left, right) => compareNodeIds(left, right, blockingCounts, tieBreak));
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

/**
 * Declared dependencies only, as directed edges dep→dependent ("dep merges
 * first"), built from each branch's raw `dependsOn`. Deliberately NOT
 * addDependencyEdges output: that deletes the dependent→dep back-edge, so on
 * a declared 2-cycle the second entry erases the first and the cycle is gone
 * before anything can detect it. Unknown and self deps are dropped.
 */
export function buildDeclaredGraph(
    branches: Array<{ name: string; dependsOn?: string[] }>
): Map<NodeId, NodeId[]> {
    const known = new Set(branches.map((branch) => branch.name));
    const graph = new Map<NodeId, NodeId[]>(branches.map((branch) => [branch.name, []]));

    for (const branch of branches) {
        for (const dep of branch.dependsOn ?? []) {
            const out = graph.get(dep);
            if (known.has(dep) && dep !== branch.name && out && !out.includes(branch.name)) {
                out.push(branch.name);
            }
        }
    }

    return graph;
}

/** One declared edge: `dependent` depends on `dependency`. */
export interface DeclaredEdge {
    dependent: NodeId;
    dependency: NodeId;
}

export type Orientation =
    | { ok: true; order: NodeId[]; graph: Map<NodeId, NodeId[]>; droppedConflictEdges: number }
    | { ok: false; cycles: DeclaredEdge[][] };

/**
 * Turn conflict edges (symmetric: two branches touching one file give A→B and
 * B→A) into a DAG that keeps every declared edge, so a longest-path measure
 * can run on it. The order comes from the declared edges, never the other
 * way round: Kahn over the declared subgraph, ties by compareNodeIds, then
 * each conflict edge points along that order and its backward half is
 * dropped. Conflict edges carry no direction, so breaking them loses nothing;
 * a declared edge is never broken.
 *
 * A declared cycle is an error, not a tie: it is returned as the edges of each
 * strongly connected component, so a branch that merely sits downstream of a
 * cycle is not blamed.
 */
export function orientForMeasurement(
    nodes: NodeId[],
    declaredGraph: Map<NodeId, NodeId[]>,
    derivedGraph: Map<NodeId, NodeId[]>,
    blockingCounts?: Map<NodeId, number>
): Orientation {
    const declared = normalizeGraph(nodes, declaredGraph);
    const order = topologicalSort(nodes, declared, blockingCounts);
    // topologicalSort force-breaks cycles; a forced pick means a node was
    // emitted while one of its declared predecessors was still waiting.
    const position = new Map(order.map((node, index) => [node, index] as const));
    const hasBackEdge = nodes.some((node) =>
        (declared.get(node) ?? []).some((next) => position.get(next)! < position.get(node)!)
    );

    if (hasBackEdge) {
        return { ok: false, cycles: findCycles(nodes, declared) };
    }

    const oriented = new Map<NodeId, NodeId[]>(nodes.map((node) => [node, [...(declared.get(node) ?? [])]]));
    const isDeclared = (left: NodeId, right: NodeId) =>
        (declared.get(left) ?? []).includes(right) || (declared.get(right) ?? []).includes(left);
    let droppedConflictEdges = 0;

    for (const [node, neighbors] of normalizeGraph(nodes, derivedGraph)) {
        for (const neighbor of neighbors) {
            if (position.get(node)! < position.get(neighbor)!) {
                const out = oriented.get(node)!;
                if (!out.includes(neighbor)) {
                    out.push(neighbor);
                }
            } else if (!isDeclared(node, neighbor)) {
                droppedConflictEdges++;  // direction decided by the order, not by anyone
            }
        }
    }

    return { ok: true, order, graph: oriented, droppedConflictEdges };
}

/** Tarjan's SCCs of size ≥ 2, each reported as its internal declared edges. */
function findCycles(nodes: NodeId[], declared: Map<NodeId, NodeId[]>): DeclaredEdge[][] {
    const index = new Map<NodeId, number>();
    const low = new Map<NodeId, number>();
    const stack: NodeId[] = [];
    const onStack = new Set<NodeId>();
    const cycles: DeclaredEdge[][] = [];

    const visit = (node: NodeId) => {
        index.set(node, index.size);
        low.set(node, index.get(node)!);
        stack.push(node);
        onStack.add(node);

        for (const next of declared.get(node) ?? []) {
            if (!index.has(next)) {
                visit(next);
                low.set(node, Math.min(low.get(node)!, low.get(next)!));
            } else if (onStack.has(next)) {
                low.set(node, Math.min(low.get(node)!, index.get(next)!));
            }
        }

        if (low.get(node) === index.get(node)) {
            const members = new Set<NodeId>();
            let member: NodeId;
            do {
                member = stack.pop()!;
                onStack.delete(member);
                members.add(member);
            } while (member !== node);

            if (members.size > 1) {
                const edges: DeclaredEdge[] = [];
                for (const dependency of members) {
                    for (const dependent of declared.get(dependency) ?? []) {
                        if (members.has(dependent)) {
                            edges.push({ dependent, dependency });
                        }
                    }
                }
                cycles.push(edges.sort((a, b) => a.dependent.localeCompare(b.dependent) || a.dependency.localeCompare(b.dependency)));
            }
        }
    };

    for (const node of nodes) {
        if (!index.has(node)) {
            visit(node);
        }
    }

    return cycles;
}

/**
 * For each node, the length (in edges) of the longest path from it to any
 * terminal: the chain the finish date waits on. Descendant count measures
 * breadth of unblocking; this measures depth — a node unblocking 8 leaves
 * scores 1 here, a node heading a 5-deep chain scores 4.
 * Requires a DAG (use orientForMeasurement) and throws on a cycle rather than
 * truncating the path it is measuring. Linear: one pass in reverse topo order.
 */
export function calculateCriticalPath(
    nodes: NodeId[],
    orientedGraph: Map<NodeId, NodeId[]>
): Map<NodeId, number> {
    const graph = normalizeGraph(nodes, orientedGraph);
    const order = topologicalSort(nodes, graph);
    const position = new Map(order.map((node, index) => [node, index] as const));
    const lengths = new Map<NodeId, number>();

    for (const node of [...order].reverse()) {
        let longest = 0;
        for (const next of graph.get(node) ?? []) {
            if (position.get(next)! <= position.get(node)!) {
                throw new Error(`calculateCriticalPath: cycle through ${node} → ${next}; orient the graph first`);
            }
            longest = Math.max(longest, lengths.get(next)! + 1);
        }
        lengths.set(node, longest);
    }

    return lengths;
}
