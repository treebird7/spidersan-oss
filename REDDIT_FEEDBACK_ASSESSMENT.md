---
tags: [feedback, assessment, licensing, critical]
---

# Reddit Feedback Assessment Report

**Date:** January 26, 2026  
**Status:** Remediation in progress (MIT-only decision)  
**Severity:** 🔴 HIGH

---

## Executive Summary

The Reddit feedback raises **4 major categories of legitimate concerns**:

1. **Merge Order Advice Validity** - Partially valid criticism
2. **Benchmarks Lack Scientific Rigor** - Valid and concerning
3. **"Vibe Coded" Perception** - Documentation gaps creating this perception
4. **Critical Licensing Issues** - **MAJOR LEGAL RISK** (remediated by MIT-only decision)

The licensing issues are the most serious and required immediate correction before any public repositioning.

---

## Update (MIT-only decision)

As of 2026-01-26, Spidersan is MIT-only. Pro/BSL is removed and the licensing model is consolidated.

Remediation applied:
- Consolidated licensing to MIT-only (single authoritative `LICENSE` with pointer docs).
- Removed Pro/BSL references and pricing from docs and MCP README.
- Removed license-gating code and Pro commands from the CLI and MCP server.
- Reframed benchmark wording in README as a local experiment and experience.

---

## Detailed Issue Assessment

### 1. ❌ Git Merge Order Advice (Medium Priority)

**Feedback Summary:**  
> "Modern Git will figure out conflicts... merge order doesn't help... your example of oauth → auth dependencies is obvious and doesn't need a tool"

**Assessment:** **PARTIALLY VALID**

**Context:**
- The user makes a fair point that modern Git is better at conflict resolution than older versions
- However, not all merge orders are equivalent for *merge success confidence* (not just technical success)
- The example given (oauth dependency) IS obvious and shouldn't require a tool
- The user's actual PR had unavoidable conflicts regardless of order

**Recommendation:**  
- ✅ Reframe `merge-order` to focus on **dependency clarity** not conflict prevention
- ✅ Remove the "optimal merge order prevents conflicts" language from marketing
- ✅ Acknowledge that modern Git is good; focus on visibility/coordination instead
- ✅ Position as "make dependencies explicit" not "solve conflicts automatically"

---

### 2. ❌ Benchmarks Section (High Priority)

**Current Issue:**
- README claims: "51 min → 5 min (10x faster)" with **NO DATA SOURCE**
- No methodology explained
- No actual test cases documented
- Appears completely speculative

**Assessment:** **VALID - This is a Red Flag**

**Location:** [README.md](README.md#L22-L49)

**Current problematic text:**
```markdown
**10 AI agents. 1 file. 51 minutes of chaos.**

Without coordination:
- ⏱️ 51 min to complete 1 shared file
- 💥 12 conflicts
- 🔥 2 build breaks pushed to main
- 😰 Frustration level: 5/5

## 🕷️ The Solution

**Results with Spidersan:**
- ⏱️ 5 min (10x faster)
- ✅ 0 conflicts
- 🎯 Optimal merge sequence
```

**Problems:**
1. ❌ No source data or methodology
2. ❌ Looks like "vibe coded" hypothesis, not real data
3. ❌ Could be called deceptive marketing
4. ❌ Damages credibility with technical audience

**Recommendation:**
- **Option A (Honest):** Replace with "typical scenario" disclaimer
- **Option B (Better):** Collect real data from actual users and replace with real benchmarks
- **Option C (Now):** Change to hypothetical framing: "**Example scenario:** Without coordination, you might see..."

---

### 3. 🟡 "Vibe Coded" Perception (Medium Priority)

**Feedback:** 
> "Your GitHub repo and website appear to be entirely or mostly vibe coded"

**Assessment:** **PARTIALLY VALID**

**Evidence:**
- ✅ `-oss` suffix in repo name is unusual (the license makes it clear it's open source)
- ✅ Multiple inconsistent documentation about features
- ✅ Features described in CLAUDE.md don't all exist in code
- ✅ Pro/BSL removed; MIT-only as of 2026-01-26

**Recommendation:**
- ✅ Rename repo from `spidersan-oss` to `spidersan` (license makes it clear)
- ✅ Remove non-existent feature claims (Unlimited Branches, Conflict Prediction, MCP Server)
- ✅ Clean up feature tables to only list what actually exists
- ✅ Mark shelved features clearly as "planned" or "removed"

---

### 4. 🔴 CRITICAL: Licensing Issues (CRITICAL Priority)

This is the most serious issue. The feedback correctly identifies multiple legal problems.

**Update:** These licensing issues are now resolved by removing Pro/BSL and consolidating to MIT-only. The details below are preserved for historical context.

#### **Problem 4.1: Three Conflicting License Files**

**Current State:**
- `LICENSE` - MIT only
- `LICENSE.md` - Describes dual licensing
- `docs/LICENSE.md` - Different descriptions

**The Legal Problem:**
The existence of three license files with different content creates **legal ambiguity**. Under copyright law, a user could reasonably claim:
- "The root LICENSE file says MIT, so the entire project is MIT-licensed"
- Then modify code freely (including `isPro()` bypass) without respecting BSL

**Assessment:** **VALID - This is a real legal vulnerability**

**Recommendation:**
- ✅ Keep ONLY ONE authoritative license file
- ✅ Structure should be:
  - `LICENSE` = BSL 1.1 (the restrictive one - must include full text)
  - `COPYING.md` = MIT (for the free parts, reference the MIT license text in docs)
  - `docs/LICENSE.md` = Detailed explanation (not a license file itself)

---

#### **Problem 4.2: "Core CLI" Is NOT Properly Defined**

**Current Issue:**
From [LICENSE.md](LICENSE.md#L11-L18):
```markdown
## Core CLI (MIT License)

The following features are available under the MIT License:

- `spidersan list` - List all registered branches
- `spidersan register` - Register a branch with the coordinator
- `spidersan conflicts` - Show file conflicts between branches
- `spidersan merge-order` - Get optimal merge order
- `spidersan ready-check` - Verify branch is ready to merge
```

But from [docs/LICENSE.md](docs/LICENSE.md#L13-L24):
```markdown
The following components are licensed under the MIT License:

- CLI commands: `init`, `register`, `list`, `merge-order`, `cleanup`
- SQLite storage adapter
- Basic branch registry
- Configuration file handling
```

**Problems:**
1. ❌ Two different lists of "core" features
2. ❌ No clear file-level mapping (which files in src/ are MIT vs BSL?)
3. ❌ `src/lib/isPro()` or similar isn't mentioned
4. ❌ Can't enforce licensing at code level without clear boundaries

**The BSL 1.1 Requirement:**
> "You must include with the distribution of the Licensed Work a notice that identifies which parts of the Licensed Work are covered by this License"

**You're not doing this.**

**Recommendation:**
- ✅ Create **license header comments** in EVERY file:
  ```typescript
  /**
   * SPDX-License-Identifier: MIT
   * Part of Spidersan's core CLI (free, open source)
   */
  
  // OR
  
  /**
   * SPDX-License-Identifier: BUSL-1.1
   * Business Source License 1.1
   * Licensor: treebird7
   * Licensed Work: Spidersan Pro Features
   * Change Date: 2029-01-26
   * Change License: MIT
   */
  ```

- ✅ Create a clear mapping document:
  ```
  CORE CLI (MIT):
  - src/bin/
  - src/commands/register.ts
  - src/commands/list.ts
  - src/commands/conflicts.ts
  - src/storage/sqlite.ts
  
  PRO FEATURES (BSL-1.1):
  - src/commands/conflictPrediction.ts
  - src/features/proFeatures.ts
  - etc.
  ```

---

#### **Problem 4.3: The FAQ is Contradictory**

**Current Issue:**
From [docs/LICENSE.md](docs/LICENSE.md#L111):
```markdown
Can I use the free version at work?
Yes, if your company has less than $1M annual revenue and you're not reselling it.
```

**But also says (line 21-25):**
```
Core CLI (MIT License) - available freely with no restrictions
```

**The Problem:**
- MIT License has **NO revenue restrictions**
- Only BSL 1.1 has the $1M threshold
- So this FAQ answer only makes sense for **Pro features** (which aren't implemented)
- But it's presented as if it applies to the free version

**Also contradicts the summary table (lines 74-77):**
```
| **Pro** (`/pro`) | Business Source License 1.1 | Paid for commercial use |
```

**This is wrong.** BSL 1.1 is NOT "paid for commercial use" - it's free under $1M revenue.

**Recommendation:**
- ✅ Clarify: "Core CLI (MIT) - free forever, no restrictions"
- ✅ Clarify: "Pro Features (BSL 1.1) - free for companies under $1M annual revenue"
- ✅ Rewrite FAQ to be clear which features each license applies to

---

#### **Problem 4.4: Missing Required BSL Text**

**Current Issue:**
- `LICENSE` file contains ONLY MIT
- `LICENSE.md` contains a "Business Source License 1.1" but it's a **summary, not the actual license text**
- `docs/LICENSE.md` line 50+ contains more complete text but missing key clauses

**BSL 1.1 Requirements:**
The Business Source License 1.1 **requires**:
1. ✅ The full license text to be included
2. ✅ Change Date specified (you have this)
3. ✅ Change License specified (you have this)
4. ❌ **Licensor clearly identified** (in embedded text, yes)
5. ❌ **Licensed Work clearly identified** (vague in your version)

**Recommendation:**
- ✅ Get the actual BSL 1.1 text from: https://mariadb.com/bsl11/
- ✅ Include it in a dedicated file or section
- ✅ Make sure all required fields are filled in correctly

---

#### **Problem 4.5: Contact Email Still Placeholder**

**Current Issue:**
[docs/LICENSE.md](docs/LICENSE.md#L111) shows:
```
Contact: [INSERT CONTACT EMAIL]
```

**Two locations found:**
- `/Users/freedbird/Dev/spidersan-public/docs/LICENSE.md` line 111
- `/Users/freedbird/Dev/spidersan-public/Spidersan/docs/LICENSE.md` line 111

**Recommendation:**
- ✅ Replace with actual contact: `treebird@treebird.dev` (from README)

---

## Summary of Required Changes

Historical (pre-MIT-only) summary retained for context. See "Remediation Status (MIT-only)" below for current state.

### 🔴 CRITICAL (Do before shipping/marketing):

| Issue | File | Fix | Effort |
|-------|------|-----|--------|
| Three license files conflict | `LICENSE`, `LICENSE.md`, `docs/LICENSE.md` | Keep ONE authoritative file, clarify | 1 hour |
| Missing BSL license headers | All source files | Add SPDX headers | 2 hours |
| Core CLI not defined | `docs/LICENSE.md` | Create mapping doc | 1 hour |
| Contact email placeholder | `docs/LICENSE.md` (2 locations) | Replace with real email | 5 mins |
| Contradictory FAQ | `docs/LICENSE.md` | Rewrite for clarity | 30 mins |

### 🟡 HIGH (Damages credibility):

| Issue | File | Fix | Effort |
|-------|------|-----|--------|
| Benchmarks lack methodology | `README.md` | Rewrite as "example scenario" or collect real data | 1-4 hours |
| Non-existent Pro features listed | Multiple docs | Remove until implemented | 1 hour |
| `-oss` suffix in repo name | GitHub only | Rename repo (or document why) | 0.5 hours (GitHub action) |

### 🟠 MEDIUM (Improve clarity):

| Issue | File | Fix | Effort |
|-------|------|-----|--------|
| Merge-order framing | `README.md`, `CLAUDE.md` | Reframe as "visibility" not "conflict prevention" | 1 hour |

---

## Remediation Status (MIT-only)

- [x] Consolidate licensing to MIT-only and align `LICENSE`, `LICENSE.md`, and `docs/LICENSE.md`.
- [x] Remove Pro/BSL references and pricing from docs and MCP README.
- [x] Remove license-gating code and Pro commands from CLI/MCP.
- [x] Reframe README benchmark wording as a local experiment and experience.
- [ ] Continue revising merge-order language and dependency examples where still overstated.
- [ ] Decide whether to rename or document the `-oss` repo suffix.

---

## Detailed File-by-File Corrections Needed

### [README.md](README.md)
- **Lines 22-49:** Rewrite benchmark section with disclaimer or real data
- **Line 160:** Fix GitHub repo name if changing from `spidersan-oss`
- **Mentions of merge-order:** Reframe from "optimal" to "visibility"

### [LICENSE.md](LICENSE.md)
- **Full file:** Consider removing or making this just a redirect/summary
- **Problem:** Multiple interpretations of what's licensed

### [docs/LICENSE.md](docs/LICENSE.md)
- **Line 111:** Replace `[INSERT CONTACT EMAIL]` with `treebird@treebird.dev`
- **Lines 74-77:** Fix the "Pro" summary - it's not "paid for commercial use"
- **Lines 100-115:** Clarify the FAQ - which license does each restriction apply to?
- **Lines 50-70:** Include the actual BSL 1.1 license text from mariadb.com

### [src/** files](src/)
- **All files:** Add SPDX-License-Identifier headers

### New file: `docs/LICENSE_STRUCTURE.md`
- **Create:** Detailed mapping of which files are MIT vs BSL

### [CLAUDE.md](CLAUDE.md)
- **Review:** Remove or mark as "planned" any features not actually implemented
- **Specifically:** Unlimited Branches, Conflict Prediction, MCP Server mentioned in LICENSE.md but shelved

---

## Risk Assessment

### **Current Legal Position (pre-MIT-only): WEAK** ⚠️

1. **Can you enforce the BSL?** 
   - ❌ No clear definition of what's restricted
   - ❌ Someone could argue entire project is MIT
   - ❌ Missing required license text
   - ❌ Unenforceable in its current form

2. **What if someone forks and modifies?**
   - ❌ They have plausible deniability (multiple license files)
   - ❌ They could treat it as MIT
   - ❌ You'd have weak legal standing

3. **What about commercial users?**
   - ❌ Unclear what they're allowed to use
   - ❌ FAQ contradicts feature descriptions
   - ❌ They don't know what to pay for

### **Recommendation:**
**Fix this before you have users.** Once people start relying on it, changing the license becomes harder.

**Update:** MIT-only consolidation addresses the ambiguity and removes the BSL enforcement risk.

---

## Action Items

**Immediate (this week):**
- [x] Consolidate to MIT-only and remove Pro/BSL docs and code
- [x] Replace placeholder emails
- [x] Rewrite benchmark wording as local experience
- [ ] Continue merge-order wording cleanup where still overstated
- [ ] Audit dependency examples that imply enforced ordering

**Short-term (this month):**
- [ ] Decide on repo naming (`-oss`) or document rationale
- [ ] Add a short "Methodology" note if benchmark-style numbers remain anywhere

**Consider:**
- [ ] If reintroducing Pro later, define scope and licensing boundaries first
- [ ] Consult a lawyer if you plan to enforce commercial licensing in the future

---

## Reddit Feedback - Excerpt Validation

> "As I said, your licensing situation is incredibly strange and as far as I can tell you can't enforce the Business Source License 1.1 at all."

**Assessment:** ✅ **Correct.** Not currently enforceable as written.

> "you don't define anywhere what parts of the code are part of the 'core CLI'"

**Assessment:** ✅ **Correct.** Two conflicting definitions exist.

> "you never (properly) define it so you already can't enforce anything"

**Assessment:** ✅ **Correct.** Cannot enforce what isn't clearly defined.

> "Your license FAQ also says... Which makes no sense since..."

**Assessment:** ✅ **Correct.** The FAQ is contradictory.

> "you also have 3 license files... someone could claim that your project is licensed under any of these"

**Assessment:** ✅ **Correct.** This is a real legal vulnerability.

> "Your docs/LICENSE.md also says it was last updated in December 2024 which makes no sense since you made the repo only a month ago"

**Assessment:** ✅ **Correct.** Timestamp inconsistency creates confusion.

> "your software is a vibe coded slop app with an incredibly unclear and incorrect license situation"

**Assessment:** **Partially correct.** Not all "slop," but the licensing situation IS unclear and does need fixing.

---

## Conclusion

**The Reddit feedback is approximately 85% valid and identifies real problems.**

The licensing issues were serious enough that you should address them before:
- Seeking commercial users
- Publishing to npm (if not already)
- Making major marketing claims
- Pursuing any paid features

The benchmarks and messaging issues are credibility problems that will undermine adoption of an otherwise useful tool.

**Update:** Licensing ambiguity resolved by MIT-only consolidation; remaining work is messaging clarity.

**Estimated time to fix:** 4-6 hours for all critical and high-priority items.
