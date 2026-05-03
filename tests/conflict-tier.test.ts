import test from 'node:test';
import assert from 'node:assert/strict';

import {
    TIER_LABELS,
    classifyTier,
    classifyWithLabel,
} from '../dist/lib/conflict-tier.js';

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
        assert.equal(classifyTier(file), 3, `expected ${file} to classify as tier 3`);
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
        assert.equal(classifyTier(file), 2, `expected ${file} to classify as tier 2`);
    }
});

test('classifyTier falls through to 1 when no pattern matches', () => {
    assert.equal(classifyTier('src/foo.ts'), 1);
});

test('extraTier3 promotes a tier-1 file to tier 3', () => {
    assert.equal(
        classifyTier('src/foo.ts', { extraTier3: [/foo\.ts$/] }),
        3,
    );
});

test('extraTier2 promotes a tier-1 file to tier 2 but not a tier-3 file', () => {
    assert.equal(
        classifyTier('src/foo.ts', { extraTier2: [/foo\.ts$/] }),
        2,
    );
    assert.equal(
        classifyTier('src/auth.ts', { extraTier2: [/auth\.ts$/] }),
        3,
    );
});

test('TIER_LABELS exposes the canonical labels for all tiers', () => {
    assert.deepEqual(TIER_LABELS[1], {
        label: 'WARN',
        icon: '🟡',
        action: 'Consider coordinating, but safe to proceed.',
    });
    assert.deepEqual(TIER_LABELS[2], {
        label: 'PAUSE',
        icon: '🟠',
        action: 'Coordinate with other agent before proceeding.',
    });
    assert.deepEqual(TIER_LABELS[3], {
        label: 'BLOCK',
        icon: '🔴',
        action: 'Merge blocked. Resolve conflict first.',
    });
});

test('classifyWithLabel returns the merged tier-and-label shape', () => {
    assert.deepEqual(classifyWithLabel('src/server.ts'), {
        tier: 2,
        ...TIER_LABELS[2],
    });
});
