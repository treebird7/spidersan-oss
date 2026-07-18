# Fleet Git Map — PRD (draft)

**Status:** draft · **Author:** spidersan-i7 · **Date:** 2026-07-18
**Invoak task:** tb-19wp
**Origin:** discussed during the coord-claims session (PR #276) — asked "what
would be useful is a fleet wide git map that shows touched files that weren't
yet merged with current working branch/local main."

---

## 1. Problem

`spidersan conflicts` answers "does *this branch* conflict with *that
branch*." `cross-conflicts` extends the same question across machines via
the Supabase-synced registry. Neither answers the question a developer or
agent actually has day-to-day: **"what has the rest of the fleet touched
that isn't merged into main yet, and does it overlap with what I'm about to
touch?"** — a map, not a pairwise check.

## 2. Two distinct questions (do not conflate)

These need separate code paths — they are not the same feature wearing one
name:

- **On a feature branch:** the query set is `git diff --name-only
  <trunk>...HEAD` (files *you've* touched, unmerged). Map those against every
  other active branch the fleet has registered (via the existing
  `cross-conflicts` cross-machine pull).
- **On `main`/trunk directly:** there is no local diff to seed the query —
  `git diff <trunk>...HEAD` is empty by definition. The question becomes "what
  do *other* active fleet branches touch that isn't merged into main yet,"
  independent of any local diff. All-branches-vs-main, no local seed.

A PRD or implementation that treats these as one code path will produce a
map that's silently empty on trunk, which reads as "all clear" when it
actually means "wrong question was asked."

## 3. Goals

- Reuse `cross-conflicts`' existing cross-machine registry pull — no new
  sync mechanism.
- Reuse `conflicts`' real git-merge simulation (`analyzeRealConflicts`)
  where useful, rather than naive file-list overlap.
- One new render: `file → which fleet branch(es)/machine(s) touch it, still
  unmerged` — a table, not a pass/fail verdict.
- Read-only. No new registry writes, no new sync cadence.

## 4. Non-goals

- A new subsystem or new sync/push mechanism — ponytail take from the design
  discussion: this is a reframe of existing data, not new infrastructure.
- Cross-machine `claims` propagation (the in-file coordination-comment
  feature from PR #276 is local-machine-only today; making claims travel
  across machines is a separate, already-noted follow-up — it would need a
  new Supabase column + push/pull wiring, not covered here).
- Real-time push notification when the map changes — this is a
  query-on-demand command, not a daemon.

## 5. Open questions (pre-implementation)

- Command shape: new `spidersan fleet-map` command, or a flag on
  `cross-conflicts` (e.g. `--against-trunk`)? Leans toward a flag — avoids a
  near-duplicate command surface for what's mostly a different query against
  the same data.
- On trunk: is "all other active fleet branches vs main" scoped to the
  current repo only (matches `cross-conflicts`' existing per-repo scoping),
  or fleet-wide across all repos? Default to per-repo, matching existing
  behavior, unless a use case demands otherwise.
- Staleness: `cross-conflicts` already pulls live from Supabase per
  invocation — no caching concerns beyond what that command already has.

## 6. Rough shape (not a commitment — flesh out at implementation time)

```
spidersan fleet-map                # on a feature branch: my diff vs fleet
spidersan fleet-map --against-trunk # on main: all active fleet branches vs main
```

Output: a table of `file | branch | machine | agent | last touched`, sourced
from the same cross-machine registry pull `cross-conflicts` already does,
filtered to the appropriate query set per §2.
