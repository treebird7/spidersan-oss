/**
 * Merge queue v1 — pure orchestration core.
 *
 * Borrowed mechanic (Mergify): test the COMBINED state main will have at merge
 * time; merge only if green. See docs/DESIGN_merge_queue_v1.md.
 *
 * This module holds ONLY the loop logic and is effect-free — every side effect
 * (list PRs, order, speculative-merge, run CI, land PR, log) is injected via
 * `MergeQueueDeps`. That keeps the decision logic unit-testable with fakes; the
 * real git/gh adapters live in the CLI command and are thin.
 *
 * v1 is deliberately SERIAL and uses a NAIVE culprit (last-applied) on a red
 * gate — see the design doc for why parallel trains + sangit culprit-ranking are
 * deferred to phases 2/3.
 */

export interface QueuedPR {
  number: number;
  headRef: string;
  title: string;
}

/** Result of speculatively merging the queue onto base, in order. */
export interface SpeculativeMergeResult {
  /** PRs that merged cleanly onto the temp integration branch, in order. */
  applied: QueuedPR[];
  /** The first PR that hit a textual conflict (if any) — it stopped the merge. */
  ejected?: { pr: QueuedPR; reason: string };
}

export interface GateResult {
  green: boolean;
  detail?: string;
}

export interface EjectedPR {
  pr: QueuedPR;
  reason: string;
}

export interface MergeQueueResult {
  landed: QueuedPR[];
  ejected: EjectedPR[];
  /** True when the loop completed having landed a green set (possibly empty). */
  converged: boolean;
}

export interface MergeQueueDeps {
  /** PRs eligible for the queue (e.g. labelled mq:ready, open, not draft). */
  listReadyPRs(): Promise<QueuedPR[]>;
  /** Spidersan's conflict-aware ordering. */
  order(prs: QueuedPR[]): QueuedPR[];
  /** Temp-merge the given PRs onto `base` in order; leaves the integration
   *  branch checked out when fully applied so the gate can test it. */
  speculativeMerge(base: string, prs: QueuedPR[]): Promise<SpeculativeMergeResult>;
  /** Run the CI gate against the current (integrated) working tree. */
  runGate(): Promise<GateResult>;
  /** Land a single PR (real merge). Returns false on failure. */
  landPR(pr: QueuedPR): Promise<boolean>;
  log(message: string): void;
}

export interface MergeQueueOptions {
  base: string;
  /** Safety cap on retry rounds (each ejection is one round). */
  maxRounds?: number;
}

/**
 * Run the serial speculative merge queue.
 *
 * Loop: order the ready PRs → speculatively merge them onto `base` → if a PR
 * textually conflicts, eject it and retry the smaller set → once the whole set
 * merges cleanly, run the CI gate → green lands them all; red ejects the
 * last-applied PR (naive culprit) and retries.
 */
export async function runMergeQueue(
  deps: MergeQueueDeps,
  opts: MergeQueueOptions,
): Promise<MergeQueueResult> {
  const landed: QueuedPR[] = [];
  const ejected: EjectedPR[] = [];
  const maxRounds = opts.maxRounds ?? 50;

  let queue = deps.order(await deps.listReadyPRs());
  if (queue.length === 0) {
    deps.log('No ready PRs in the queue.');
    return { landed, ejected, converged: true };
  }
  deps.log(`Queue (${queue.length}): ${queue.map((p) => `#${p.number}`).join(' → ')}`);

  let rounds = 0;
  while (queue.length > 0) {
    if (++rounds > maxRounds) {
      deps.log(`Stopping: exceeded maxRounds (${maxRounds}).`);
      return { landed, ejected, converged: false };
    }

    const attempt = await deps.speculativeMerge(opts.base, queue);

    // A textual conflict stopped the merge — eject that PR, retry the rest.
    if (attempt.ejected) {
      const { pr, reason } = attempt.ejected;
      deps.log(`Eject #${pr.number}: ${reason}`);
      ejected.push(attempt.ejected);
      queue = queue.filter((p) => p.number !== pr.number);
      continue;
    }

    // Whole set merged cleanly — does the combined state pass CI?
    const gate = await deps.runGate();
    if (gate.green) {
      deps.log(`Gate green for ${attempt.applied.length} PR(s) — landing.`);
      for (const pr of attempt.applied) {
        const ok = await deps.landPR(pr);
        if (ok) {
          landed.push(pr);
          deps.log(`Landed #${pr.number}.`);
        } else {
          ejected.push({ pr, reason: 'merge command failed at land time' });
          deps.log(`Land FAILED for #${pr.number}.`);
        }
      }
      return { landed, ejected, converged: true };
    }

    // Red gate — naive culprit is the last-applied PR. Eject and retry smaller.
    const culprit = attempt.applied[attempt.applied.length - 1];
    const reason = `combined CI red against ${attempt.applied
      .filter((p) => p.number !== culprit.number)
      .map((p) => `#${p.number}`)
      .join(', ') || 'base'}${gate.detail ? ` — ${gate.detail}` : ''}`;
    deps.log(`Eject #${culprit.number}: ${reason}`);
    ejected.push({ pr: culprit, reason });
    queue = queue.filter((p) => p.number !== culprit.number);
  }

  // Queue drained without a green set to land.
  deps.log('Queue drained — nothing landed.');
  return { landed, ejected, converged: true };
}
