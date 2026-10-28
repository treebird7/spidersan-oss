import Parser from 'tree-sitter';
import TypeScript from 'tree-sitter-typescript';

export class ASTParser {
    private parser: Parser;

    constructor() {
        this.parser = new Parser();
        // @ts-ignore - formatting quirk with bindings
        this.parser.setLanguage(TypeScript.typescript);
    }

    parse(code: string): Parser.Tree {
        return this.parser.parse(code);
    }

    getFunctionNames(tree: Parser.Tree): string[] {
        const functions: string[] = [];
        const cursor = tree.walk();

        const visit = (node: Parser.SyntaxNode) => {
            if (node.type === 'function_declaration') {
                const nameNode = node.childForFieldName('name');
                if (nameNode) functions.push(nameNode.text);
            }
            if (node.type === 'method_definition') {
                const nameNode = node.childForFieldName('name');
                if (nameNode) functions.push(nameNode.text);
            }

            for (let i = 0; i < node.childCount; i++) {
                const child = node.child(i);
                if (child) visit(child);
            }
        };

        visit(tree.rootNode);
        return functions;
    }
}
