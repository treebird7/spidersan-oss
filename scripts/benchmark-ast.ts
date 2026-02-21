
import { ASTParser } from '../src/lib/ast.ts';
import TypeScript from 'tree-sitter-typescript';

console.log('TypeScript export keys:', Object.keys(TypeScript));
try {
    console.log('TypeScript.typescript keys:', Object.keys(TypeScript.typescript));
} catch (e) {
    console.log('TypeScript.typescript is undefined or not an object');
}

// Generate a large TS file content
function generateLargeContent(repeats) {
    let content = `
    import { something } from 'somewhere';

    export class TestClass {
        constructor() {
            console.log('init');
        }
    `;

    for (let i = 0; i < repeats; i++) {
        content += `
        method${i}() {
            const a = ${i};
            const b = ${i} + 1;
            return a + b;
        }

        function helper${i}() {
            return "helper ${i}";
        }
        `;
    }

    content += `
    }
    `;
    return content;
}

try {
    const parser = new ASTParser();
    const content = generateLargeContent(100);
    console.log(`Generated content size: ${(content.length / 1024).toFixed(2)} KB`);

    console.log('Parsing...');
    const start = performance.now();
    const tree = parser.parse(content);
    const parseTime = performance.now() - start;
    console.log(`Parse time: ${parseTime.toFixed(2)}ms`);

    console.log('Extracting symbols...');
    const extractStart = performance.now();
    const symbols = (parser as any).extractSymbols(tree);
    const extractTime = performance.now() - extractStart;

    console.log(`Extract time: ${extractTime.toFixed(2)}ms`);
    console.log(`Found ${symbols.length} symbols`);
} catch (e) {
    console.error(e);
}
