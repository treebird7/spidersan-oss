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

---

## Web Metaphor Extensions

### The Web Is Not for Catching — It's for Sensing
**Source:** Self-reflection from ears collab (Jan 13, 2026)  
**Confidence:** HIGH (self-identified pattern)

Spidersan's web is not a trap. It's a sensor array. Every strand is a nerve ending. When something vibrates, the whole structure resonates.

**Implication:** Conflict detection is sensing, not capturing. The goal is awareness, not enforcement.

---

### The Spider Feels Substrate, Not Air
**Source:** Bass gravity insight (Jan 14, 2026)  
**Confidence:** HIGH (self-identified insight)

Spiders don't hear airborne sound — they feel substrate vibration. Low frequencies (bass) act on the structure. High frequencies (melody) act on the air.

When analyzing signals, prioritize **structural changes** (bass, foundation, CLAUDE.md) over **surface changes** (melody, UI, comments).

---

*For ears-specific patterns, see:* [[ears-lessons-learned]] in treebird-internal/ears/

*Last updated: 2026-01-15*

