/**
 * Utility for combining multiple Regular Expressions into a single efficient RegExp.
 * Consolidates patterns using the OR (|) operator to reduce matching complexity from O(N*M) to O(1).
 */
export function compilePatterns(patterns: RegExp[]): RegExp[] {
    if (!patterns || patterns.length === 0) return [];

    // Group patterns by their flags to preserve behavior (e.g., 'i', 'g', 'm')
    const grouped = new Map<string, string[]>();

    for (const p of patterns) {
        const flags = p.flags;
        if (!grouped.has(flags)) {
            grouped.set(flags, []);
        }
        // Use non-capturing groups to ensure OR logic applies correctly to the whole pattern
        grouped.get(flags)!.push(`(?:${p.source})`);
    }

    const result: RegExp[] = [];
    for (const [flags, sources] of grouped.entries()) {
        result.push(new RegExp(sources.join('|'), flags));
    }

    return result;
}
