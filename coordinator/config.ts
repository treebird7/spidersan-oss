/// <reference types="node" />
/**
 * PR coordinator — the loop's config (slice 4 of 4, part 3a).
 *
 * The same JSON file `main.ts` reads `hostId` and `stateDb` from. Nothing here
 * has a default: a missing or malformed field is no config at all (exit 78).
 *
 * `live` is refused: no adapter that merges exists yet.
 *
 * `githubTokens` maps a GitHub owner to the name of the environment variable
 * that holds its fine-grained token (sp-vkqq). Every repo's owner must be in it,
 * exactly as the repo key spells it. A fine-grained token covers one owner, so
 * no two owners may share a variable, and the ambient `GH_TOKEN` and
 * `GITHUB_TOKEN` are not names it may use: they are what `gh` falls back to.
 *
 * ponytail: no required CI contexts, gate context or checkout path. `decide`
 * reads CI and conflicts only for a PR with a trusted task link, and no PR has
 * one until invoak can answer who registered a branch (invk-fosip). Add them
 * with the reader that makes them reachable.
 */

import { isAbsolute } from 'node:path';
import { validatePolicy } from './decide';
import { isRepoSlug } from './readers';
import type { TouchPatterns } from './readers';
import { TRIAGE_MODELS } from './types';
import type { Policy } from './types';

const PRINCIPAL = /^[a-z0-9][a-z0-9-]{0,62}$/;
const PROJECT = /^[a-z0-9]{2,12}$/;
/** A GitHub owner (user or organization) name. */
const GITHUB_OWNER = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;
const ENV_NAME = /^[A-Z_][A-Z0-9_]{0,127}$/;
/** What `gh` reads by itself: a token there would stand in for a missing one. */
const AMBIENT_TOKENS: readonly string[] = ['GH_TOKEN', 'GITHUB_TOKEN', 'GH_ENTERPRISE_TOKEN', 'GITHUB_ENTERPRISE_TOKEN'];

export interface RepoConfig {
    /** invoak projects a PR title's `(xx-abcd)` may name. A task in any other project is no note target. */
    taskProjects: readonly string[];
    policy: Policy;
    touches: TouchPatterns;
}

export interface PrsanConfig {
    /** Absolute path of the prsan agent directory: `bin/prsan`, `bin/triage`, `reviews/`. */
    home: string;
    /** How long one review or triage run may take before it is killed. */
    timeoutMs: number;
    /** Model family → what `prsan -m` is given. Holds luna, terra, sol and every repo's `secondFamily`. */
    models: Readonly<Record<string, string>>;
    /** A review file's `model:` header value → model family. Every family that can be run is the value of at least one entry. */
    families: Readonly<Record<string, string>>;
}

export interface LoopConfig {
    /** This coordinator's invoak principal. */
    self: string;
    owner: string;
    /** The invoak project escalation tasks are created in. */
    escalationProject: string;
    maxReviewsPerPass: number;
    /** GitHub owner → the environment variable holding that owner's token. */
    githubTokens: Readonly<Record<string, string>>;
    prsan: PrsanConfig;
    repos: Readonly<Record<string, RepoConfig>>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** One argv element that cannot be taken for a flag. */
function isArg(value: unknown): value is string {
    return typeof value === 'string' && value !== '' && !value.startsWith('-') && !/[\0\s]/.test(value);
}

function isTextMap(value: unknown): value is Record<string, string> {
    return isRecord(value) && Object.values(value).every(isArg);
}

function isPaths(value: unknown): value is string[] {
    return Array.isArray(value) && value.every((path) => typeof path === 'string' && path !== '');
}

/** The owner → variable map, or null. Each variable is named once. */
function parseTokens(value: unknown): Record<string, string> | null {
    if (!isRecord(value)) return null;
    const names = Object.values(value);
    if (new Set(names).size !== names.length) return null;
    for (const [owner, name] of Object.entries(value)) {
        if (!GITHUB_OWNER.test(owner)) return null;
        if (typeof name !== 'string' || !ENV_NAME.test(name) || AMBIENT_TOKENS.includes(name)) return null;
    }
    return value as Record<string, string>;
}

/** The variable that holds `repo`'s token: its owner's entry, matched exactly. Undefined when there is none. */
export function tokenVariable(tokens: Readonly<Record<string, string>>, repo: string): string | undefined {
    if (!isRepoSlug(repo)) return undefined;
    const owner = repo.slice(0, repo.indexOf('/'));
    return Object.hasOwn(tokens, owner) ? tokens[owner] : undefined;
}

function parseRepo(raw: unknown, models: Record<string, string>, read: ReadonlySet<string>): RepoConfig | null {
    if (!isRecord(raw)) return null;
    const { taskProjects, policy, touches } = raw;
    if (!Array.isArray(taskProjects) || taskProjects.length === 0) return null;
    if (!taskProjects.every((p) => typeof p === 'string' && PROJECT.test(p))) return null;
    if (validatePolicy(policy) !== null) return null;
    const checked = policy as Policy;
    if (checked.mode === 'live' || !Object.hasOwn(models, checked.secondFamily)) return null;
    if (!read.has(checked.secondFamily)) return null;
    if (!isRecord(touches) || !isPaths(touches.protectedPaths) || !isPaths(touches.mergeEffects)) return null;
    if (touches.protectedPaths.length === 0) return null;
    return {
        taskProjects: taskProjects as string[],
        policy: checked,
        touches: { protectedPaths: touches.protectedPaths, mergeEffects: touches.mergeEffects },
    };
}

/** The loop's config in `text`, or null. */
export function parseLoopConfig(text: string): LoopConfig | null {
    let raw: unknown;
    try {
        raw = JSON.parse(text);
    } catch {
        return null;
    }
    if (!isRecord(raw)) return null;
    const { self, owner, escalationProject, maxReviewsPerPass, githubTokens, prsan, repos } = raw;
    if (typeof self !== 'string' || !PRINCIPAL.test(self)) return null;
    if (typeof owner !== 'string' || !PRINCIPAL.test(owner) || owner === self) return null;
    if (typeof escalationProject !== 'string' || !PROJECT.test(escalationProject)) return null;
    if (!Number.isSafeInteger(maxReviewsPerPass) || (maxReviewsPerPass as number) < 1) return null;

    if (!isRecord(prsan) || typeof prsan.home !== 'string' || !isAbsolute(prsan.home)) return null;
    if (!Number.isSafeInteger(prsan.timeoutMs) || (prsan.timeoutMs as number) < 1) return null;
    const { models, families } = prsan;
    if (!isTextMap(models) || !isTextMap(families)) return null;
    // A family no header maps to can be run but never read back: its review would be paid for on every pass.
    const read = new Set(Object.values(families));
    if (!TRIAGE_MODELS.every((family) => Object.hasOwn(models, family) && read.has(family))) return null;

    const tokens = parseTokens(githubTokens);
    if (tokens === null || !isRecord(repos)) return null;
    const parsed: Record<string, RepoConfig> = {};
    for (const [slug, entry] of Object.entries(repos)) {
        const repo = isRepoSlug(slug) ? parseRepo(entry, models, read) : null;
        if (repo === null || tokenVariable(tokens, slug) === undefined) return null;
        parsed[slug] = repo;
    }
    return {
        self,
        owner,
        escalationProject,
        maxReviewsPerPass: maxReviewsPerPass as number,
        githubTokens: tokens,
        prsan: { home: prsan.home, timeoutMs: prsan.timeoutMs as number, models, families },
        repos: parsed,
    };
}
