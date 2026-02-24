import { describe, it, expect } from 'vitest';
import { ASTParser, SymbolInfo } from '../src/lib/ast';

describe('ASTParser', () => {
    const parser = new ASTParser();

    it('should extract top-level functions', () => {
        const code = `
            export function foo() {
                return 'bar';
            }
        `;
        const tree = parser.parse(code);
        const symbols = parser['extractSymbols'](tree);

        expect(symbols).toHaveLength(1);
        expect(symbols[0].name).toBe('foo');
        expect(symbols[0].type).toBe('function');
        expect(symbols[0].content).toContain('function foo()');
    });

    it('should extract classes and methods', () => {
        const code = `
            export class MyClass {
                constructor() {}

                myMethod() {
                    console.log('hello');
                }
            }
        `;
        const tree = parser.parse(code);
        const symbols = parser['extractSymbols'](tree);

        // MyClass, constructor, myMethod
        expect(symbols).toHaveLength(3);

        const cls = symbols.find(s => s.type === 'class');
        expect(cls).toBeDefined();
        expect(cls!.name).toBe('MyClass');

        const method = symbols.find(s => s.type === 'method' && s.name === 'myMethod');
        expect(method).toBeDefined();

        const ctor = symbols.find(s => s.type === 'method' && s.name === 'constructor');
        expect(ctor).toBeDefined();
    });

    it('should extract nested functions', () => {
        const code = `
            function outer() {
                function inner() {
                    return 'inner';
                }
            }
        `;
        const tree = parser.parse(code);
        const symbols = parser['extractSymbols'](tree);

        expect(symbols).toHaveLength(2);
        expect(symbols.map(s => s.name)).toContain('outer');
        expect(symbols.map(s => s.name)).toContain('inner');
    });

    it('should handle symbols without names gracefully (if any)', () => {
        const code = `
            export default function() {}
        `;
        // Default export function often has no name node if not specified
        const tree = parser.parse(code);
        const symbols = parser['extractSymbols'](tree);

        // Current implementation checks for name node. If missing, it skips.
        expect(symbols).toHaveLength(0);
    });

    it('should compute consistent hashes', () => {
        const code = `function test() {}`;
        const tree1 = parser.parse(code);
        const symbols1 = parser['extractSymbols'](tree1);

        const tree2 = parser.parse(code);
        const symbols2 = parser['extractSymbols'](tree2);

        expect(symbols1[0].hash).toBe(symbols2[0].hash);
    });
});
