import { ASTParser } from '../src/lib/ast.js';
import { performance } from 'perf_hooks';

// Helper to access private method for benchmarking
// Note: We access the private method to specifically target the traversal logic.
const extractSymbols = (parser: ASTParser, code: string): any[] => {
    return (parser as any).extractSymbols(parser.parse(code));
};

function generateLargeCode(): string {
    let code = '';
    // Generate ~24KB of code to stay within tree-sitter environment limits
    for (let i = 0; i < 100; i++) {
        code += `
            class Class${i} {
                method${i}() {
                    function nested${i}() {
                        console.log("nested");
                    }
                    return "value";
                }
            }
        `;
    }
    return code;
}

const parser = new ASTParser();
const code = generateLargeCode();
console.log(`Generated code size: ${(code.length / 1024).toFixed(2)} KB`);

// Parse once to isolate AST traversal performance
const tree = parser.parse(code);

// Warm up JIT
(parser as any).extractSymbols(tree);

console.log('Starting benchmark...');
const start = performance.now();
const iterations = 1000;

for (let i = 0; i < iterations; i++) {
    (parser as any).extractSymbols(tree);
}

const end = performance.now();

console.log(`Total time: ${(end - start).toFixed(2)} ms`);
console.log(`Average execution time per call: ${((end - start) / iterations).toFixed(4)} ms`);
