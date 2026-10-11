import { describe, it, expect } from 'vitest';
import { normalizeRemoteUrl, isTreebirdRepo } from '../src/lib/git-events-subscriber';

/**
 * git-watch matches an event's repo (GitHub's canonical "Owner/repo") to local clones
 * keyed by their remote URL. treebird and seven other repos moved to the
 * Treebird-Ecosystem org on 2026-10-11, so names now differ in owner and in case.
 */
describe('git-watch repo names after the org move', () => {
    it('keys a remote case-insensitively, ssh or https', () => {
        expect(normalizeRemoteUrl('https://github.com/Treebird-Ecosystem/treebird.git')).toBe('treebird-ecosystem/treebird');
        expect(normalizeRemoteUrl('git@github.com:treebird7/Envoak.git')).toBe('treebird7/envoak');
        // dispatchEvent looks up event.repo.toLowerCase(); GitHub reports this casing
        expect(normalizeRemoteUrl('https://github.com/treebird-ecosystem/PRsan.git')).toBe('Treebird-Ecosystem/PRsan'.toLowerCase());
    });

    it('treats treebird under either org as the tree repo', () => {
        expect(isTreebirdRepo('Treebird-Ecosystem/treebird')).toBe(true);
        expect(isTreebirdRepo('treebird7/treebird')).toBe(true);
        expect(isTreebirdRepo('Treebird-Ecosystem/skills')).toBe(false);
        expect(isTreebirdRepo('treebird7/treebird-hub')).toBe(false);
    });
});
