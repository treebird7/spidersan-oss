import { describe, it, expect } from 'vitest';
import { execFileSync } from 'child_process';
import { findOutlineConflicts, outlineSymbols } from '../src/lib/outline';

const hasAstGrep = (() => { try { execFileSync('ast-grep', ['--version'], { stdio: 'ignore' }); return true; } catch { return false; } })();

describe.skipIf(!hasAstGrep)('outline (python via ast-grep)', () => {
    const base = 'def login():\n    return 1\n\ndef helper():\n    return 1\n\nclass A:\n    def render(self):\n        return 1\n\nclass B:\n    def render(self):\n        return 1\n';
    it('extracts functions, classes and qualified methods', () => {
        const s = outlineSymbols(base, '.py')!;
        expect(s.map(x => `${x.parent ? x.parent + '.' : ''}${x.name}`)).toEqual(['login', 'helper', 'A', 'A.render', 'B', 'B.render']);
        expect(s[0].content).toBe('def login():\n    return 1');
    });
    it('three-way: flags only symbols changed on both sides, methods qualified', () => {
        const a = base.replace('login():\n    return 1', 'login():\n    return 2').replace('A:\n    def render(self):\n        return 1', 'A:\n    def render(self):\n        return 2');
        const b = base.replace('helper():\n    return 1', 'helper():\n    return 7').replace('A:\n    def render(self):\n        return 1', 'A:\n    def render(self):\n        return 3');
        expect(findOutlineConflicts('.py', a, 'A', b, 'B', base)!.map(c => c.symbolName)).toEqual(['A.render']);
    });
    it('returns null on unavailable input instead of a false "no conflicts"', () => {
        expect(outlineSymbols('x', '.nonexistent-ext')).toBeNull();
    });
});
