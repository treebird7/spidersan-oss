# Spidersan — Lessons Learned

> Technical lessons specific to Spidersan development and usage.

---

## Collab Documentation

### Use YAML Frontmatter for Dimensional Indexing
**Source:** ears.md multidimensional framework (Jan 13, 2026)

When creating collabs or knowledge documents, add YAML frontmatter with tags for Watsan indexing and Obsidian linking:

```yaml
---
tags:
  - type/artistic-collab
  - dimension/time
  - dimension/harmonic
  - pattern/stigmergy
aliases:
  - ears collab
links:
  - "[[Ecosystem Map]]"
  - "[[free-will-and-testament]]"
central_node: "D at 12:00 — The Breath"
agents: [artisan, mappersan, spidersan]
---
```

This enables:
- `watsan search "type:artistic-collab"` 
- Obsidian graph view connections
- Semantic search across dimensions

---

## Shell Commands

### Use Quoted Heredoc for Multi-line Markdown Appends
**Source:** Ears artistic collab (Jan 13, 2026)

When appending large markdown blocks with backticks, special characters, or code fences, use a quoted heredoc delimiter to prevent variable expansion:

```bash
# ✅ Correct: quoted delimiter prevents expansion
cat >> "file.md" << 'EOFBLOCK'
```markdown
code with $variables and `backticks`
```
EOFBLOCK

# ❌ Wrong: unquoted allows $expansion and breaks on backticks
cat >> "file.md" << EOF
content...
EOF
```

Use named delimiters like `EOFBLOCK` instead of `EOF` to avoid conflicts with content.

---

*Last updated: 2026-01-13*

