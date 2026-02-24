## 2024-05-22 - Tree-sitter Large File Crash
**Learning:** `tree-sitter` bindings in this environment crash with "Invalid argument" when parsing strings larger than ~40KB. This might be due to `bun` compatibility or memory constraints.
**Action:** When working with `tree-sitter` here, ensure inputs are chunked or limited in size for benchmarks/tests. Be aware that large source files might cause runtime crashes.

## 2024-05-22 - AST Traversal Performance
**Learning:** Replacing recursive `node.child(i)` traversal (which instantiates `SyntaxNode` objects) with iterative `TreeCursor` traversal yielded a ~6x speedup (190ms -> 32ms for 32KB).
**Action:** Always prefer `tree.walk()` and `TreeCursor` for AST traversal over object-based navigation.
