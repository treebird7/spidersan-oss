
import { describe, it, expect } from 'vitest';
import { ASTParser } from '../src/lib/ast.js';
import fs from 'fs';

describe('ASTParser', () => {
    const parser = new ASTParser();
    const testFile = 'test-file.ts';
    const testContent = `
        function myFunction() {
            console.log("hello");
        }

        class MyClass {
            method() {
                return 1;
            }
        }
    `;

    it('should extract symbols correctly', () => {
        fs.writeFileSync(testFile, testContent);
        try {
            const symbols = parser.getSymbols(testFile);
            expect(symbols).toHaveLength(3); // myFunction, MyClass, method

            const func = symbols.find(s => s.name === 'myFunction');
            expect(func).toBeDefined();
            expect(func?.type).toBe('function');

            const cls = symbols.find(s => s.name === 'MyClass');
            expect(cls).toBeDefined();
            expect(cls?.type).toBe('class');

            const method = symbols.find(s => s.name === 'method');
            expect(method).toBeDefined();
            expect(method?.type).toBe('method');
        } finally {
            if (fs.existsSync(testFile)) {
                fs.unlinkSync(testFile);
            }
        }
    });

    it('should handle nested functions correctly', () => {
         const nestedContent = `
            function outer() {
                function inner() {}
            }
        `;
        fs.writeFileSync(testFile, nestedContent);
        try {
            const symbols = parser.getSymbols(testFile);
            expect(symbols).toHaveLength(2);
             expect(symbols.map(s => s.name)).toContain('outer');
             expect(symbols.map(s => s.name)).toContain('inner');
        } finally {
             if (fs.existsSync(testFile)) {
                fs.unlinkSync(testFile);
            }
        }
    });
});
