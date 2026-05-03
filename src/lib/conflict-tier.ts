import { compilePatterns } from './regex-utils.js';

export type ConflictTier = 1 | 2 | 3;

export interface TierLabel {
    label: string;
    icon: string;
    action: string;
}

export const DEFAULT_TIER_3_PATTERNS: RegExp[] = [
    /\.env$/,
    /secrets?\./i,
    /credentials/i,
    /password/i,
    /api[_-]?key/i,
    /private[_-]?key/i,
    /\.pem$/,
    /auth\.(ts|js)$/,
    /security\.(ts|js)$/,
];

export const DEFAULT_TIER_2_PATTERNS: RegExp[] = [
    /package\.json$/,
    /package-lock\.json$/,
    /tsconfig\.json$/,
    /CLAUDE\.md$/,
    /\.gitignore$/,
    /server\.(ts|js)$/,
    /index\.(ts|js)$/,
    /config\.(ts|js)$/,
];

const COMPILED_DEFAULT_TIER_3 = compilePatterns(DEFAULT_TIER_3_PATTERNS);
const COMPILED_DEFAULT_TIER_2 = compilePatterns(DEFAULT_TIER_2_PATTERNS);

export const TIER_LABELS: Record<ConflictTier, TierLabel> = {
    1: { label: 'WARN', icon: '🟡', action: 'Consider coordinating, but safe to proceed.' },
    2: { label: 'PAUSE', icon: '🟠', action: 'Coordinate with other agent before proceeding.' },
    3: { label: 'BLOCK', icon: '🔴', action: 'Merge blocked. Resolve conflict first.' },
};

export function classifyTier(
    file: string,
    opts: { extraTier3?: RegExp[]; extraTier2?: RegExp[] } = {},
): ConflictTier {
    const tier3 = [...COMPILED_DEFAULT_TIER_3, ...compilePatterns(opts.extraTier3 ?? [])];
    for (const pattern of tier3) {
        if (pattern.test(file)) {
            return 3;
        }
    }

    const tier2 = [...COMPILED_DEFAULT_TIER_2, ...compilePatterns(opts.extraTier2 ?? [])];
    for (const pattern of tier2) {
        if (pattern.test(file)) {
            return 2;
        }
    }

    return 1;
}

export function classifyWithLabel(
    file: string,
    opts: { extraTier3?: RegExp[]; extraTier2?: RegExp[] } = {},
): { tier: ConflictTier } & TierLabel {
    const tier = classifyTier(file, opts);
    return { tier, ...TIER_LABELS[tier] };
}
