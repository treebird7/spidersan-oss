
import { describe, it, expect } from 'vitest';
import { ASTParser } from '../src/lib/ast.js';
import fs from 'fs';
import path from 'path';
import { tmpdir } from 'os';

describe('ASTParser', () => {
    const parser = new ASTParser();
    const tempDir = fs.mkdtempSync(path.join(tmpdir(), 'ast-test-'));

    const createTempFile = (content: string) => {
        const filePath = path.join(tempDir, `test-${Date.now()}.ts`);
        fs.writeFileSync(filePath, content);
        return filePath;
    };

    it('should extract class symbols', () => {
        const code = `
        class TestClass {
            method1() {}
        }
        `;
        const filePath = createTempFile(code);
        const symbols = parser.getSymbols(filePath);

        expect(symbols).toHaveLength(2);
        expect(symbols.find(s => s.name === 'TestClass')).toBeDefined();
        expect(symbols.find(s => s.name === 'method1')).toBeDefined();
    });

    it('should extract function symbols', () => {
        const code = `
        function testFunc() {
            return true;
        }
        `;
        const filePath = createTempFile(code);
        const symbols = parser.getSymbols(filePath);

        expect(symbols).toHaveLength(1);
        expect(symbols[0].name).toBe('testFunc');
        expect(symbols[0].type).toBe('function');
    });

    it('should extract nested symbols correctly', () => {
        const code = `
        class Outer {
            innerMethod() {
                function nestedFunc() {}
            }
        }
        `;
        const filePath = createTempFile(code);
        const symbols = parser.getSymbols(filePath);

        expect(symbols).toHaveLength(3);
        expect(symbols.map(s => s.name)).toContain('Outer');
        expect(symbols.map(s => s.name)).toContain('innerMethod');
        expect(symbols.map(s => s.name)).toContain('nestedFunc');
    });

    it('should handle deeper nesting without crash', () => {
        let code = 'class Deep { method() {';
        for (let i = 0; i < 100; i++) {
            code += ` function func${i}() { `;
        }
        for (let i = 0; i < 100; i++) {
            code += ` } `;
        }
        code += '} }';

        const filePath = createTempFile(code);
        const symbols = parser.getSymbols(filePath);

        expect(symbols.length).toBeGreaterThan(100);
        expect(symbols.find(s => s.name === 'Deep')).toBeDefined();
    });
});
