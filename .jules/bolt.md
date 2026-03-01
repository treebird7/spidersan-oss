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

## 2026-03-01 - Optimize Array.includes to Set.has
**Learning:** In Spidersan's `conflicts.ts`, `torrent.ts` and `watch.ts`, checking file overlap using `Array.filter(f => otherArray.includes(f))` creates an O(N*M*K) bottleneck. Converting the target array to a `Set` and using `Set.has(f)` reduces this to O(N*M), yielding significant speedups.
**Action:** Always prefer `Set.has()` over `Array.includes()` when performing multiple membership checks in nested loops.
