import { describe, it, expect, vi } from 'vitest';
import {
  runMergeQueue,
  type MergeQueueDeps,
  type QueuedPR,
  type SpeculativeMergeResult,
  type GateResult,
} from '../src/lib/merge-queue.js';

const pr = (number: number): QueuedPR => ({ number, headRef: `pr-${number}`, title: `PR ${number}` });

/** Build deps with sensible defaults; override per test. */
function makeDeps(over: Partial<MergeQueueDeps> = {}): MergeQueueDeps & { landed: number[]; logs: string[] } {
  const landed: number[] = [];
  const logs: string[] = [];
  const deps: MergeQueueDeps & { landed: number[]; logs: string[] } = {
    landed,
    logs,
    listReadyPRs: vi.fn(async () => [pr(1), pr(2), pr(3)]),
    order: (prs) => prs, // identity unless overridden
    speculativeMerge: vi.fn(
      async (_base, prs): Promise<SpeculativeMergeResult> => ({ applied: [...prs] }),
    ),
    runGate: vi.fn(async (): Promise<GateResult> => ({ green: true })),
    landPR: vi.fn(async (p) => {
      landed.push(p.number);
      return true;
    }),
    log: (m) => logs.push(m),
    ...over,
  };
  return deps;
}

describe('runMergeQueue', () => {
  it('empty queue → converged, nothing landed', async () => {
    const deps = makeDeps({ listReadyPRs: vi.fn(async () => []) });
    const res = await runMergeQueue(deps, { base: 'main' });
    expect(res.converged).toBe(true);
    expect(res.landed).toEqual([]);
    expect(deps.runGate).not.toHaveBeenCalled();
  });

  it('all green → lands every PR in order', async () => {
    const deps = makeDeps();
    const res = await runMergeQueue(deps, { base: 'main' });
    expect(res.landed.map((p) => p.number)).toEqual([1, 2, 3]);
    expect(res.ejected).toEqual([]);
    expect(deps.landed).toEqual([1, 2, 3]);
  });

  it('applies spidersan ordering before merging', async () => {
    const seen: number[][] = [];
    const deps = makeDeps({
      order: (prs) => [...prs].reverse(), // 3,2,1
      speculativeMerge: vi.fn(async (_b, prs) => {
        seen.push(prs.map((p) => p.number));
        return { applied: [...prs] };
      }),
    });
    const res = await runMergeQueue(deps, { base: 'main' });
    expect(seen[0]).toEqual([3, 2, 1]); // ordered set reached the merger
    expect(res.landed.map((p) => p.number)).toEqual([3, 2, 1]);
  });

  it('red gate → ejects last-applied (naive culprit), retries, lands the rest', async () => {
    // First pass applies [1,2,3] → red. Eject #3. Retry [1,2] → green.
    const gate = vi
      .fn<[], Promise<GateResult>>()
      .mockResolvedValueOnce({ green: false, detail: 'test failed' })
      .mockResolvedValueOnce({ green: true });
    const deps = makeDeps({ runGate: gate });
    const res = await runMergeQueue(deps, { base: 'main' });

    expect(res.landed.map((p) => p.number)).toEqual([1, 2]);
    expect(res.ejected.map((e) => e.pr.number)).toEqual([3]);
    expect(res.ejected[0].reason).toContain('combined CI red');
    expect(gate).toHaveBeenCalledTimes(2);
  });

  it('textual conflict → ejects the conflicting PR, retries without it', async () => {
    // #2 conflicts on the first pass; after removing it, [1,3] merge + green.
    const spec = vi
      .fn<[string, QueuedPR[]], Promise<SpeculativeMergeResult>>()
      .mockResolvedValueOnce({ applied: [pr(1)], ejected: { pr: pr(2), reason: 'textual conflict' } })
      .mockResolvedValueOnce({ applied: [pr(1), pr(3)] });
    const deps = makeDeps({ speculativeMerge: spec });
    const res = await runMergeQueue(deps, { base: 'main' });

    expect(res.landed.map((p) => p.number)).toEqual([1, 3]);
    expect(res.ejected.map((e) => e.pr.number)).toEqual([2]);
    expect(res.ejected[0].reason).toBe('textual conflict');
  });

  it('a failed land is recorded as ejected, not landed', async () => {
    const deps = makeDeps({
      listReadyPRs: vi.fn(async () => [pr(1), pr(2)]),
      landPR: vi.fn(async (p) => p.number !== 2), // #2 fails to merge
    });
    const res = await runMergeQueue(deps, { base: 'main' });
    expect(res.landed.map((p) => p.number)).toEqual([1]);
    expect(res.ejected.map((e) => e.pr.number)).toEqual([2]);
    expect(res.ejected[0].reason).toContain('merge command failed');
  });

  it('stops at maxRounds instead of looping forever', async () => {
    // Every round is red → every PR eventually ejected, but cap guards runaway.
    const deps = makeDeps({ runGate: vi.fn(async () => ({ green: false })) });
    const res = await runMergeQueue(deps, { base: 'main', maxRounds: 2 });
    expect(res.converged).toBe(false);
  });
});
