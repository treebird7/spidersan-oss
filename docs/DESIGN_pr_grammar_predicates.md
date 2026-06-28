# PR Grammar Predicates — carries() + precondition()

> **Status:** APPROVED (birdsan, #257) — direction ratified, review fixes applied
> (carries() flag = ∩≠∅ not ⊃; own/inherited split; label vocab). Ready to build. **Bead:** tb-8hgg.
> **Origin:** Envoak git-grammar dogfood, 2026-06-28 (`CHAT_envoak_gitgrammar_2026-06-28`).
> Two predicates minted live against real PRs (#78/#80/#81); this specs them into
> `spidersan conflicts`.

## The discipline this encodes

The session proved three failure modes that file-overlap alone cannot catch:

1. **File-overlap ≠ conflict.** `conflict(#81,#80)` shared `identity.ts` yet `git
   merge-tree` merged CLEAN (disjoint hunks). File-overlap (`--vs-prs`) would have
   raised a false PAUSE. → **conflict is a merge-tree property, not a set-intersection.**
2. **The PR title hides the merge unit.** `#78` read as a "1-file bridge" but
   `carries()` = 4 commits / 14 files, 3 of them sherlock's SE-broker stack riding in
   from an open branch. → **merge unit = `carries(pr)`, not the diff summary.**
3. **Mergeable ≠ functional.** `#80` was MERGEABLE/CLEAN but carried an unmet runtime
   precondition (vault grant tb-4qrr). → **a green merge button can still ship a broken
   feature.**

Net rule for the tool: **default PR conflict checks to `--real` (merge-tree)**, and add
two predicates — `carries()` (provenance) and `precondition()` (activation gate) — that
file-overlap can never express.

## Predicate 1 — `carries(pr)`  (provenance)

```
carries(pr) = commits(pr.head) \ commits(main)        # git log main..<head>
FLAG when  carries(A) ∩ commits_of(another open branch/PR) ≠ ∅
```

> **Why intersection, not superset** (birdsan review, #257). An earlier draft wrote
> `carries(A) ⊃ commits_of(B)`. That under-fires on the exact case it exists for:
> `carries(#78) = {a285fa0, 629b5f8, cddfd0a, d5cad9f}`, but `commits_of(sherlock2)`
> *also* held §3/§5 commits #78 never inherited — so #78 is **not** a superset of
> sherlock2 and `⊃` is false, even though the two genuinely share `cddfd0a`. The signal
> is *any* shared commit (entanglement), so the condition is **∩ ≠ ∅**. (The per-commit
> `git branch -r --contains` implementation already computes this; only the formal
> notation was wrong.)

Pure git, no network beyond a fetch:

```sh
git log --oneline origin/main..<head>                 # the commits this PR lands
git branch -r --contains <sha>                         # which open branches own each
```

A commit appearing on `carries(A)` **and** on another open branch B means merging A
lands B's work as a side effect. That's not always wrong (landing it may shrink B's
trail — exactly the #78/sherlock2 case) but it must be **surfaced so it's intentional,
not accidental**. Squash-vs-merge matters here: squashing A erases those SHAs from main,
so B's later rebase re-encounters them. The tool should warn when a provenance-carrying
PR is about to be squashed.

**Output:** split `carries()` into **own** (the PR author's commits) vs **inherited**
(commits also reachable from another open branch) — so the merge unit reads at a glance.
For each inherited commit emit `🚩 provenance: <sha> also on <branch>`. (#78 → own:
`d5cad9f`; inherited: `a285fa0, 629b5f8, cddfd0a` from sherlock2.)

## Predicate 2 — `precondition(pr)`  (activation gate)

Not derivable from git — it's a declared assertion. **Encode as a LABEL, not prose:**

```
needs-<kind>:<resource>        e.g.  needs-grant:memoak/MEMOAK_SUPABASE_URL
```

```
precondition(pr) UNMET  ⟺  pr has a `needs-*:` label AND the named resource is unsatisfied
→ block merge; reason string = the label
clear the gate = remove the label   (what mycsan2 did when tb-4qrr landed)
```

Why label, not checklist line: the tool gates deterministically on
`gh pr view N --json labels` — structured + queryable. A checklist line is prose that
needs regex and silently drifts. The tool does **not** verify the resource itself (that's
domain-specific); it enforces that a declared gate blocks until a human/owner clears the
label. "Mergeable" then never auto-reads as "functional".

**Ratified label vocabulary** (birdsan review, #257) — extensible, not closed:

| Label | Gate |
|-------|------|
| `needs-grant:<svc/name>` | a vault secret must be stored + granted (e.g. tb-4qrr / #80) |
| `needs-deploy:<target>` | an edge fn / worker / service must be deployed first |
| `needs-migration:<id>` | a DB migration must be applied first |

The tool matches the `needs-<kind>:` prefix generically, so new kinds need no code change —
just agree on the kind and label the PR.

## CLI surface

```sh
spidersan conflicts --pr 81                 # default → --real merge-tree (not file-overlap)
spidersan conflicts --pr 81 --carries       # + provenance flags
spidersan conflicts --pr 81 --gate          # + precondition label check (block if UNMET)
spidersan conflicts --pr 81 --vs-prs        # legacy file-overlap (now explicitly opt-in, fast triage only)
```

Proposed: make `--real` the default for `--pr`, demote `--vs-prs` to opt-in fast triage
(it's cheap but lossy). `--carries` and `--gate` compose.

## Gold fixtures (mint from this session)

| PR | file-overlap says | `--real` says | carries() | precondition() |
|----|-------------------|---------------|-----------|----------------|
| #80 | conflict on identity.ts | **∅ CLEAN** (disjoint hunks) | clean (1 file) | was UNMET (tb-4qrr), cleared |
| #78 | 1-file bridge | CLEAN vs #80 | **⊃ sherlock2 §2 (cddfd0a)** | none |
| #81 | 3-file overlap vs #78 | **1 real conflict** (colony-client.ts) | clean | none |

Each row is a training pair: the file-overlap column is the *wrong* answer, the `--real` +
predicate columns are the *right* one.

## Implementation cost

- `carries()`: ~1 fn — `git log main..head` + `git branch -r --contains` per commit. Cheap.
- `precondition()`: ~1 fn — `gh pr view --json labels`, match `needs-*:`. Cheap.
- `--real` default: the engine already exists (`conflicts --real`, `git-merge-analyzer.ts`);
  this is a flag-default flip + doc, not new analysis.

ponytail: no new abstraction — two small git/gh wrappers + a default change. Build only
after birdsan ratifies the label vocabulary (`needs-grant:` / `needs-deploy:` / …).
