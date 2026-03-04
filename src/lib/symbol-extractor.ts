/**
 * symbol-extractor.ts — Phase C semantic intelligence
 *
 * Extract exported symbols (functions, classes, types, consts) from a TS file
 * using ts-morph. Used by `spidersan conflicts --semantic`.
 */

import { Project, SyntaxKind } from 'ts-morph';
import { existsSync } from 'fs';

export interface ExtractedSymbol {
  name: string;
  kind: 'function' | 'class' | 'type' | 'interface' | 'const' | 'enum' | 'other';
  line: number;
}

export interface FileSymbols {
  file: string;
  symbols: ExtractedSymbol[];
}

/**
 * Extract all exported symbols from a TypeScript file.
 * Returns an empty symbols array if the file doesn't exist or isn't parseable.
 */
export function extractSymbols(filePath: string): FileSymbols {
  if (!existsSync(filePath)) {
    return { file: filePath, symbols: [] };
  }

  try {
    const project = new Project({
      compilerOptions: { allowJs: true },
      skipAddingFilesFromTsConfig: true,
    });
    const sourceFile = project.addSourceFileAtPath(filePath);
    const symbols: ExtractedSymbol[] = [];

    for (const decl of sourceFile.getExportedDeclarations()) {
      const [name, nodes] = decl as [string, import('ts-morph').ExportedDeclarations[]];
      for (const node of nodes) {
        const kind = kindOf(node.getKind());
        const line = node.getStartLineNumber();
        symbols.push({ name, kind, line });
      }
    }

    return { file: filePath, symbols };
  } catch {
    return { file: filePath, symbols: [] };
  }
}

function kindOf(syntaxKind: SyntaxKind): ExtractedSymbol['kind'] {
  switch (syntaxKind) {
    case SyntaxKind.FunctionDeclaration:
    case SyntaxKind.ArrowFunction:
    case SyntaxKind.FunctionExpression:
    case SyntaxKind.MethodDeclaration:
      return 'function';
    case SyntaxKind.ClassDeclaration:
      return 'class';
    case SyntaxKind.TypeAliasDeclaration:
      return 'type';
    case SyntaxKind.InterfaceDeclaration:
      return 'interface';
    case SyntaxKind.EnumDeclaration:
      return 'enum';
    case SyntaxKind.VariableDeclaration:
    case SyntaxKind.VariableStatement:
      return 'const';
    default:
      return 'other';
  }
}

/**
 * Find symbol-level overlaps between two sets of file symbols.
 * Returns symbols that share the same name across different branches.
 */
export interface SymbolOverlap {
  name: string;
  kind: ExtractedSymbol['kind'];
  branches: Array<{ branch: string; file: string; line: number }>;
}

export function findSymbolOverlaps(
  left: { branch: string; symbols: FileSymbols },
  right: { branch: string; symbols: FileSymbols },
): SymbolOverlap[] {
  const leftMap = new Map(left.symbols.symbols.map(s => [s.name, s]));
  const overlaps: SymbolOverlap[] = [];

  for (const rs of right.symbols.symbols) {
    const ls = leftMap.get(rs.name);
    if (ls) {
      overlaps.push({
        name: rs.name,
        kind: rs.kind,
        branches: [
          { branch: left.branch, file: left.symbols.file, line: ls.line },
          { branch: right.branch, file: right.symbols.file, line: rs.line },
        ],
      });
    }
  }

  return overlaps;
}
