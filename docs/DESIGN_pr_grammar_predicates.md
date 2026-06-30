# PR Grammar Predicates — carries() + precondition()

> **Status:** APPROVED — direction ratified, review fixes applied
> (carries() flag = ∩≠∅ not ⊃; own/inherited split; label vocab). Ready to build.
> **Origin:** a live multi-PR coordination session that minted both predicates
> against three real PRs (referred to below as **A**, **B**, **C**). This specs them
> into `spidersan conflicts`.

## The discipline this encodes

The session proved three failure modes that file-overlap alone cannot catch:

1. **File-overlap ≠ conflict.** PRs **B** and **C** both edited the same file, yet
   `git merge-tree` merged CLEAN (disjoint hunks). File-overlap (`--vs-prs`) would have
   raised a false PAUSE. → **conflict is a merge-tree property, not a set-intersection.**
2. **The PR title hides the merge unit.** **A** read as a "1-file bridge" but
   `carries()` = 4 commits / 14 files — 3 of them another author's stack riding in from
   an open branch. → **merge unit = `carries(pr)`, not the diff summary.**
3. **Mergeable ≠ functional.** **B** was MERGEABLE/CLEAN but carried an unmet runtime
   precondition (a vault grant that had not landed). → **a green merge button can still
   ship a broken feature.**

Net rule for the tool: **default PR conflict checks to `--real` (merge-tree)**, and add
two predicates — `carries()` (provenance) and `precondition()` (activation gate) — that
file-overlap can never express.

## Predicate 1 — `carries(pr)`  (provenance)

```
carries(pr) = commits(pr.head) \ commits(main)        # git log main..<head>
FLAG when  carries(A) ∩ commits_of(another open branch/PR) ≠ ∅
```

> **Why intersection, not superset.** An earlier draft wrote
> `carries(A) ⊃ commits_of(B)`. That under-fires on the exact case it exists for:
> `carries(A)` held four commits, but the other open branch *also* held commits that A
> never inherited — so A is **not** a superset of that branch, and `⊃` is false, even
> though the two genuinely share one commit. The signal is *any* shared commit
> (entanglement), so the condition is **∩ ≠ ∅**. (The per-commit
> `git branch -r --contains` implementation already computes this; only the formal
> notation was wrong.)

Pure git, no network beyond a fetch:

```sh
git log --oneline origin/main..<head>                 # the commits this PR lands
git branch -r --contains <sha>                         # which open branches own each
```

A commit appearing on `carries(A)` **and** on another open branch B means merging A
lands B's work as a side effect. That's not always wrong (landing it may shrink B's
trail) but it must be **surfaced so it's intentional, not accidental**. Squash-vs-merge
matters here: squashing A erases those SHAs from main, so B's later rebase re-encounters
them. The tool should warn when a provenance-carrying PR is about to be squashed.

**Output:** split `carries()` into **own** (the PR author's commits) vs **inherited**
(commits also reachable from another open branch) — so the merge unit reads at a glance.
For each inherited commit emit `🚩 provenance: <sha> also on <branch>`.

## Predicate 2 — `precondition(pr)`  (activation gate)

Not derivable from git — it's a declared assertion. **Encode as a LABEL, not prose:**

```
needs-<kind>:<resource>        e.g.  needs-grant:<service>/<SECRET_NAME>
```

```
precondition(pr) UNMET  ⟺  pr has a `needs-*:` label AND the named resource is unsatisfied
→ block merge; reason string = the label
clear the gate = remove the label   (the owner removes it once the resource lands)
```

Why label, not checklist line: the tool gates deterministically on
`gh pr view N --json labels` — structured + queryable. A checklist line is prose that
needs regex and silently drifts. The tool does **not** verify the resource itself (that's
domain-specific); it enforces that a declared gate blocks until a human/owner clears the
label. "Mergeable" then never auto-reads as "functional".

**Ratified label vocabulary** — extensible, not closed:

| Label | Gate |
|-------|------|
| `needs-grant:<svc/name>` | a secret/credential must be stored + granted |
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

## Worked example (anonymized) — three PRs, the verdicts

| PR | file-overlap says | `--real` says | carries() | precondition() |
|----|-------------------|---------------|-----------|----------------|
| A | 1-file bridge | CLEAN vs B | **∩ another open branch** (inherited stack) | none |
| B | conflict on shared file | **∅ CLEAN** (disjoint hunks) | clean (1 file) | was UNMET (grant), cleared |
| C | 3-file overlap vs A | **1 real conflict** (one file) | clean | none |

Each row is a training pair: the file-overlap column is the *wrong* answer, the `--real` +
predicate columns are the *right* one.

## Implementation cost

- `carries()`: ~1 fn — `git log main..head` + `git branch -r --contains` per commit. Cheap.
- `precondition()`: ~1 fn — `gh pr view --json labels`, match `needs-*:`. Cheap.
- `--real` default: the engine already exists (`conflicts --real`, `git-merge-analyzer.ts`);
  this is a flag-default flip + doc, not new analysis.

ponytail: no new abstraction — two small git/gh wrappers + a default change.
