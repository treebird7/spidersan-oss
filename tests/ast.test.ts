import { expect, test, describe } from 'vitest';
import { ASTParser } from '../src/lib/ast.js';

describe('ASTParser', () => {
    test('extracts symbols correctly', () => {
        const parser = new ASTParser();
        const code = `
            function myFunction() {
                return 1;
            }

            class MyClass {
                myMethod() {
                    return 2;
                }
            }
        `;

        const tree = parser.parse(code);
        // Accessing private method for testing purposes
        const symbols = (parser as any).extractSymbols(tree);

        expect(symbols).toHaveLength(3);

        const func = symbols.find((s: any) => s.name === 'myFunction');
        expect(func).toBeDefined();
        expect(func?.type).toBe('function');

        const cls = symbols.find((s: any) => s.name === 'MyClass');
        expect(cls).toBeDefined();
        expect(cls?.type).toBe('class');

        const method = symbols.find((s: any) => s.name === 'myMethod');
        expect(method).toBeDefined();
        expect(method?.type).toBe('method');
    });

    test('handles nested functions correctly', () => {
        const parser = new ASTParser();
        const code = `
            function outer() {
                function inner() {
                    return 'inner';
                }
            }
        `;

        const tree = parser.parse(code);
        const symbols = (parser as any).extractSymbols(tree);

        expect(symbols).toHaveLength(2);
        expect(symbols.map((s: any) => s.name)).toContain('outer');
        expect(symbols.map((s: any) => s.name)).toContain('inner');
    });
});
