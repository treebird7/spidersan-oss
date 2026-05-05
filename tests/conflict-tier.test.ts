import { test, expect } from 'vitest';

import {
    TIER_LABELS,
    classifyTier,
    classifyWithLabel,
} from '../src/lib/conflict-tier.js';

test('classifyTier returns 3 for default tier-3 patterns', () => {
    const tier3Files = [
        '.env',
        'config/secrets.txt',
        'src/password-reset.ts',
        'config/api-key.json',
        'keys/service.pem',
        'src/auth.ts',
        'src/security.ts',
        'config/credentials.json',
    ];

    for (const file of tier3Files) {
        expect(classifyTier(file)).toBe(3);
    }
});

test('classifyTier returns 2 for default tier-2 patterns', () => {
    const tier2Files = [
        'package.json',
        'tsconfig.json',
        'CLAUDE.md',
        'src/server.ts',
        'package-lock.json',
        '.gitignore',
        'src/index.ts',
        'src/config.ts',
    ];

    for (const file of tier2Files) {
        expect(classifyTier(file)).toBe(2);
    }
});

test('classifyTier falls through to 1 when no pattern matches', () => {
    expect(classifyTier('src/foo.ts')).toBe(1);
});

test('extraTier3 promotes a tier-1 file to tier 3', () => {
    expect(classifyTier('src/foo.ts', { extraTier3: [/foo\.ts$/] })).toBe(3);
});

test('extraTier2 promotes a tier-1 file to tier 2 but not a tier-3 file', () => {
    expect(classifyTier('src/foo.ts', { extraTier2: [/foo\.ts$/] })).toBe(2);
    expect(classifyTier('src/auth.ts', { extraTier2: [/auth\.ts$/] })).toBe(3);
});

test('TIER_LABELS exposes the canonical labels for all tiers', () => {
    expect(TIER_LABELS[1]).toEqual({
        label: 'WARN',
        icon: '🟡',
        action: 'Consider coordinating, but safe to proceed.',
    });
    expect(TIER_LABELS[2]).toEqual({
        label: 'PAUSE',
        icon: '🟠',
        action: 'Coordinate with other agent before proceeding.',
    });
    expect(TIER_LABELS[3]).toEqual({
        label: 'BLOCK',
        icon: '🔴',
        action: 'Merge blocked. Resolve conflict first.',
    });
});

test('classifyWithLabel returns the merged tier-and-label shape', () => {
    expect(classifyWithLabel('src/server.ts')).toEqual({
        tier: 2,
        ...TIER_LABELS[2],
    });
});
