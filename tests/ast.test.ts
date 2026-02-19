import { describe, it, expect } from 'vitest';
import { ASTParser, SymbolInfo } from '../src/lib/ast.js';

describe('ASTParser', () => {
    const parser = new ASTParser();

    // Helper to access private method
    const extractSymbols = (code: string): SymbolInfo[] => {
        const tree = parser.parse(code);
        return (parser as any).extractSymbols(tree);
    };

    it('should extract function symbols', () => {
        const code = `
            function hello() {
                console.log("world");
            }
        `;
        const symbols = extractSymbols(code);
        expect(symbols).toHaveLength(1);
        expect(symbols[0].name).toBe('hello');
        expect(symbols[0].type).toBe('function');
    });

    it('should extract class symbols', () => {
        const code = `
            class MyClass {
            }
        `;
        const symbols = extractSymbols(code);
        expect(symbols).toHaveLength(1);
        expect(symbols[0].name).toBe('MyClass');
        expect(symbols[0].type).toBe('class');
    });

    it('should extract method symbols', () => {
        const code = `
            class MyClass {
                myMethod() {
                    return true;
                }
            }
        `;
        const symbols = extractSymbols(code);
        // It extracts the class AND the method.
        expect(symbols).toHaveLength(2);

        const classSym = symbols.find(s => s.type === 'class');
        const methodSym = symbols.find(s => s.type === 'method');

        expect(classSym).toBeDefined();
        expect(classSym?.name).toBe('MyClass');

        expect(methodSym).toBeDefined();
        expect(methodSym?.name).toBe('myMethod');
    });

    it('should handle nested functions', () => {
        const code = `
            function outer() {
                function inner() {
                    return 1;
                }
            }
        `;
        const symbols = extractSymbols(code);
        expect(symbols).toHaveLength(2);
        expect(symbols.map(s => s.name)).toContain('outer');
        expect(symbols.map(s => s.name)).toContain('inner');
    });

    it('should extract correct lines', () => {
        const code = `
function test() {
    return true;
}
`;
        const symbols = extractSymbols(code);
        expect(symbols[0].name).toBe('test');
        expect(symbols[0].startLine).toBe(2);
        expect(symbols[0].endLine).toBe(4);
    });

    it('should calculate hash correctly', () => {
        const code = `function test() {}`;
        const symbols = extractSymbols(code);
        expect(symbols[0].hash).toBeDefined();
        // Hash should be consistent
        const symbols2 = extractSymbols(code);
        expect(symbols[0].hash).toBe(symbols2[0].hash);
    });
});
