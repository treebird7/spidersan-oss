## 2025-05-20 - Validation vs Sanitization
**Learning:** `sanitizeFilePaths` filters out invalid paths but does NOT throw errors, while `validateFilePath` throws on invalid paths.
**Action:** When a security check must fail the entire operation on *any* invalid input (e.g., `register` command), use `validateFilePath` in a loop. Do not rely on `sanitizeFilePaths` if strict validation is required by tests.

## 2025-05-20 - Supabase Push Optimization
**Learning:** Sequential HTTP requests in loops (N+1 problem) are a major bottleneck for branch synchronization. Using Supabase's `in` filter (`branch_name=in.(...)`) allows fetching all relevant records in a single request.
**Action:** Always look for batching opportunities when interacting with remote storage. For Supabase, use `in` filters for reads and bulk inserts/parallel updates for writes. Verify optimizations with mocked network tests to ensure request counts are reduced.

## 2024-05-22 - Tree-sitter Large File Crash
**Learning:** `tree-sitter` bindings in this environment crash with "Invalid argument" when parsing strings larger than ~40KB. This might be due to `bun` compatibility or memory constraints.
**Action:** When working with `tree-sitter` here, ensure inputs are chunked or limited in size for benchmarks/tests. Be aware that large source files might cause runtime crashes.

## 2024-05-22 - AST Traversal Performance
**Learning:** Replacing recursive `node.child(i)` traversal (which instantiates `SyntaxNode` objects) with iterative `TreeCursor` traversal yielded a ~6x speedup (190ms -> 32ms for 32KB).
**Action:** Always prefer `tree.walk()` and `TreeCursor` for AST traversal over object-based navigation.
## 2025-05-20 - Set for O(1) File Lookup in Conflict Detection
**Learning:** Checking for file overlaps using `Array.prototype.includes` inside nested loops over branches causes O(N * M) time complexity per check. This was a significant bottleneck in `ready-check.ts`, `torrent.ts`, and `watch.ts`.
**Action:** Always convert file arrays to a `Set` before running intersection logic over them. Using `Set.has(f)` reduces overlap complexity from O(N*M) to O(N+M) and yields ~28x speedup.

## 2025-05-20 - Set Allocation in O(N^2) Nested Loops
**Learning:** Even after optimizing O(N*M) lookup times using `Set.has(f)` instead of `Array.prototype.includes(f)`, instantiating a `Set` within the *inner* loop of an O(N^2) operation (e.g., comparing all active branches to all other active branches for conflicts) reallocates `N*(N-1)/2` sets redundantly.
**Action:** Always hoist `Set` object instantiation out of inner loops. Hoisting the `Set` creation to the outer loop reduces time complexity from O(N^2 * M) back to O(N * M) allocations, yielding a ~7.1x speedup in isolated conflict detection benchmarks.
