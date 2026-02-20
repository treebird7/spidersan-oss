
import { ASTParser } from '../dist/lib/ast.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const parser = new ASTParser();

// Generate a large TS file
const generateLargeFile = (filePath, iterations) => {
    let content = '';
    for (let i = 0; i < iterations; i++) {
        content += `
        class Class${i} {
            method${i}() {
                function innerFunc${i}() {
                    console.log("Hello ${i}");
                }
                innerFunc${i}();
            }
        }
        `;
    }
    fs.writeFileSync(filePath, content);
};

const runBenchmark = () => {
    const tempFile = path.resolve(__dirname, 'temp_benchmark.ts');

    // Warmup
    generateLargeFile(tempFile, 100);
    parser.getSymbols(tempFile);

    // Benchmark
    const iterations = 150;
    generateLargeFile(tempFile, iterations);

    const stats = fs.statSync(tempFile);
    console.log(`File size: ${stats.size} bytes`);
    console.log(`Benchmarking with ${iterations} classes...`);

    const start = process.hrtime();
    const symbols = parser.getSymbols(tempFile);
    const end = process.hrtime(start);

    const timeInMs = (end[0] * 1000 + end[1] / 1e6).toFixed(2);

    console.log(`Extracted ${symbols.length} symbols in ${timeInMs}ms`);

    fs.unlinkSync(tempFile);
};

runBenchmark();
