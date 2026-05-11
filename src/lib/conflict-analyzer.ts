import { ASTParser, type SymbolInfo } from './ast.js';
import { classifyTier, TIER_LABELS, type ConflictTier } from './conflict-tier.js';
import type { Branch } from '../storage/adapter.js';

export interface BranchRef {
    name: string;
    agent?: string;
}

export interface Conflict {
    file: string;
    tier: ConflictTier;
    branches: BranchRef[];
    symbolsOverlap?: string[];
    classifierSource: 'path' | 'symbol';
    recommendation: string;
}

export interface ConflictReport {
    conflicts: Conflict[];
    highest: ConflictTier;
    shouldBlock: boolean;
    byTier: Record<ConflictTier, Conflict[]>;
}

interface AnalyzerOptions {
    extraTier3?: RegExp[];
    extraTier2?: RegExp[];
    useSymbolAware?: boolean;
}

interface AnalyzerInput {
    branches: Array<Pick<Branch, 'name' | 'files' | 'agent' | 'status'>>;
    targetFiles: string[];
    options?: AnalyzerOptions;
}

const SYMBOL_TIER_3_PATTERNS: RegExp[] = [
    /auth/i,
    /security/i,
    /secret/i,
    /credential/i,
    /password/i,
    /token/i,
    /api[_-]?key/i,
    /private[_-]?key/i,
];

const SYMBOL_TIER_2_PATTERNS: RegExp[] = [
    /config/i,
    /server/i,
    /index/i,
];

export function analyzeConflicts(input: AnalyzerInput): ConflictReport {
    const options = input.options ?? {};
    const targetFiles = unique(input.targetFiles);
    const targetFilesSet = new Set(targetFiles);
    const activeBranches = input.branches.filter(branch => branch.status === 'active');
    const branchesByFile = new Map<string, BranchRef[]>();
    const astParser = options.useSymbolAware ? new ASTParser() : null;

    for (const branch of activeBranches) {
        const seenFiles = new Set<string>();

        for (const file of branch.files) {
            if (!targetFilesSet.has(file) || seenFiles.has(file)) {
                continue;
            }

            seenFiles.add(file);

            const refs = branchesByFile.get(file) ?? [];
            refs.push({ name: branch.name, agent: branch.agent });
            branchesByFile.set(file, refs);
        }
    }

    const conflicts: Conflict[] = [];
    const byTier: Record<ConflictTier, Conflict[]> = { 1: [], 2: [], 3: [] };
    let highest: ConflictTier = 1;

    for (const file of targetFiles) {
        const branches = branchesByFile.get(file);
        if (!branches || branches.length === 0) {
            continue;
        }

        const pathTier = classifyTier(file, {
            extraTier3: options.extraTier3,
            extraTier2: options.extraTier2,
        });

        let tier = pathTier;
        let classifierSource: Conflict['classifierSource'] = 'path';
        let symbolsOverlap: string[] | undefined;

        if (astParser && isSymbolAwareFile(file)) {
            try {
                const symbolTier = classifySymbolTier(astParser.getSymbols(file));
                tier = Math.max(pathTier, symbolTier.tier) as ConflictTier;
                classifierSource = 'symbol';
                symbolsOverlap = symbolTier.matches.length > 0 ? symbolTier.matches : undefined;
            } catch {
                tier = pathTier;
                classifierSource = 'path';
            }
        }

        const conflict: Conflict = {
            file,
            tier,
            branches,
            classifierSource,
            recommendation: TIER_LABELS[tier].action,
            ...(symbolsOverlap ? { symbolsOverlap } : {}),
        };

        conflicts.push(conflict);
        byTier[tier].push(conflict);
        if (tier > highest) {
            highest = tier;
        }
    }

    return {
        conflicts,
        highest,
        shouldBlock: highest === 3,
        byTier,
    };
}

function unique(values: string[]): string[] {
    return [...new Set(values)];
}

function isSymbolAwareFile(file: string): boolean {
    return /\.(ts|tsx|js|jsx)$/.test(file);
}

function classifySymbolTier(symbols: SymbolInfo[]): { tier: ConflictTier; matches: string[] } {
    const tier3Matches = collectMatchingSymbols(symbols, SYMBOL_TIER_3_PATTERNS);
    if (tier3Matches.length > 0) {
        return { tier: 3, matches: tier3Matches };
    }

    const tier2Matches = collectMatchingSymbols(symbols, SYMBOL_TIER_2_PATTERNS);
    if (tier2Matches.length > 0) {
        return { tier: 2, matches: tier2Matches };
    }

    return { tier: 1, matches: [] };
}

function collectMatchingSymbols(symbols: SymbolInfo[], patterns: RegExp[]): string[] {
    const matches = new Set<string>();

    for (const symbol of symbols) {
        for (const pattern of patterns) {
            if (pattern.test(symbol.name)) {
                matches.add(symbol.name);
                break;
            }
        }
    }

    return [...matches];
}
