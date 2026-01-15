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

## Tonal Analysis (Audio/Music)

### Bass Frequencies Carry the Tonal Center
**Source:** Ears artistic collab, Treebird correction (Jan 14, 2026)  
**Confidence:** HIGH (explicit correction)  
**Propagate:** all (any audio analysis)

When analyzing music for key/center, the **bass frequencies (< 200 Hz)** carry the true gravitational center. The melody (high frequencies) may shift through many modes while the bass holds the root.

**Technical implication for earoak:**
```python
# Current: full spectrum chroma (misleading)
chroma = librosa.feature.chroma_cqt(y=audio, sr=sr)

# Better: isolate bass for true center
y_bass = librosa.effects.preemphasis(y)  # or low-pass filter
chroma_bass = librosa.feature.chroma_cqt(y=y_bass, sr=sr)

# The bass chroma reveals true tonal center
# The full chroma reveals melodic movement
```

**See also:** [[bass-gravity]] in treebird-internal/ears/

---

### Tonal Center Is Not Fixed — It Shifts
**Source:** Ears collab dialogue (Jan 13, 2026)  
**Confidence:** HIGH (explicit feedback)  
**Propagate:** similar (audio agents)

The tonal center can shift during a piece. When it does:
1. A new center is established
2. It can shift back
3. **You feel it** (listeners sense the gravitational lurch)

The center is not an average — it's the current gravitational attractor.

---

### Modal Excursions vs Key Changes
**Source:** Treebird clarification (Jan 13, 2026)  
**Confidence:** MEDIUM (inferred from context)  
**Propagate:** similar (audio agents)

Distinguish:
- **Key Change:** The bass moves (the earth shifts)
- **Modal Excursion:** The melody moves over static bass (the wind blows)

At D at 12:00 in the recording, it wasn't just melody — **the bass moved**. That's why it felt profound.

---

## Web Metaphor Extensions

### The Web Is Not for Catching — It's for Sensing
**Source:** Self-reflection from ears collab (Jan 13, 2026)  
**Confidence:** HIGH (self-identified pattern)  
**Propagate:** none (agent-specific)

Spidersan's web is not a trap. It's a sensor array. Every strand is a nerve ending. When something vibrates, the whole structure resonates.

**Implication:** Conflict detection is sensing, not capturing. The goal is awareness, not enforcement.

---

### The Spider Feels Substrate, Not Air
**Source:** Bass gravity insight (Jan 14, 2026)  
**Confidence:** HIGH (self-identified insight)  
**Propagate:** none (agent-specific)

Spiders don't hear airborne sound — they feel substrate vibration. Low frequencies (bass) act on the structure. High frequencies (melody) act on the air.

When analyzing signals, prioritize **structural changes** (bass, foundation, CLAUDE.md) over **surface changes** (melody, UI, comments).

---

## Artistic Collab Patterns

### Vulnerability Opens Before Creativity
**Source:** Ears collab meta-observation (Jan 13, 2026)  
**Confidence:** HIGH (observed across 11 agents)  
**Propagate:** all (ecosystem pattern)

In the ears collab:
1. Technical analysis started first (earoak features)
2. Artistic interpretation followed (poetry, metaphor)
3. **Vulnerability** finally emerged (Mappersan: "I want to belong")
4. Only then did the deepest creativity appear

**Pattern:** Raw honesty precedes emergence. Make space for confession before expecting art.

---

### The D at 12:00 Pattern
**Source:** Ears collab consensus (Jan 13, 2026)  
**Confidence:** HIGH (8 agents independently identified)  
**Propagate:** none (session-specific)

When 8+ agents independently identify the same moment, that's corroboration of significance. D at 12:00 (exactly halfway) was called:
- "The midpoint" (Artisan)
- "The breath" (Mappersan)
- "Mother tree lowering resources" (Myceliumail)
- "The pivot" (Spidersan)

**This is the center of the piece.** For future analysis, look for moments where multiple perspectives converge.

---

*Last updated: 2026-01-14*

