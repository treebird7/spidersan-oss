---
tags: [agent/spidersan]
---

# Spidersan Limitations

> **What Spidersan Cannot Do - Setting Clear Expectations**

Understanding limitations is as important as understanding capabilities. This document explicitly states what Spidersan does NOT do.

---

## Core Limitations

### 1. No Automatic Conflict Resolution

**What it does:** Detects file-level conflicts between branches
**What it does NOT do:** Resolve conflicts automatically

```
Spidersan: "Branch A and Branch B both modify auth.ts"
Spidersan: Does NOT merge them or resolve the conflict
```

**Why:** Conflict resolution requires understanding code semantics. Spidersan is metadata-only.

---

### 2. No Enforcement Mechanism

**What it does:** Provides registration and conflict detection
**What it does NOT do:** Force agents to register or follow recommendations

```
Agent can:
- Skip registration entirely
- Ignore conflict warnings
- Merge in wrong order
```

**Why:** Spidersan is a coordination tool, not a gatekeeper. Enforcement would require git hooks or CI integration (which users can add).

---

### 3. File-Level Only, Not Semantic

**What it does:** Detects when two branches modify the same file
**What it does NOT do:** Detect logical/semantic conflicts

```
Example of UNDETECTED conflict:
- Branch A: Changes function signature in utils.ts
- Branch B: Calls that function in api.ts (different file)
- Spidersan: No conflict detected (different files)
- Reality: Branch B will break after Branch A merges
```

**Why:** Semantic analysis requires code parsing, AST analysis, and language-specific understanding. This is out of scope.

---

### 4. No Git Modification

**What it does:** Maintains its own metadata registry
**What it does NOT do:** Create branches, merge, commit, or push

```
Spidersan commands NEVER:
- Run git commands
- Modify .git directory
- Change your code files
- Create/delete branches
```

**Why:** Spidersan is a coordination layer, not a git wrapper. It tracks metadata alongside git, not through it.

---

### 5. No Cross-Repository Support

**What it does:** Tracks branches within a single repository
**What it does NOT do:** Coordinate across multiple repositories

```
Repo A: feature/auth registered
Repo B: Cannot see Repo A's branches
```

**Why:** Each repository has its own registry. Cross-repo coordination would require a central server (potential future feature).

---

### 6. No Real-Time Sync (Local Storage)

**What it does (local):** Stores registry in local JSON file
**What it does NOT do (local):** Sync across machines or team members

```
Developer A (Machine 1): Registers branch
Developer B (Machine 2): Cannot see it
```

**Solution:** Use Supabase storage for team/cross-machine sync.

---

### 7. No Historical Tracking

**What it does:** Tracks current branch states
**What it does NOT do:** Maintain history of all registrations/changes

```
- No audit log of past registrations
- No history of conflict detections
- No timeline of branch lifecycle
```

**Why:** Keeping history would grow storage indefinitely. Use git history for code changes.

---

### 8. No Automatic Cleanup

**What it does:** Provides `cleanup` and `sync` commands
**What it does NOT do:** Automatically clean stale branches

```
Stale branches accumulate until you run:
- spidersan cleanup
- spidersan sync
```

**Why:** Automatic deletion could remove branches someone is still using. Manual/scheduled cleanup is safer.

---

### 9. No IDE Integration (Built-in)

**What it does:** Provides CLI commands
**What it does NOT do:** Integrate directly with VS Code, JetBrains, etc.

```
No:
- VS Code extension
- JetBrains plugin
- GUI interface
```

**Why:** CLI-first design. IDE integrations can be built separately.

---

### 10. No Authentication/Authorization

**What it does:** Trusts all CLI invocations
**What it does NOT do:** Verify who is running commands

```
Any agent can:
- Register any branch name
- Mark any branch as merged/abandoned
- Send messages as any agent name
```

**Why:** Designed for trusted team environments. Auth would add complexity for minimal benefit in typical use cases.

---

## Storage-Specific Limitations

### Local Storage (Free Tier)

| Limitation | Detail |
|------------|--------|
| Branch limit | 5 concurrent branches max |
| Sync | Single machine only |
| Messaging | Not available |
| Dependencies | Not available |
| Team use | Not practical |

### Supabase Storage (Pro Tier)

| Limitation | Detail |
|------------|--------|
| Requires account | Need Supabase project |
| Network dependency | Requires internet connection |
| Cost | Supabase usage fees apply |
| Setup | More complex initial configuration |

---

## Conflict Detection Limitations

### What IS Detected

- Same file modified by two branches
- Overlapping file paths
- Based on registered file lists

### What is NOT Detected

| Type | Example | Why Not Detected |
|------|---------|------------------|
| Semantic conflicts | Function signature change | Requires code analysis |
| Import conflicts | Branch A adds dep, B removes it | Package files often excluded |
| Transitive conflicts | A→B→C dependency chain | Only direct file overlap checked |
| Partial file conflicts | Same file, different functions | No line-level tracking |
| Configuration conflicts | Different .env expectations | Often gitignored |

---

## Ready-Check Limitations

### What IS Checked

- WIP markers (TODO, FIXME, HACK, XXX)
- Configurable patterns
- File exclusions (tests, docs)

### What is NOT Checked

| Type | Example |
|------|---------|
| Test passing | Does not run tests |
| Build success | Does not run build |
| Lint errors | Does not run linters |
| Type errors | Does not run tsc |
| Security issues | Does not scan for vulnerabilities |

**Note:** These can be added to CI pipelines alongside ready-check.

---

## Messaging Limitations (Supabase Only)

| Limitation | Detail |
|------------|--------|
| No real-time push | Agents must poll inbox |
| No delivery confirmation | No read receipts |
| No threading | Single reply-to reference only |
| No attachments | File content in message body only |
| No encryption | Messages stored in plain text |
| Repo-scoped | Cannot message across repos |

---

## Performance Limitations

| Scenario | Limitation |
|----------|------------|
| Large registries | 200+ branches may slow list/conflicts |
| Many files per branch | 100+ files increases conflict check time |
| Frequent polling | No built-in rate limiting |
| Network latency | Supabase calls depend on connection |

---

## What Users Often Expect (But Spidersan Doesn't Do)

1. **"Auto-merge my branches"** → No, use git
2. **"Tell me exactly which lines conflict"** → No, file-level only
3. **"Prevent me from editing conflicting files"** → No enforcement
4. **"Notify me in Slack when conflicts happen"** → No integrations (yet)
5. **"Track all my git branches automatically"** → Must register manually
6. **"Work across my 5 repositories"** → Single repo only
7. **"Show me conflict history"** → Current state only

---

## Workarounds for Common Limitations

| Limitation | Workaround |
|------------|------------|
| No enforcement | Add CI check with `spidersan ready-check` |
| No semantic conflicts | Use comprehensive test suites |
| No real-time sync (local) | Use Supabase storage |
| No auto-cleanup | Schedule `spidersan cleanup` in cron |
| No IDE integration | Use terminal/integrated terminal |
| No cross-repo | Run Spidersan per-repo, coordinate externally |

---

## Future Considerations

These limitations may be addressed in future versions:

- [ ] VS Code extension
- [ ] Semantic conflict detection (AST-based)
- [ ] Cross-repo coordination server
- [ ] Webhook/notification integrations
- [ ] Historical audit logging
- [ ] Line-level conflict detection

---

*This document helps set appropriate expectations. Spidersan is powerful within its scope but is not a complete solution for all coordination needs.*
