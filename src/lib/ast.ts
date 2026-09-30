import Parser from 'tree-sitter';
import TypeScript from 'tree-sitter-typescript';
import fs from 'fs';
import { createHash } from 'crypto';

export interface SymbolInfo {
    name: string;
    type: 'function' | 'class' | 'method';
    startLine: number;
    endLine: number;
    /** Enclosing class name for methods, so `A.render` and `B.render` don't collide. */
    parent?: string;
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
        // node-tree-sitter throws "Invalid argument" past its default ~32KB buffer
        return this.parser.parse(code, undefined, { bufferSize: Math.max(code.length + 1, 32 * 1024) });
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
            parent?: string;
            depth: number;
        }> = [];

        let visitedChildren = false;
        let depth = 0;

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
                                ...(top.parent ? { parent: top.parent } : {}),
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
                const valueType = type === 'variable_declarator'
                    ? cursor.currentNode.childForFieldName('value')?.type
                    : undefined;
                // `const f = () => {}` / `const f = function () {}` are functions too
                const isFnConst = valueType === 'arrow_function' || valueType === 'function_expression' || valueType === 'function';
                if (type === 'function_declaration' || type === 'class_declaration' || type === 'method_definition' || isFnConst) {
                    const parentClass = type === 'method_definition'
                        ? [...stack].reverse().find(e => e.type === 'class')?.name ?? undefined
                        : undefined;
                    stack.push({
                        type: isFnConst ? 'function' : type.replace('_declaration', '').replace('_definition', '') as SymbolInfo['type'],
                        startLine: cursor.startPosition.row + 1,
                        endLine: cursor.endPosition.row + 1,
                        name: null,
                        parent: parentClass,
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
     * Compare two versions of code and find symbols that differ in content.
     * With `baseContent` (the merge-base version) this is a three-way check: a
     * symbol only conflicts if BOTH sides changed it from base. Without it the
     * check is two-way and over-reports one-sided edits.
     */
    findSymbolConflicts(
        contentA: string, labelA: string,
        contentB: string, labelB: string,
        baseContent?: string
    ): SymbolConflict[] {
        return compareSymbols(
            this.extractSymbols(this.parse(contentA)), labelA,
            this.extractSymbols(this.parse(contentB)), labelB,
            baseContent === undefined ? undefined : this.extractSymbols(this.parse(baseContent))
        );
    }
}

/** Language-agnostic core: two symbol lists (+ optional merge-base list) → conflicts. */
export function compareSymbols(
    symbolsA: SymbolInfo[], labelA: string,
    symbolsB: SymbolInfo[], labelB: string,
    symbolsBase?: SymbolInfo[]
): SymbolConflict[] {
        const baseContentByName = new Map<string, string | undefined>();
        symbolsBase?.forEach(s => baseContentByName.set(qualify(s), s.content));
        const baseContent = symbolsBase;

        const conflicts: SymbolConflict[] = [];

        // Map for fast lookup
        const mapB = new Map<string, SymbolInfo>();
        symbolsB.forEach(s => mapB.set(qualify(s), s));

        for (const symA of symbolsA) {
            const symB = mapB.get(qualify(symA));
            // If symbol exists in both and content differs
            if (symB && symA.content !== symB.content) {
                if (baseContent !== undefined) {
                    const base = baseContentByName.get(qualify(symA));
                    // one-sided edit: the other side still equals base, git merges it cleanly
                    if (symA.content === base || symB.content === base) continue;
                }
                conflicts.push({
                    symbolName: qualify(symA),
                    symbolType: symA.type,
                    locations: [
                        { file: labelA, range: [symA.startLine, symA.endLine] },
                        { file: labelB, range: [symB.startLine, symB.endLine] }
                    ]
                });
            }
        }

        // A class always "changes" when one of its methods does; report the method, not both.
        return conflicts.filter(c => c.symbolType !== 'class' ||
            !conflicts.some(m => m.symbolType === 'method' && m.symbolName.startsWith(`${c.symbolName}.`)));
}

export const qualify = (s: SymbolInfo): string => (s.parent ? `${s.parent}.${s.name}` : s.name);

export interface SymbolConflict {
    symbolName: string;
    symbolType: string;
    locations: { file: string; range: [number, number] }[];
}
