/**
 * Spidersan AST Parser
 * 
 * Semantic conflict detection using Tree-sitter.
 * Detects function/class/method-level changes instead of just file-level.
 * 
 * @module ast
 */

import Parser from 'tree-sitter';
import TypeScript from 'tree-sitter-typescript';
import { createHash } from 'crypto';

export interface CodeSymbol {
    name: string;
    type: 'function' | 'class' | 'method' | 'variable' | 'interface';
    startLine: number;
    endLine: number;
    hash: string;  // Hash of the symbol's content for change detection
}

export interface FileSymbols {
    filePath: string;
    symbols: CodeSymbol[];
    parseTime: number;
}

export interface CodeSymbolConflict {
    symbolName: string;
    symbolType: string;
    fileA: string;
    fileB: string;
    hashA: string;
    hashB: string;
}

export class ASTParser {
    private parser: Parser;

    constructor() {
        this.parser = new Parser();
        this.parser.setLanguage(TypeScript.typescript);
    }

    /**
     * Parse a TypeScript/JavaScript file and extract symbols
     */
    parseCode(code: string, filePath: string = 'unknown'): FileSymbols {
        const start = Date.now();
        const tree = this.parser.parse(code);
        const symbols = this.extractSymbols(tree.rootNode, code);

        return {
            filePath,
            symbols,
            parseTime: Date.now() - start,
        };
    }

    /**
     * Extract all symbols from an AST
     */
    private extractSymbols(node: Parser.SyntaxNode, code: string): CodeSymbol[] {
        const symbols: CodeSymbol[] = [];

        const visit = (n: Parser.SyntaxNode) => {
            let symbolType: CodeSymbol['type'] | null = null;
            let nameNode: Parser.SyntaxNode | null = null;

            switch (n.type) {
                case 'function_declaration':
                    symbolType = 'function';
                    nameNode = n.childForFieldName('name');
                    break;
                case 'class_declaration':
                    symbolType = 'class';
                    nameNode = n.childForFieldName('name');
                    break;
                case 'method_definition':
                    symbolType = 'method';
                    nameNode = n.childForFieldName('name');
                    break;
                case 'interface_declaration':
                    symbolType = 'interface';
                    nameNode = n.childForFieldName('name');
                    break;
                case 'lexical_declaration':
                case 'variable_declaration':
                    // Only track exported or top-level variables
                    if (n.parent?.type === 'program' || n.parent?.type === 'export_statement') {
                        symbolType = 'variable';
                        const declarator = n.descendantsOfType('variable_declarator')[0];
                        nameNode = declarator?.childForFieldName('name') || null;
                    }
                    break;
            }

            if (symbolType && nameNode) {
                const content = code.slice(n.startIndex, n.endIndex);
                symbols.push({
                    name: nameNode.text,
                    type: symbolType,
                    startLine: n.startPosition.row + 1,
                    endLine: n.endPosition.row + 1,
                    hash: this.hashContent(content),
                });
            }

            // Recurse into children
            for (let i = 0; i < n.childCount; i++) {
                const child = n.child(i);
                if (child) visit(child);
            }
        };

        visit(node);
        return symbols;
    }

    /**
     * Hash symbol content for change detection
     */
    private hashContent(content: string): string {
        // Normalize whitespace before hashing
        const normalized = content.replace(/\s+/g, ' ').trim();
        return createHash('sha256').update(normalized).digest('hex').slice(0, 16);
    }

    /**
     * Compare two file versions and find symbol-level conflicts
     */
    findSymbolConflicts(
        codeA: string, fileA: string,
        codeB: string, fileB: string
    ): CodeSymbolConflict[] {
        const symbolsA = this.parseCode(codeA, fileA);
        const symbolsB = this.parseCode(codeB, fileB);

        const conflicts: CodeSymbolConflict[] = [];
        const mapA = new Map(symbolsA.symbols.map(s => [s.name, s]));

        for (const symB of symbolsB.symbols) {
            const symA = mapA.get(symB.name);
            if (symA && symA.hash !== symB.hash) {
                conflicts.push({
                    symbolName: symB.name,
                    symbolType: symB.type,
                    fileA,
                    fileB,
                    hashA: symA.hash,
                    hashB: symB.hash,
                });
            }
        }

        return conflicts;
    }

    /**
     * Check if a specific symbol was modified between two versions
     */
    isSymbolModified(codeA: string, codeB: string, symbolName: string): boolean {
        const symbolsA = this.parseCode(codeA);
        const symbolsB = this.parseCode(codeB);

        const symA = symbolsA.symbols.find(s => s.name === symbolName);
        const symB = symbolsB.symbols.find(s => s.name === symbolName);

        if (!symA && !symB) return false;  // Symbol doesn't exist in either
        if (!symA || !symB) return true;   // Symbol added or removed
        return symA.hash !== symB.hash;    // Symbol modified
    }
}

// Export singleton for convenience
export const astParser = new ASTParser();

// Export aliases for compatibility
export type Symbol = CodeSymbol;
export type SymbolConflict = CodeSymbolConflict;
