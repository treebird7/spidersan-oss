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

        let recurse = true;

        // eslint-disable-next-line no-constant-condition
        while (true) {
            if (recurse) {
                const type = cursor.nodeType;
                if (type === 'function_declaration' || type === 'class_declaration' || type === 'method_definition') {
                    const node = cursor.currentNode;
                    const nameNode = node.childForFieldName('name');
                    if (nameNode) {
                        const content = node.text;
                        symbols.push({
                            name: nameNode.text,
                            type: type.replace('_declaration', '').replace('_definition', '') as SymbolInfo['type'],
                            startLine: node.startPosition.row + 1, // 1-indexed for humans
                            endLine: node.endPosition.row + 1,
                            content: content,
                            hash: this.computeHash(content)
                        });
                    }
                }
            }

            if (recurse && cursor.gotoFirstChild()) {
                recurse = true;
            } else {
                if (cursor.gotoNextSibling()) {
                    recurse = true;
                } else {
                    let climbed = false;
                    while (cursor.gotoParent()) {
                        if (cursor.gotoNextSibling()) {
                            recurse = true;
                            climbed = true;
                            break;
                        }
                    }
                    if (!climbed) return symbols;
                }
            }
        }
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
