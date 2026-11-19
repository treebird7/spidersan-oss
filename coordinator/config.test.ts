import { describe, expect, test } from 'bun:test';
import { parseLoopConfig } from './config';

const policy = () => ({
    mode: 'dry-run',
    ceiling: 5,
    reservations: { triage: 0.05, plain: 0.5, second: 0.5, vector: 0.5 },
    maxHeads: 4,
    secondFamily: 'claude',
    stallClaimantMs: 1,
    stallOwnerMs: 2,
    effectsClassified: false,
    mergeGateApplied: false,
    webhookInstalled: false,
});

/** A whole valid config; `edit` breaks one thing. */
function config(edit: (c: any) => void = () => {}): string {
    const c = {
        hostId: 'h',
        stateDb: '/x/state.db',
        self: 'spidersan',
        owner: 'treebird',
        escalationProject: 'sp',
        maxReviewsPerPass: 10,
        prsan: {
            home: '/x/prsan',
            timeoutMs: 1000,
            models: { luna: 'luna', terra: 'terra', sol: 'sol', claude: 'claude/claude-opus-5-5' },
            families: { 'a/luna': 'luna', 'a/terra': 'terra', 'a/sol': 'sol', 'claude/claude-opus-5-5': 'claude' },
        },
        repos: {
            'owner/name': {
                taskProjects: ['sp'],
                policy: policy(),
                touches: { protectedPaths: ['coordinator/'], mergeEffects: [] },
            },
        },
    };
    edit(c);
    return JSON.stringify(c);
}

describe('parseLoopConfig', () => {
    test('a whole config parses, with nothing added', () => {
        const parsed = parseLoopConfig(config());
        expect(parsed?.repos['owner/name']?.policy).toEqual(policy() as never);
        expect(parsed?.owner).toBe('treebird');
        expect(parsed?.prsan.models.claude).toBe('claude/claude-opus-5-5');
    });

    test('no repos is a config: a reconcile-only coordinator', () => {
        expect(parseLoopConfig(config((c) => (c.repos = {})))?.repos).toEqual({});
    });

    test.each<[string, (c: any) => void]>([
        ['live mode', (c) => (c.repos['owner/name'].policy.mode = 'live')],
        ['a malformed policy', (c) => delete c.repos['owner/name'].policy.ceiling],
        ['no policy', (c) => delete c.repos['owner/name'].policy],
        ['a second family with no model', (c) => (c.repos['owner/name'].policy.secondFamily = 'gemini')],
        ['no sol model', (c) => delete c.prsan.models.sol],
        ['a model that reads as a flag', (c) => (c.prsan.models.luna = '--diff-file')],
        ['a model with a space', (c) => (c.prsan.models.luna = 'luna x')],
        ['no families', (c) => delete c.prsan.families],
        ['a triage family no header maps to', (c) => delete c.prsan.families['a/sol']],
        ['a second family no header maps to', (c) => delete c.prsan.families['claude/claude-opus-5-5']],
        ['a relative prsan home', (c) => (c.prsan.home = 'prsan')],
        ['no timeout', (c) => delete c.prsan.timeoutMs],
        ['no protected paths', (c) => (c.repos['owner/name'].touches.protectedPaths = [])],
        ['no mergeEffects list', (c) => delete c.repos['owner/name'].touches.mergeEffects],
        ['no task projects', (c) => (c.repos['owner/name'].taskProjects = [])],
        ['a task project that is not one', (c) => (c.repos['owner/name'].taskProjects = ['SP-x'])],
        ['a repo key that is not owner/name', (c) => (c.repos = { name: c.repos['owner/name'] })],
        ['repos as a list', (c) => (c.repos = [])],
        ['no repos', (c) => delete c.repos],
        ['no review cap', (c) => delete c.maxReviewsPerPass],
        ['a zero review cap', (c) => (c.maxReviewsPerPass = 0)],
        ['the owner as the coordinator', (c) => (c.owner = 'spidersan')],
        ['no owner', (c) => delete c.owner],
        ['no self', (c) => delete c.self],
        ['no escalation project', (c) => delete c.escalationProject],
    ])('refuses %s', (_name, edit) => {
        expect(parseLoopConfig(config(edit))).toBeNull();
    });

    test('refuses text that is not a JSON object', () => {
        expect(parseLoopConfig('nope')).toBeNull();
        expect(parseLoopConfig('[]')).toBeNull();
    });
});
