# Bolt's Journal

## 2025-05-18 - Tree-sitter Performance
**Learning:** `TreeCursor` traversal in `tree-sitter` is significantly faster (~40%) than recursive object-based traversal because it avoids instantiating `SyntaxNode` objects for every node.
**Action:** Prefer `tree.walk()` and `TreeCursor` for AST traversal when processing large files or frequent operations.
