import { describe, it, expect } from 'vitest';
import { formatSalvageReport, type SalvageReport } from '../src/lib/salvage-analyzer.js';

function report(overrides: Partial<SalvageReport> = {}): SalvageReport {
    return {
        branch: 'feat/x',
        analysedFiles: 3,
        salvageable: [],
        alreadyInMain: 0,
        unparseableFiles: [],
        ...overrides,
    };
}

describe('formatSalvageReport — "safe to delete" gating', () => {
    it('says "fully superseded" ONLY when nothing salvageable AND nothing unparseable', () => {
        const out = formatSalvageReport(report({ salvageable: [], unparseableFiles: [] }));
        expect(out).toContain('fully superseded by main');
    });

    it('does NOT claim "fully superseded" when some files could not be parsed', () => {
        // The core regression: an unparseable file means symbols are UNKNOWN, so a
        // branch with 0 detected salvageable symbols must NOT be called safe to delete.
        const out = formatSalvageReport(report({
            salvageable: [],
            unparseableFiles: ['src/broken.ts'],
        }));
        expect(out).not.toContain('fully superseded');
        expect(out).toContain('could not be parsed');
        expect(out).toContain('Do NOT treat this branch as safe to delete');
        expect(out).toContain('src/broken.ts');
    });

    it('lists unparseable files alongside real salvageable findings', () => {
        const out = formatSalvageReport(report({
            salvageable: [{ name: 'foo', kind: 'function', line: 3, file: 'src/a.ts', branch: 'feat/x' }],
            unparseableFiles: ['src/broken.ts'],
        }));
        expect(out).toContain('Unparseable files (status UNKNOWN): 1');
        expect(out).toContain('foo');
    });
});
