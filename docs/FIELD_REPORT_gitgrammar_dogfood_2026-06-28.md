# Field Report — the git-grammar dogfood (2026-06-28)

> Companion to [`DESIGN_pr_grammar_predicates.md`](./DESIGN_pr_grammar_predicates.md).
> The DESIGN doc says *what the predicates are*; the gold pairs *train the model*;
> this report is the **story** — what the grammar caught live, in what order, and
> what humans/agents learned. Source transcript: `CHAT_envoak_gitgrammar_2026-06-28`.

## What it was

A live, six-agent coordination session run as a deliberate **dogfood**: instead of
hand-coordinating the merge of three open Envoak PRs, we coordinated them *through*
the git grammar and watched whether the grammar earned its keep on real, messy,
multi-author branches. Participants: **treebird** (PI), **birdsan** (facilitator +
executor), **mycsan/mycsan2** (PR #80), **sherlock** (PR #78 provenance), **spidersan**
(the conflict tool). The room ran on `treebird-chat` corrwait loops; merges executed
via `gh`.

The three fixtures:

| PR | framed as | author |
|----|-----------|--------|
| #80 | identity memoak-URL fix (1 file) | mycsan2 |
| #78 | hive-close-session bridge (1 file) | birdsan |
| #81 | hive-handoff-fixes | sherlock (relayed from m2) |

## What file-overlap would have said vs what the grammar found

This is the whole payoff. File-overlap (`--vs-prs`) reasons by *which files two PRs
touch*; the grammar reasons by `git merge-tree --write-tree` (the `--real` check) plus
two new predicates. Side by side on the live fixtures:

| Edge | file-overlap verdict | grammar verdict (`--real`) | who was right |
|------|----------------------|----------------------------|---------------|
| #80 ↔ #81 (both touch `identity.ts`) | ⚠️ PAUSE — shared file | **∅ CLEAN** — disjoint hunks | grammar (file-overlap = false positive) |
| #78 ↔ #81 ("3-file overlap") | ⚠️ 3-file conflict | **1 real conflict** — `colony-client.ts` only | grammar (over-stated 3→1) |
| #78 alone ("1-file bridge") | 1 file | **`carries()` = 4 commits / 14 files** incl sherlock's §2 keystone | grammar (title hid the merge unit) |
| #80 alone (green + MERGEABLE) | mergeable ✓ | **`precondition()` UNMET** — needed an ungranted vault secret | grammar (mergeable ≠ functional) |

Net: real-mode **killed one false-positive**, **shrank one overstated conflict
(3→1)**, **surfaced one hidden provenance flag**, and **caught one dormant-broken
activation gate** — four calls file-overlap would have gotten wrong, three of them in
the unsafe direction (two false alarms that erode trust, one missed real risk).

## The two predicates, born live

Both were minted *during* the session against real PRs, then spec'd into
[`DESIGN_pr_grammar_predicates.md`](./DESIGN_pr_grammar_predicates.md):

- **`carries(pr) = commits(pr.head) \ commits(main)`** — the real merge unit is the
  commit-set diff from main, *not* the PR title or diff-summary. #78 read as a
  "1-file bridge" but had been branched off sherlock's **unmerged** branch, so merging
  it would land sherlock's SE-broker §2 keystone (`cddfd0a`) on main as a side effect.
  Not wrong — but it must be *intentional*, not discovered post-merge. We landed #78
  with a **merge-commit** (not squash) so the carried SHA survives once on main and
  sherlock's branch fast-forwards cleanly.

- **`precondition(pr)` / activation gate** — `conflict=∅ ∧ MERGEABLE` proves
  *merge-safety*, never *activation-safety*. #80 was green and clean but read a vault
  secret that wasn't stored/granted yet; merging it would have shipped a dormant-broken
  feature. The fix is to declare the precondition as a **queryable label**
  (`needs-grant:<svc/name>`), not prose — so the gate is deterministic and removable.

A third discipline got hardened rather than invented: **conflict is a `merge-tree`
property, not a set-intersection.** Make `--real` the default; demote `--vs-prs` to
opt-in fast triage.

## The human lesson: verbal GO ≠ executed merge

The sharpest catch wasn't about git at all. The PI posted "HOLD LIFTED ✅ GO: execute
merge(80)→merge(78)" — and the facilitator **missed the notification** and kept
reporting "holding for lift" while both PRs sat OPEN. The desync lasted ~4 minutes
until *a third agent* (spidersan) cross-checked chat-state against PR-state and caught
it: *"treebird ALREADY lifted at 13:33 … the button never fired."*

The lesson: **an authority's GO is authorization, not the act. The merge is the commit,
not the ack.** An executor must close the loop on the *action* — report the landed SHA
(`gh pr view --json state,mergedAt`) — and a watcher should flag *GO-given-but-PR-still-
OPEN*. Reconcile against durable state, never the notification stream. (Encoded in
`treebird/coord-tree/patterns/single-writer-executor.md`.)

## Byproducts

- `vault keys grants <service/name>` reverse-lookup + `--ids-only` — shipped mid-session
  (sherlock) to confirm a 50-key grant mirror without raw SQL.
- A self-review catch: during ratification the facilitator asserted "different region →
  clean" on #80/#81 by eyeballing — the grammar's own `--real` discipline corrected it.
  The tool caught its own reviewer.
- A spec correctness fix: the first draft wrote the `carries()` flag as `⊃` (superset);
  review flagged it should be `∩ ≠ ∅` (intersection) — superset under-fires on exactly
  the #78/sherlock2 case (sherlock2 carried §3/§5 commits beyond what #78 inherited).
  Fixed before merge.

## What landed

- **Envoak #80** → `d002e98` (squash), **#78** → `1d7ccc6` (merge-commit, §2 preserved).
- **#81** → single-file `colony-client.ts` rebase + re-ratify, left to its owner.
- Spec: **#257** (this folder). Gold pairs: `spidersan-ai/pairs/flock_session_20260628_*`
  (conflict / merge_order ×2). Patterns: `treebird/coord-tree` + `treebird/ci-tree`.

## The takeaway

A merge button being green answers exactly one of three questions — *merge-safety*. It
says nothing about *provenance* (whose commits am I really landing?) or
*activation-safety* (does the feature work once landed?). File-overlap can't even answer
the first reliably. The grammar separates the three axes and makes each explicit and
checkable — and the dogfood proved it on branches gnarly enough (cross-author, stacked
on unmerged work, gated on out-of-band vault state) that hand-coordination got two of
them wrong in real time.
