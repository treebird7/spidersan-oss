import { describe, it, expect } from 'vitest';
import { conflictOrder } from '../src/commands/mq.js';
import type { QueuedPR } from '../src/lib/merge-queue.js';

const pr = (number: number): QueuedPR => ({ number, headRef: `pr-${number}`, title: `PR ${number}` });

describe('conflictOrder (tb-y121)', () => {
  it('returns input unchanged for <2 PRs', () => {
    expect(conflictOrder([], new Map())).toEqual([]);
    expect(conflictOrder([pr(5)], new Map())).toEqual([pr(5)]);
  });

  it('non-conflicting PRs keep oldest-first order (numeric, not lexicographic)', () => {
    const prs = [pr(2), pr(10), pr(1)];
    const files = new Map([
      [1, ['a.ts']],
      [2, ['b.ts']],
      [10, ['c.ts']],
    ]);
    expect(conflictOrder(prs, files).map((p) => p.number)).toEqual([1, 2, 10]);
  });

  it('sorts a zero-conflict PR ahead of a conflict cluster (≠ pure oldest-first)', () => {
    // #1 and #2 overlap (a conflict cluster); #3 is isolated. Topological sort
    // surfaces the in-degree-0 (non-conflicting) PR first, so #3 leads even
    // though it's the newest — proving the order is graph-driven, not numeric.
    const prs = [pr(1), pr(2), pr(3)];
    const files = new Map([
      [1, ['shared.ts']],
      [2, ['shared.ts']],
      [3, ['solo.ts']],
    ]);
    expect(conflictOrder(prs, files).map((p) => p.number)).toEqual([3, 1, 2]);
  });

  it('drops PRs with no files entry into the non-conflicting group safely', () => {
    const prs = [pr(1), pr(2)];
    const order = conflictOrder(prs, new Map()).map((p) => p.number);
    expect(order).toEqual([1, 2]);
  });
});
