---
tags: [architecture, roadmap, ecosystem, public-release]
---

# Spidersan Ecosystem Architecture Plan

**Status:** Planning Phase  
**Target Release:** Phase-based  
**Priority:** HIGH - Enables clean public release + ecosystem expansion

---

## Overview

Spidersan will be released in two versions:

1. **Spidersan Core** (Public, MIT) - Clean, focused branch coordination CLI
2. **Spidersan Ecosystem** (Treebird-internal, future public) - Advanced features for coordinated team work

This separation:
- ✅ Provides a clean, simple public tool
- ✅ Keeps experimental/ecosystem features contained
- ✅ Allows learning and iteration before public release
- ✅ Prevents credibility damage from half-baked features
- ✅ Makes the tool accessible to beginners
- ✅ Maintains experimental playground for advanced ideas

---

## Architecture Design

### File Structure

```
spidersan/ (Public - MIT Licensed)
├── src/
│   ├── bin/
│   │   └── spidersan.ts           [MODIFIED - plugin loader]
│   ├── commands/
│   │   ├── core/                  [15 core commands]
│   │   │   ├── init.ts
│   │   │   ├── register.ts
│   │   │   ├── list.ts
│   │   │   ├── conflicts.ts
│   │   │   ├── merge-order.ts
│   │   │   ├── ready-check.ts
│   │   │   ├── depends.ts
│   │   │   ├── stale.ts
│   │   │   ├── cleanup.ts
│   │   │   ├── rescue.ts
│   │   │   ├── abandon.ts
│   │   │   ├── merged.ts
│   │   │   ├── sync.ts
│   │   │   ├── watch.ts
│   │   │   └── doctor.ts
│   │   ├── ecosystem-loader.ts    [NEW - optional plugin system]
│   │   └── index.ts               [MODIFIED - export both core + ecosystem]
│   ├── lib/
│   │   ├── storage/               [Shared - used by both versions]
│   │   ├── ast.ts                 [Shared - AST parsing utilities]
│   │   ├── crdt.ts                [Shared - CRDT state management]
│   │   ├── security.ts            [Shared - security helpers]
│   │   └── ...                    [All utilities both use]
│   └── tui/                       [Shared - dashboard components]
├── package.json                   [NO ecosystem dependencies]
├── tsconfig.json
├── README.md                      [MODIFIED - mention ecosystem]
└── LICENSE                        [MIT - public and clear]

treebird-internal/spidersan-ecosystem/ (Private, future public)
├── src/
│   ├── commands/
│   │   ├── collab.ts
│   │   ├── collab-sync.ts
│   │   ├── semantic.ts
│   │   ├── lock.ts
│   │   ├── torrent.ts
│   │   ├── monitor.ts
│   │   ├── intent-scan.ts
│   │   ├── active-windows.ts
│   │   ├── radar.ts
│   │   ├── tension.ts
│   │   ├── audit-mark.ts
│   │   └── messaging/
│   │       ├── send.ts
│   │       ├── inbox.ts
│   │       ├── msg-read.ts
│   │       ├── keygen.ts
│   │       ├── key-import.ts
│   │       └── keys.ts
│   └── index.ts                   [Exports all ecosystem commands]
├── package.json                   [Depends on spidersan + ecosystem libs]
├── README.md                      [Ecosystem-specific features]
└── LICENSE                        [Same as spidersan initially]
```

---

## Implementation Phases

### Phase 1: Foundation (Week 1)
**Goal:** Create the plugin system without breaking anything

**Changes to spidersan-public:**

1. **Create ecosystem loader** (`src/commands/ecosystem-loader.ts`)
```typescript
/**
 * Optional ecosystem command loader
 * Gracefully loads spidersan-ecosystem if installed
 */
export async function loadEcosystemCommands(): Promise<Command[]> {
    try {
        const ecosystem = await import('spidersan-ecosystem');
        return ecosystem.getCommands();
    } catch (e) {
        // Silently fail if ecosystem not installed
        return [];
    }
}

export async function isEcosystemAvailable(): boolean {
    try {
        await import('spidersan-ecosystem');
        return true;
    } catch {
        return false;
    }
}
```

2. **Modify entry point** (`src/bin/spidersan.ts`)
```typescript
// At the end, before program.parse()
const ecosystemCommands = await loadEcosystemCommands();
ecosystemCommands.forEach(cmd => program.addCommand(cmd));

// Optional: Add footer to help if ecosystem available
if (await isEcosystemAvailable()) {
    console.log('💡 Spidersan Ecosystem features loaded');
}

program.parse();
```

3. **Update exports** (`src/commands/index.ts`)
- Keep all core exports
- Export ecosystem-loader
- Remove ecosystem command imports (they'll come from plugin)

**Status:** ✅ Spidersan still works exactly the same, no dependencies added

---

### Phase 2: Extraction (Week 2)
**Goal:** Move ecosystem commands out, keep them working

**Create new repo structure in treebird-internal:**

1. **Create spidersan-ecosystem package**
   - Copy 16 ecosystem command files
   - Create index.ts that exports all commands
   - Create package.json with ecosystem dependencies

2. **Create exports** (`spidersan-ecosystem/src/index.ts`)
```typescript
import { collabCommand } from './commands/collab.js';
import { lockCommand } from './commands/lock.js';
// ... etc

export function getCommands(): Command[] {
    return [
        collabCommand,
        lockCommand,
        semanticCommand,
        torrentCommand,
        monitorCommand,
        intentScanCommand,
        activeWindowsCommand,
        radarCommand,
        collabSyncCommand,
        syncAllCommand,
        tensionCommand,
        auditMarkCommand,
        // Messaging
        sendCommand,
        inboxCommand,
        msgReadCommand,
        keygenCommand,
        keyImportCommand,
        keysCommand,
    ];
}
```

3. **Update spidersan-public to remove ecosystem commands**
   - Delete 16 command files
   - Remove their imports from index.ts
   - Keep src/lib/ and shared utilities

**Status:** ✅ Both versions compile and work independently

---

### Phase 3: Polish Public Version (Week 3)
**Goal:** Make spidersan-public shine as a standalone tool

**Updates to spidersan-public:**

1. **Clean up README.md**
   - Show only 15 core commands
   - Add section: "Coming Soon: Ecosystem Features"
   - Explain what ecosystem is (without details)

2. **Update CLAUDE.md**
   - Remove ecosystem commands
   - Keep only core feature set
   - Link to future ecosystem docs

3. **Simplify documentation**
   - Update CLI help to not mention ecosystem features
   - Create GETTING_STARTED.md focused on core use cases
   - Keep USAGE.md simple and beginner-friendly

4. **Update package.json**
   ```json
   {
     "name": "spidersan",
     "description": "Branch coordination for AI coding agents",
     "dependencies": {
       "commander": "^11.0",
       "chalk": "^5.0",
       "sqlite3": "^5.0"
     }
     // NO ecosystem dependencies
   }
   ```

**Status:** ✅ Public version is clean, focused, and beginner-friendly

---

### Phase 4: Document Ecosystem (Future)
**Goal:** When ready, document ecosystem for other Treebird users

This happens when:
- Spidersan core has been publicly validated
- You're comfortable with ecosystem feature stability
- Treebird ecosystem is ready for gradual release

**Example timeline:** 2-3 months of public spidersan, then ecosystem features roll out

---

## README Strategy

### Current Public Version

```markdown
# 🕷️ Spidersan

Branch coordination for AI coding agents. Simple, focused, no bloat.

## Installation

npm install -g spidersan

## Core Features (15 commands)

### Registration & Tracking
- spidersan init - Initialize in a project
- spidersan register - Register files you'll modify  
- spidersan list - List registered branches

### Conflict Detection
- spidersan conflicts - Show file conflicts
- spidersan merge-order - Get merge sequence
- spidersan ready-check - Verify branch is ready

### Branch Lifecycle
- spidersan depends - Declare dependencies
- spidersan stale - Find old branches
- spidersan cleanup - Remove stale branches
- spidersan rescue - Salvage rogue work
- spidersan abandoned - Mark as abandoned
- spidersan merged - Mark as merged
- spidersan sync - Sync with git

### Diagnostics
- spidersan watch - Watch files for changes
- spidersan doctor - Diagnose issues

[See USAGE.md for full documentation]

## Advanced Features Coming Soon

Spidersan will soon support advanced team coordination features through **Spidersan Ecosystem** - a set of optional extensions for users working within the Treebird ecosystem.

Features in development:
- Real-time branch monitoring dashboards
- Semantic conflict detection via knowledge graphs
- Intent scanning for duplicate work detection
- CRDT-based symbol locking
- Task distribution and coordination
- Team messaging and notifications

These will be released gradually as they mature. Subscribe to the [GitHub Discussions](link) to stay updated.

## For Treebird Ecosystem Users

If you're part of the Treebird ecosystem and want early access to experimental features, see [ECOSYSTEM.md](link) (internal only).

## Contributing

Contributions welcome! Focus areas:
- Bug fixes and stability improvements
- Better documentation
- Performance optimizations
- Integration with more Git workflows

See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

---

Made with 🕷️ for AI-first development
```

### Future Ecosystem Version (treebird-internal)

```markdown
# 🕷️ Spidersan Ecosystem

Advanced team coordination features for Treebird ecosystem users.

Requires:
- spidersan >= 0.4.0
- Treebird infrastructure (Hub, Myceliumail, etc.)

## Installation

npm install spidersan spidersan-ecosystem

## Ecosystem Features

[All 16 advanced commands documented here]

---

Only for Treebird ecosystem users. Internal use only.
```

---

## Communication to Public

### Initial Release (Now)

```
Spidersan 0.4.0 - Public Release
================================

🎉 Spidersan is now available on npm!

Simple, focused branch coordination for AI agents.

What's included:
- 15 core commands
- Zero dependencies beyond essentials
- MIT Licensed
- Works standalone, no ecosystem needed

What's coming:
- Advanced ecosystem features (Q1 2026)
- Better documentation and tutorials
- Community feedback integration

GitHub: https://github.com/treebird7/spidersan
```

### Ecosystem Announcement (Later, when ready)

```
Spidersan Ecosystem - Now Available
===================================

For Treebird ecosystem users, advanced features are now available!

If you're already using Treebird Hub, Myceliumail, and want:
- Real-time monitoring dashboards
- Semantic conflict detection
- Smart task distribution
- Team coordination features

npm install spidersan-ecosystem

[Ecosystem documentation here]
```

---

## What Stays the Same

✅ **Both versions share:**
- Core library code (`src/lib/`)
- AST parsing, CRDT state, security utilities
- Storage adapters
- TUI dashboard components
- Same data format and compatibility

✅ **No breaking changes:**
- Users can install ecosystem later without issues
- Ecosystem features layer on top, don't modify core
- Version spidersan strictly, ecosystem depends on known version

✅ **Both are experimentable:**
- Public: Simple foundation everyone can use
- Ecosystem: Where you innovate with advanced ideas

---

## Migration Path

### For Current Users

If you're currently using spidersan-oss as it is:

```bash
# No action needed
npm update spidersan

# Spidersan still has all same commands
spidersan init
spidersan register
# ... etc

# Your scripts, automations, everything still works
```

### For Ecosystem Users (in treebird-internal)

```bash
# Install both
npm install spidersan spidersan-ecosystem

# Core commands work
spidersan init

# Ecosystem commands auto-load
spidersan lock                    # NEW
spidersan semantic                # NEW
spidersan collab                  # NEW
spidersan monitor                 # NEW
# ... etc
```

---

## Risk Mitigation

### Version Pinning

**spidersan-ecosystem/package.json:**
```json
{
  "dependencies": {
    "spidersan": "0.4.0"  // Exact version, no ^
  }
}
```

This ensures ecosystem always uses known-compatible core version.

### Graceful Degradation

If ecosystem fails to load:
- Core spidersan still works 100%
- No error shown to user (silent fail)
- Optional: flag `--verbose` shows what happened

### Testing

Both versions tested independently:
```bash
# Test core in spidersan-public
npm test

# Test ecosystem separately
cd ../treebird-internal/spidersan-ecosystem
npm test

# Integration test (both installed)
npm install
spidersan conflicts  # core works
spidersan lock       # ecosystem works
```

---

## Rollout Timeline

| Date | Phase | Action |
|------|-------|--------|
| Week 1 | Foundation | Create plugin system in spidersan-public |
| Week 2 | Extraction | Create spidersan-ecosystem, move commands |
| Week 3 | Polish | Clean up public docs, test both versions |
| Month 2 | Public Beta | Release spidersan 0.4.0 publicly (core only) |
| Month 3 | Ecosystem Beta | Start releasing ecosystem features to internal team |
| Month 6 | Public Ecosystem | When ready, announce ecosystem features publicly |

---

## Why This Architecture

### Before (Current State)
❌ 47 commands in one repo
❌ 16 commands are ecosystem-only but published as core
❌ Credibility damage ("vibe coded")
❌ Confusion about what spidersan actually is
❌ Hard to iterate on experimental features

### After (This Plan)
✅ 15 core commands - simple, focused
✅ 16 ecosystem commands - separate, optional
✅ Clear public story - "branch coordination CLI"
✅ Clear private story - "Treebird advanced features"
✅ Room to experiment without damaging public trust
✅ Easy for beginners to learn core
✅ Easy for power users to unlock advanced features

---

## Questions You Might Have

**Q: Will ecosystem commands get published to npm eventually?**  
A: Yes, when the ecosystem is public and stable. For now, it's treebird-internal only.

**Q: Can I still develop ecosystem features?**  
A: Absolutely! They'll just live in treebird-internal/spidersan-ecosystem and are optional.

**Q: What if someone forks spidersan and adds their own ecosystem?**  
A: Perfect! The plugin system lets anyone extend spidersan with their own commands.

**Q: Will users be confused about core vs ecosystem?**  
A: No - if ecosystem isn't installed, users won't see references to it. It's seamless.

**Q: How much work is this?**  
A: ~5 hours of work, one-time setup. Then it's automatically cleaner maintenance.

**Q: Can I change my mind later?**  
A: Absolutely. This is designed to be reversible. Just move commands back if needed.

---

## Next Steps

1. **Review this plan** with your team
2. **Create the plugin system** (ecosystem-loader.ts)
3. **Create spidersan-ecosystem** structure in treebird-internal
4. **Run both versions** in parallel to verify they work
5. **Update public README** with ecosystem section
6. **Release spidersan 0.4.0** - clean public version
7. **Iterate on ecosystem** features privately
8. **Release ecosystem features** when ready

---

## Resources for Learning

Since you're new to open source, here are some helpful concepts:

**Plugin Systems:**
- What you're building is similar to: Vite plugins, Jest plugins, ESLint plugins
- Pattern: Main package exports hooks, external package implements them
- Benefit: Extensibility without bloat

**Monorepos:**
- You could also use a monorepo approach (one repo with multiple packages)
- For now, separation works well - keeps things simple

**Semantic Versioning:**
- spidersan: 0.4.0 (major.minor.patch)
- Ecosystem depends on exact version = no surprise breaking changes
- Good practice for stability

**Graceful Degradation:**
- Your plugin loader catches errors = core always works
- This is good software engineering - fail gracefully

---

## Summary

This architecture:
- **Cleans up public spidersan** to 15 focused commands
- **Keeps ecosystem features alive** in treebird-internal
- **Lets you innovate** without damaging public reputation
- **Is reversible** - you can always change direction
- **Follows open source best practices** - clean boundaries, clear dependencies
- **Helps you learn** - simple plugin pattern you'll see everywhere

Most importantly: **You can release spidersan 0.4.0 publicly with confidence**, knowing it's focused, stable, and tells a clear story.

The ecosystem features can mature privately, and when they're ready, users can opt in.

---

**Created:** January 26, 2026  
**Status:** Ready for implementation  
**Owner:** treebird7 (you!)  
**Questions?** Discuss in ARCHITECTURE_DISCUSSION.md or GitHub Discussions
