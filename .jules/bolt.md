## 2024-05-23 - Tree-sitter Performance & Limitations
**Learning:** `tree-sitter` bindings in this environment crash with "Invalid argument" when parsing strings larger than ~40KB. Also, recursive traversal using `node.child(i)` is significantly slower (~7x) than iterative traversal using `TreeCursor` due to `SyntaxNode` object allocation overhead.
**Action:** Always use `tree.walk()` and `TreeCursor` for traversing large ASTs. When benchmarking or processing files, ensure file size is within limits or chunked.
