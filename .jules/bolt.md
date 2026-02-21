## 2024-05-22 - [Optimizing Tree-Sitter AST Traversal]
**Learning:** `tree.walk()` with `TreeCursor` is significantly faster (~50%) than recursive node traversal (`node.child(i)`), likely due to reduced object allocation overhead.
**Action:** Prefer `TreeCursor` for traversing syntax trees, especially for large files or frequent operations like symbol extraction.
