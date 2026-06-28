/**
 * carries(pr) — provenance predicate.
 *
 * carries(pr) = commits reachable from the PR head but not from the base, split into
 * the author's OWN commits vs commits also reachable from another OPEN branch
 * (INHERITED). Flag when the intersection with any other branch is non-empty.
 *
 * Why intersection, not superset (spidersan #257 / birdsan review): `carries(A) ⊃
 * commits_of(B)` under-fires — a PR can share commits with B while B holds further
 * commits the PR never inherited (the real #78/sherlock2 case). Any shared commit is
 * the entanglement signal, so the condition is `∩ ≠ ∅`, computed per-commit here.
 *
 * Pure-ish: only reads git, never mutates. Spec: docs/DESIGN_pr_grammar_predicates.md.
 */
import { execFileSync } from 'child_process';

export interface CarriedCommit {
    sha: string;
    subject: string;
}

export interface InheritedCommit extends CarriedCommit {
    /** Other open remote branches that also contain this commit (self/base excluded). */
    branches: string[];
}

export interface CarriesReport {
    own: CarriedCommit[];
    inherited: InheritedCommit[];
    /** carries ∩ another-open-branch ≠ ∅ */
    flagged: boolean;
}

/**
 * @param base         ref the PR merges into (e.g. `origin/main`).
 * @param prRef        the PR head ref (e.g. `refs/spidersan/pr-81`).
 * @param selfBranches remote refs that ARE this PR or the base — excluded from the
 *                     "other branch" set (e.g. [`origin/<headBranch>`, base]).
 */
export function analyzeCarries(base: string, prRef: string, selfBranches: string[] = []): CarriesReport {
    let log: string;
    try {
        log = execFileSync('git', ['log', '--format=%H%x09%s', `${base}..${prRef}`], { encoding: 'utf-8' });
    } catch {
        return { own: [], inherited: [], flagged: false };
    }

    const self = new Set(selfBranches);
    const own: CarriedCommit[] = [];
    const inherited: InheritedCommit[] = [];

    for (const line of log.split('\n').filter(Boolean)) {
        const tab = line.indexOf('\t');
        const sha = tab >= 0 ? line.slice(0, tab) : line;
        const subject = tab >= 0 ? line.slice(tab + 1) : '';

        let branches: string[] = [];
        try {
            branches = execFileSync('git', ['branch', '-r', '--contains', sha], { encoding: 'utf-8' })
                .split('\n')
                .map((b) => b.replace(/^[*+]?\s*/, '').trim())
                .filter(Boolean)
                .filter((b) => !b.includes(' -> ')) // drop symbolic refs (origin/HEAD -> origin/main)
                .filter((b) => !self.has(b));
        } catch {
            // detached / unknown ref → treat as own (no other branch claims it)
        }

        if (branches.length > 0) inherited.push({ sha, subject, branches });
        else own.push({ sha, subject });
    }

    return { own, inherited, flagged: inherited.length > 0 };
}
