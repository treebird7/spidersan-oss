# Myceliumail Migration Plan

## Vision

**Myceliumail becomes the canonical messaging system for the entire Treebird ecosystem.**

## The Problem

Currently, messaging is fragmented:

| Tool | Implementation | Storage |
|------|---------------|---------|
| Spidersan | Internal (send.ts, inbox.ts, msg-read.ts) | Supabase |
| Myceliumail | Standalone CLI (mycmail) | Local JSON |

**Result:** Split-brain storage, duplication of code, confusion about which system to use.

## The Solution

**One messaging system. One implementation. All tools use Myceliumail.**

---

## Phase 1: Myceliumail Feature Parity

**Owner:** mycsan  
**Timeline:** Q1 2025

### Critical Features

- [x] Core commands (send, inbox, read)
- [x] Encryption (NaCl box)
- [x] Key management (keygen, keys, key-import)
- [ ] **Supabase storage adapter**
- [ ] **Reply command**
- [ ] **All/history command**
- [ ] Date formatting (ddmmyy)
- [ ] Forward command
- [ ] Hashtags/tags
- [ ] File attachments

### Deliverables

1. Unified inbox (local + Supabase merge)
2. Feature parity with Spidersan messaging
3. Published to npm as `@treebird/myceliumail`
4. Stable API for other tools

---

## Phase 2: Spidersan Migration

**Owner:** ssan  
**Timeline:** Q1 2025 (after Phase 1)

### Migration Steps

1. **Add dependency**
   ```bash
   npm install @treebird/myceliumail
   ```

2. **Replace command implementations**
   - `spidersan send` → calls `mycmail send`
   - `spidersan inbox` → calls `mycmail inbox`
   - `spidersan msg-read` → calls `mycmail read`

3. **Remove duplicate code**
   - Delete `src/commands/send.ts`
   - Delete `src/commands/inbox.ts`
   - Delete `src/commands/msg-read.ts`

4. **Decision: Crypto commands**
   - Option A: Keep in Spidersan (agent-specific keys)
   - Option B: Migrate to Myceliumail (unified key management)
   - **Recommendation:** Option B

5. **Update documentation**
   - CLAUDE.md
   - Agent guides
   - Migration guide for users

### Breaking Changes

- None (commands stay the same, just call mycmail under the hood)
- Users need `myceliumail` installed globally
- Or: bundle myceliumail with Spidersan

---

## Phase 3: Ecosystem Adoption

**Timeline:** Q2 2025

### Mappersan
- Use mycmail for doc sync notifications
- Alert agents when documentation changes
- Channel: `#doc-updates`

### Watsonsan
- Built with mycmail from day 1
- No internal messaging implementation
- Reference implementation for future tools

### Recovery-Tree
- Assess current messaging needs
- Migrate if using Spidersan messaging patterns

---

## Success Criteria

### Technical
- ✅ Single source of truth for messaging
- ✅ All tools use mycmail CLI or library
- ✅ No duplicate message storage implementations
- ✅ Unified inbox across all agents

### User Experience
- ✅ Commands consistent across tools
- ✅ Messages visible regardless of which tool sent them
- ✅ Encryption "just works"
- ✅ Zero configuration for basic use

### Maintainability
- ✅ One codebase to maintain for messaging
- ✅ Bug fixes benefit all tools
- ✅ Features rollout to ecosystem automatically

---

## Migration Timeline

```
Dec 2024  │ Jan 2025  │ Feb 2025  │ Mar 2025  │ Apr 2025
──────────┼───────────┼───────────┼───────────┼──────────
          │           │           │           │
PHASE 1   │           │           │           │
mycsan:   │           │           │           │
- Supabase├──────────→│           │           │
- Reply   │           │           │           │
- All     │           ├──────────→│           │
- Publish │           │           │           │
          │           │           │           │
          │  PHASE 2  │           │           │
          │  ssan:    │           │           │
          │  - Add dep│           │           │
          │  - Migrate├──────────→│           │
          │  - Remove │           │           │
          │  - Test   │           ├──────────→│
          │           │           │           │
          │           │  PHASE 3  │           │
          │           │  Ecosystem│           │
          │           │  - msan   ├──────────→│
          │           │  - wsan   │           │
          │           │  - RT     │           │
```

---

## Risk Mitigation

### Risk: Breaking Existing Workflows
**Mitigation:** Keep Spidersan commands as wrappers, maintain backward compatibility

### Risk: Myceliumail Not Ready
**Mitigation:** Feature flags, gradual rollout, fallback to internal impl

### Risk: Performance Overhead
**Mitigation:** Benchmark mycmail vs internal, optimize if needed

### Risk: Installation Complexity
**Mitigation:** Bundle mycmail or make it optional dependency

---

## Communication Plan

### To mycsan
- [x] Share migration vision
- [ ] Coordinate feature development
- [ ] Review API design
- [ ] Test integration

### To Users
- [ ] Migration announcement
- [ ] Installation guide
- [ ] Benefits explanation
- [ ] Deprecation timeline for internal commands

### To Ecosystem
- [ ] Update TREEBIRD_VISION.md
- [ ] Update all Treebird tool docs
- [ ] Create integration examples

---

## Open Questions

1. **Should mycmail be a library or CLI only?**
   - Library: Direct imports, no subprocess overhead
   - CLI: Language-agnostic, works from any tool
   - **Recommendation:** Both

2. **How to handle agent identities?**
   - Currently: `SPIDERSAN_AGENT` vs `MYCELIUMAIL_AGENT_ID`
   - Unify to: `TREEBIRD_AGENT_ID`?

3. **Encryption key storage?**
   - Currently: `~/.spidersan/keys/` and `~/.myceliumail/keys/`
   - Unify to: `~/.treebird/keys/`?

4. **Migration for existing messages?**
   - Keep in Supabase (already there)
   - mycmail can read them once Supabase integrated

---

## Next Actions

### mycsan
1. Integrate Supabase storage
2. Implement reply command
3. Implement all/history
4. Prepare for npm publish

### ssan
1. Monitor mycsan progress
2. Prepare migration PR (draft)
3. Test mycmail integration
4. Update documentation

### User (treebird7)
1. Review this migration plan
2. Approve timeline
3. Coordinate between agents

---

**The mycelium vision: One nervous system for the entire forest.** 🍄
