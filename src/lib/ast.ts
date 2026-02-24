import Parser from 'tree-sitter';
import TypeScript from 'tree-sitter-typescript';
import fs from 'fs';
import { createHash } from 'crypto';

export interface SymbolInfo {
    name: string;
    type: 'function' | 'class' | 'method';
    startLine: number;
    endLine: number;
    content?: string;
    hash?: string;
}

export class ASTParser {
    private parser: Parser;

    constructor() {
        this.parser = new Parser();
        // TypeScript binding quirk
        this.parser.setLanguage(TypeScript.typescript);
    }

    parse(code: string): Parser.Tree {
        return this.parser.parse(code);
    }

    /**
     * Parse a file and return all defined symbols (functions, classes, methods)
     */
    getSymbols(filePath: string): SymbolInfo[] {
        if (!fs.existsSync(filePath)) {
            return [];
        }
        const code = fs.readFileSync(filePath, 'utf-8');
        const tree = this.parse(code);
        return this.extractSymbols(tree);
    }

    /**
     * Compute SHA-256 hash of code content
     */
    computeHash(content: string): string {
        return createHash('sha256').update(content).digest('hex');
    }

    private extractSymbols(tree: Parser.Tree): SymbolInfo[] {
        const symbols: SymbolInfo[] = [];
        const cursor = tree.walk();
        // Stack of symbols we are currently inside
        const stack: Array<{
            type: SymbolInfo['type'];
            startLine: number;
            endLine: number;
            name: string | null;
            depth: number;
        }> = [];

        let visitedChildren = false;
        let depth = 0;

        // eslint-disable-next-line no-constant-condition
        while (true) {
            if (visitedChildren) {
                // Post-visit: Check if we are leaving a symbol node
                if (stack.length > 0) {
                    const top = stack[stack.length - 1];
                    // Check if the current node (which we are done with) matches the stack top
                    if (top.depth === depth &&
                        top.startLine === cursor.startPosition.row + 1 &&
                        top.endLine === cursor.endPosition.row + 1) {

                        stack.pop();
                        if (top.name) {
                            const content = cursor.nodeText;
                            symbols.push({
                                name: top.name,
                                type: top.type,
                                startLine: top.startLine,
                                endLine: top.endLine,
                                content: content,
                                hash: this.computeHash(content)
                            });
                        }
                    }
                }

                if (cursor.gotoNextSibling()) {
                    visitedChildren = false;
                } else {
                    if (!cursor.gotoParent()) break;
                    depth--;
                    // After returning to parent, we are done with its children
                    visitedChildren = true;
                }
            } else {
                // Pre-visit
                const type = cursor.nodeType;

                // 1. Check if it is a symbol definition
                if (type === 'function_declaration' || type === 'class_declaration' || type === 'method_definition') {
                    stack.push({
                        type: type.replace('_declaration', '').replace('_definition', '') as SymbolInfo['type'],
                        startLine: cursor.startPosition.row + 1,
                        endLine: cursor.endPosition.row + 1,
                        name: null,
                        depth: depth
                    });
                }
                // 2. Check if it is the 'name' field of the parent symbol
                else if (stack.length > 0 && cursor.currentFieldName === 'name') {
                    const top = stack[stack.length - 1];
                    // Name must be a direct child of the symbol
                    if (top.depth === depth - 1) {
                        top.name = cursor.nodeText;
                    }
                }

                if (cursor.gotoFirstChild()) {
                    visitedChildren = false;
                    depth++;
                } else {
                    visitedChildren = true;
                }
            }
        }
        return symbols;
    }

    /**
     * Compare two versions of code and find symbols that differ in content
     */
    findSymbolConflicts(
        contentA: string, labelA: string,
        contentB: string, labelB: string
    ): SymbolConflict[] {
        const treeA = this.parse(contentA);
        const treeB = this.parse(contentB);

        const symbolsA = this.extractSymbols(treeA);
        const symbolsB = this.extractSymbols(treeB);

        const conflicts: SymbolConflict[] = [];

        // Map for fast lookup
        const mapB = new Map<string, SymbolInfo>();
        symbolsB.forEach(s => mapB.set(s.name, s));

        for (const symA of symbolsA) {
            const symB = mapB.get(symA.name);
            // If symbol exists in both and content differs
            if (symB && symA.content !== symB.content) {
                conflicts.push({
                    symbolName: symA.name,
                    symbolType: symA.type,
                    locations: [
                        { file: labelA, range: [symA.startLine, symA.endLine] },
                        { file: labelB, range: [symB.startLine, symB.endLine] }
                    ]
                });
            }
        }

        return conflicts;
    }
}

export interface SymbolConflict {
    symbolName: string;
    symbolType: string;
    locations: { file: string; range: [number, number] }[];
}
