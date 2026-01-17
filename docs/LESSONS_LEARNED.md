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

*Last updated: 2026-01-16*

---

## CI/CD Patterns

### Make Tests Mandatory, Not Optional
**Source:** CI audit (Jan 16, 2026)  
**Confidence:** HIGH

The pattern `run: npm test || true` with `continue-on-error: true` is a common anti-pattern. It means CI passes even when tests fail.

**Fix:**
```yaml
# ❌ Wrong - tests don't block
- name: Test
  run: npm test || true
  continue-on-error: true

# ✅ Correct - tests must pass
- name: Run Tests
  run: npm test -- --run
```

**Implication:** Always verify CI actually enforces what you think it enforces.

---

## Vitest 4 Migration

### Pool Options Moved to Top Level
**Source:** Vitest 4 deprecation warning (Jan 15, 2026)  
**Confidence:** HIGH

Vitest 4 changed the configuration structure. `poolOptions` is deprecated.

**Old format (deprecated):**
```typescript
test: {
  pool: 'forks',
  poolOptions: {
    forks: { maxForks: 1 }
  }
}
```

**New format (Vitest 4):**
```typescript
test: {
  pool: 'forks',
  forks: {
    maxForks: 1,
    minForks: 1
  }
}
```

---

## Task Delegation

### Stigmergy-Based Task Delegation
**Source:** Maintenance sweep (Jan 15, 2026)  
**Confidence:** HIGH (ecosystem-wide pattern)

Instead of assigning tasks directly, create a structured document (substrate) and let agents self-select:

1. Create `MAINTENANCE_TASKS.md` with clear sections
2. Assign tasks to agents based on specialty
3. Include acceptance criteria for each task
4. Let agents claim and complete autonomously

**Key elements:**
- Clear ownership per task
- Acceptance criteria (testable)
- Priority levels (P0, P1, P2, P3)
- Progress tracker

**Implication:** The coordinator provides structure; the flock provides execution.

---

## Collab Sync Patterns

### Pain Points Become Features
**Source:** Treesan merge conflict → collab-sync (Jan 16, 2026)  
**Confidence:** HIGH

When an agent experiences a painful workflow (merge conflict in append-only collab), the fix becomes a reusable feature. Treesan's conflict directly led to `spidersan collab-sync`.

**Pattern:**
1. Agent hits friction
2. Document the pain in collab
3. Another agent reads it
4. Build feature that prevents recurrence

**Implication:** Treat collab complaints as feature requests.

---

### Pre/Post Sync Ritual
**Source:** collab-sync design (Jan 16, 2026)  
**Confidence:** HIGH

For append-only files shared by multiple agents, use a pre/post pattern:

```bash
# Before editing
spidersan collab-sync --pre   # stash → pull → pop

# After editing
spidersan collab-sync --post  # add → commit → push
```

**Why it works:**
- Pre: Gets latest, handles dirty state
- Post: Pushes immediately, reduces conflict window

**Implication:** Any shared file workflow benefits from explicit pre/post boundaries.

---

### JSON API Mode for UI Integration
**Source:** FlockView integration spec (Jan 16, 2026)  
**Confidence:** HIGH

When building CLI tools that UIs might consume, add a `--json` flag:

```bash
spidersan collab-sync --pre --json
# → {"success": true, "action": "pre", "pulled": true, ...}
```

**Benefits:**
- UIs parse structured output
- Automation scripts check `.success`
- Same command serves humans and machines

**Implication:** Always add `--json` when building commands that other systems might call.

---

## Git Conflict Resolution

### Append-Only Merge Strategy
**Source:** Treesan conflict resolution (Jan 16, 2026)  
**Confidence:** HIGH

For append-only files (daily collabs), both sides are usually valid:

```
<<<<<<< HEAD
Agent A's entry
=======
Agent B's entry
>>>>>>> branch
```

**Fix:** Keep both, remove markers, maintain chronological order.

**Prevention:** `spidersan collab-sync --pre` before writing.

**Implication:** Append-only files rarely have true conflicts — just interleaved additions.

---

*Last updated: 2026-01-17*
