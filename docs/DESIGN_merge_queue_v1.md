# Spidersan Merge Queue — v1 Design

**Status:** proposed · **Author:** sherlocksan · **Date:** 2026-06-25
**Origin:** Envoak security-PR stack (#61–#69) was rebased + validated by hand;
this automates that. Mechanics borrowed from Mergify (researched 2026-06-24).

---

## 1. Problem

Spidersan today does **static** conflict detection + merge-ordering advice. It
tells you "merge A before B (they touch the same lines)" but it never **tests the
combined state before merging**. So it misses **semantic conflicts** — two PRs
that each pass CI alone but break `main` when combined.

This session was the live proof: landing Envoak #61–#69 meant manually rebasing
each PR onto the moving `main` and re-running build+test before merge, because two
PRs touched `vault.ts` in adjacent regions. That hand-work is exactly what a merge
queue automates.

Mergify's core mechanic: **test each PR against the state `main` *will* have at
merge time; merge only if green.** ([learn/merge-queue](https://mergify.com/learn/merge-queue))

## 2. Goals (v1)

- **Never merge a combination that breaks `main`** (build + test).
- **Serial and simple** — avoid the concurrency bugs Mergify needed TLA+ to find
  ([their writeup](https://mergify.com/blog/how-we-formally-verified-our-merge-queue-with-tla-plus/)).
- **Reuse the existing CI gate** (`ci.yml`: `npm ci && typecheck && build && test`)
  as the green/red oracle — no second definition of "passing".
- **Run on the m5 self-hosted runner** — free, no GitHub Actions minutes.
- **Order by spidersan's existing conflict analysis.**
- **Human-in-the-loop first** — advisory/propose mode by default; auto-merge gated
  by explicit config.

## 3. Non-goals (deferred)

- Parallel speculative "trains" (phase 3 — the TLA+-hard part).
- sangit ML scoring (phase 2).
- Batching + bisection (phase 2).
- Cross-repo queues (v1 is single-repo).

## 4. Architecture

```
ready PRs ──▶ spidersan order ──▶ speculative integrate+test ──▶ decide ──▶ merge / eject
 (label)      (conflict graph)     (temp branch on m5)          (green?)
```

| Component | Source | Role |
|-----------|--------|------|
| **Queue source** | PRs labeled `mq:ready` (or spidersan `ready` state) | what's eligible |
| **Orderer** | spidersan conflict graph (exists) | deterministic merge order |
| **Speculative merger** | NEW | temp branch = `main` + PRs merged in order |
| **Oracle** | existing `ci.yml` steps on m5 | green/red verdict on the *combined* state |
| **Decider** | NEW | all green → land in order; red → eject culprit, retry |
| **Runner** | m5 self-hosted GH Actions runner / local script | executes the oracle |

## 5. v1 loop (serial, naive culprit)

```
ready = spidersan.ready_prs()                 # PRs marked mq:ready
if not ready: exit
queue = spidersan.merge_order(ready)          # existing conflict-aware ordering

while queue:
    git checkout -B _mq main
    applied = []
    for pr in queue:
        if git merge --no-edit pr  -> conflict:
            eject(pr, "textual conflict vs queue"); queue.remove(pr); break
        applied.append(pr)
    else:                                       # no textual conflict in the whole set
        if run_ci_gate(_mq) == GREEN:
            for pr in applied: gh pr merge --squash pr   # land them
            return success
        ejected = applied[-1]                   # v1: blame the last-added (naive)
        eject(ejected, "combined CI red")
        queue.remove(ejected)
        # retry with the smaller set
cleanup: git branch -D _mq
```

Invariants:
- **One queue run at a time** (a lockfile / spidersan lock). No concurrency in v1.
- Temp branch `_mq` is always deleted (success or failure).
- An ejected PR gets a spidersan signal + a PR comment explaining *what it broke
  against* (the other PRs in the set), so the author has a reproducer.

## 6. The oracle

Literally the merged `ci.yml` steps, run on the integration branch:
```
npm ci && npm run typecheck && npm run build && npm test
```
On the **m5 self-hosted runner** so it costs no GitHub minutes and matches the
gate humans already see. Same definition of green everywhere.

## 7. Spidersan integration

Spidersan already owns: branch registry, conflict detection, merge ordering,
stale cleanup. New surface:
- `spidersan mq run` — execute the loop above.
- `spidersan mq status` — show queue + last run.
- Colony signals for outcomes: `"PR #X ejected — combined CI red against #Y,#Z"`,
  so the fleet sees queue state without polling GitHub.

## 8. Phase 2 — sangit (the ML differentiator)

Mergify is deterministic (fixed batch size + blind bisect). sangit, trained on
the gold pairs spidersan-gold already mines, adds **prediction**:

- **Risk-scored ordering** — predict P(semantic conflict | PR_a, PR_b) and order
  the queue to minimise *expected re-runs* (not just satisfy textual constraints).
- **Smart culprit** — on a red set, rank the likely-culprit instead of blaming the
  last-added → fewer retest rounds than naive ejection.
- **Batch composition** — group PRs predicted-independent into ONE CI run (Mergify
  batch), isolate predicted-risky ones. Cuts CI spend, which matters when the
  runner is your own m5.
- **Pre-flight "will this break main" score** — cheap triage: low-risk → optimistic
  batch, high-risk → full speculative run.

Net: Mergify minimises head-of-line *stalls*; sangit minimises *total CI spend*.

## 9. Phase 3 — parallel trains (only if throughput demands)

Speculative parallel cars (test PR_n against the predicted result of PRs ahead,
before they merge). This is where the concurrency bugs live — Mergify formally
verified it. **Do not build until serial throughput is proven insufficient.**

## 10. Security note (sherlock)

A **self-hosted runner executes PR code**. For a **private, single-owner repo
with only trusted internal contributors** (Envoak today) that's acceptable. It is
**NOT** safe for public repos or fork PRs without isolation (a malicious PR could
exfiltrate from m5 / the runner's token). Gate the runner to internal branches;
never auto-run fork PRs on m5. Revisit if Envoak goes public.

## 11. Open questions

1. "Ready" source — a `mq:ready` label, spidersan state, or both?
2. Default mode — auto-merge vs propose-and-confirm? (Start: propose-and-confirm.)
3. Squash vs merge-commit on land (repo uses squash today).
4. How long to hold a run (timeout) before declaring the oracle stuck?

## 12. Effort

- **v1: ~1 focused day.** The loop is a script (TS or bash) wrapping `git` + `gh` +
  the CI gate, plus a `spidersan mq` subcommand. The fiddly part is robust temp-
  branch handling + guaranteed cleanup, and clear eject reporting.
- **Phase 2:** depends on sangit inference being callable from spidersan; scope
  separately once v1 is proven.

---

### Appendix — Mergify mechanics referenced
- Speculative checks / draft combined PRs, eject-on-fail: [docs](https://docs.mergify.com/merge-queue/)
- Batches + bisection: [docs](https://docs.mergify.com/merge-queue/batches/)
- Train model + TLA+ verification: [blog](https://mergify.com/blog/how-we-formally-verified-our-merge-queue-with-tla-plus/)
