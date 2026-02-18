import { describe, it, expect } from 'vitest';
import { ASTParser } from '../src/lib/ast.js';

describe('ASTParser', () => {
    it('should detect function changes', () => {
        const parser = new ASTParser();
        const code1 = `
            function hello() {
                console.log('world');
            }
        `;
        const code2 = `
            function hello() {
                console.log('modified');
            }
        `;

        const conflicts = parser.findSymbolConflicts(code1, 'a.ts', code2, 'b.ts');
        expect(conflicts).toHaveLength(1);
        expect(conflicts[0].symbolName).toBe('hello');
        expect(conflicts[0].symbolType).toBe('function');
    });

    it('should detect class and method changes', () => {
        const parser = new ASTParser();
        const code1 = `
            class MyClass {
                method1() { return 1; }
            }
        `;
        const code2 = `
            class MyClass {
                method1() { return 2; }
            }
        `;

        const conflicts = parser.findSymbolConflicts(code1, 'a.ts', code2, 'b.ts');

        // Should detect both the class changing (because its body changed) and the method changing
        expect(conflicts.some(c => c.symbolName === 'MyClass' && c.symbolType === 'class')).toBe(true);
        expect(conflicts.some(c => c.symbolName === 'method1' && c.symbolType === 'method')).toBe(true);
    });

    it('should handle nested structures correctly', () => {
        const parser = new ASTParser();
        const code1 = `
            function outer() {
                function inner() {
                    return 'a';
                }
            }
        `;
        const code2 = `
            function outer() {
                function inner() {
                    return 'b';
                }
            }
        `;

        const conflicts = parser.findSymbolConflicts(code1, 'a.ts', code2, 'b.ts');

        // outer changes because inner changed
        expect(conflicts.some(c => c.symbolName === 'outer')).toBe(true);
        expect(conflicts.some(c => c.symbolName === 'inner')).toBe(true);
    });
});
