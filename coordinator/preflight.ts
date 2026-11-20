/**
 * PR coordinator — the GitHub token preflight (sp-vkqq).
 *
 * Each repo is read with its owner's fine-grained token (`githubTokens` in the
 * config), never with the host's own `gh` login. Before any pass, for every
 * repo in the config, the token must:
 *
 *   1. be in the environment, under the variable the config names;
 *   2. read the repo (metadata, pull requests, contents, commit statuses and
 *      Actions runs: everything a pass reads);
 *   3. not be expired (`github-authentication-token-expiration`); under
 *      EXPIRY_WARN_MS from expiry it is a warning, not a refusal;
 *   4. in a mode that writes to GitHub (`live`: the merge-gate status), write
 *      commit statuses. The probe posts a status to the all-zero sha, which no
 *      commit has: 422 means the token may write, 403 that it may not. Nothing
 *      is created either way.
 *
 * Any other answer, a timeout included, is a problem: the coordinator refuses
 * to start (EXIT_CREDENTIALS in main.ts). A message names the repo, the
 * variable and what is missing, never the token.
 *
 * ponytail: contents and pull-request write (the merge itself) have no probe
 * without side effects. GitHub's merge call is the check for those.
 */

import { tokenVariable } from './config';
import type { LoopConfig } from './config';
import { isFullSha } from './decide';
import { isToken } from './github';
import type { TokenFor } from './github';
import { isGitRef, isRepoSlug } from './readers';
import type { CommandRunner } from './readers';
import type { Mode } from './types';

/** A token this close to its expiry still starts, with a warning: time to mint the next one. */
export const EXPIRY_WARN_MS = 14 * 24 * 60 * 60 * 1000;
const ZERO_SHA = '0'.repeat(40);
const PROBE_CONTEXT = 'spidersan/preflight';
const EXPIRY_HEADER = 'github-authentication-token-expiration';
const ACCEPTED_HEADER = 'x-accepted-github-permissions';

/** The token for each repo, read from `env` through the config's owner → variable map. */
export function tokensFrom(
    githubTokens: Readonly<Record<string, string>>,
    env: Record<string, string | undefined>,
): TokenFor {
    return (repo) => {
        const name = tokenVariable(githubTokens, repo);
        return name === undefined ? undefined : env[name];
    };
}

export interface Response {
    status: number;
    /** Lower-cased names: `gh` re-cases them. */
    headers: ReadonlyMap<string, string>;
    /** The JSON body; undefined when it is not JSON. */
    body: unknown;
}

/** `gh api -i` output → the response. Null when it does not start with a status line. */
export function parseResponse(stdout: unknown): Response | null {
    if (typeof stdout !== 'string') return null;
    const split = /\r?\n\r?\n/.exec(stdout);
    const head = split === null ? stdout : stdout.slice(0, split.index);
    const text = split === null ? '' : stdout.slice(split.index + split[0].length);
    const [statusLine, ...lines] = head.split(/\r?\n/);
    const status = /^HTTP\/[0-9.]+ ([1-5][0-9]{2})(?: |$)/.exec(statusLine ?? '');
    if (status === null) return null;
    const headers = new Map<string, string>();
    for (const line of lines) {
        const colon = line.indexOf(':');
        if (colon > 0) headers.set(line.slice(0, colon).trim().toLowerCase(), line.slice(colon + 1).trim());
    }
    let body: unknown;
    try {
        body = JSON.parse(text);
    } catch {
        body = undefined;
    }
    return { status: Number(status[1]), headers, body };
}

const EXPIRY = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2}) (UTC|[+-]\d{4})$/;

/**
 * The expiry header's value (`2027-02-18 17:10:09 UTC`, 2026-11-20) → epoch ms. Null when there is no header (a token
 * that does not expire); NaN when it cannot be read.
 */
export function parseExpiry(value: string | undefined): number | null {
    if (value === undefined) return null;
    const m = EXPIRY.exec(value);
    if (m === null) return NaN;
    const offset = m[7] === 'UTC' ? 'Z' : `${m[7]?.slice(0, 3)}:${m[7]?.slice(3)}`;
    return Date.parse(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}${offset}`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export interface PreflightRepo {
    repo: string;
    mode: Mode;
}

export interface Preflight {
    /** One line per repo the coordinator may not start with. */
    problems: string[];
    /** Tokens close to expiry. */
    warnings: string[];
    /** One line per repo that passed. */
    passed: string[];
}

/** Only `live` writes to GitHub; review-only and dry-run deliver through invoak. */
export const writesGitHub = (mode: Mode): boolean => mode === 'live';

type Outcome = { problem: string } | { passed: string; warning?: string };

async function call(run: CommandRunner, token: string, argv: string[]): Promise<Response | null> {
    try {
        const result: unknown = await run('gh', ['api', '-i', ...argv], { cwd: '/', githubToken: token });
        return isRecord(result) ? parseResponse(result.stdout) : null;
    } catch {
        return null;
    }
}

function refused(response: Response | null): string {
    if (response === null) return 'no answer';
    const wants = response.headers.get(ACCEPTED_HEADER);
    return `HTTP ${response.status}${wants === undefined || wants === '' ? '' : `, GitHub asks for ${wants}`}`;
}

async function checkRepo(
    run: CommandRunner,
    target: PreflightRepo,
    githubTokens: Readonly<Record<string, string>>,
    env: Record<string, string | undefined>,
    now: number,
    probeWrites: (mode: Mode) => boolean,
): Promise<Outcome> {
    const { repo } = target;
    if (!isRepoSlug(repo)) return { problem: `${repo}: not an owner/name` };
    const name = tokenVariable(githubTokens, repo);
    if (name === undefined) return { problem: `${repo}: no githubTokens entry for its owner` };
    const token = env[name];
    if (token === undefined || token === '') return { problem: `${repo}: ${name} is not set` };
    if (!isToken(token)) return { problem: `${repo}: ${name} does not hold a token (empty, or has spaces)` };
    const fail = (what: string): Outcome => ({ problem: `${repo}: ${name} ${what}` });

    const meta = await call(run, token, [`repos/${repo}`]);
    if (meta === null || meta.status !== 200 || !isRecord(meta.body)) {
        return fail(`cannot read the repository (${refused(meta)})`);
    }
    if (meta.body.full_name !== repo) {
        return fail(`reads the repository as ${String(meta.body.full_name)}: the config must spell it that way`);
    }
    const expires = parseExpiry(meta.headers.get(EXPIRY_HEADER));
    if (expires !== null && Number.isNaN(expires)) return fail(`has an expiry GitHub states in a form not read here`);
    if (expires !== null && expires <= now) return fail(`expired at ${new Date(expires).toISOString()}`);
    const branch = meta.body.default_branch;
    if (!isGitRef(branch)) return fail('cannot read the default branch name');

    const pulls = await call(run, token, [`repos/${repo}/pulls?state=open&per_page=1`]);
    if (pulls?.status !== 200) return fail(`cannot read pull requests (${refused(pulls)})`);
    const ref = await call(run, token, [`repos/${repo}/git/ref/heads/${branch}`]);
    const tip = ref !== null && isRecord(ref.body) && isRecord(ref.body.object) ? ref.body.object.sha : undefined;
    if (ref?.status !== 200 || !isFullSha(tip)) return fail(`cannot read contents (${refused(ref)})`);
    const status = await call(run, token, [`repos/${repo}/commits/${tip}/status?per_page=1`]);
    if (status?.status !== 200) return fail(`cannot read commit statuses (${refused(status)})`);
    const runs = await call(run, token, [`repos/${repo}/actions/runs?per_page=1`]);
    if (runs?.status !== 200) return fail(`cannot read Actions runs (${refused(runs)})`);

    const writes = probeWrites(target.mode);
    if (writes) {
        const post = await call(run, token, [
            '-X',
            'POST',
            `repos/${repo}/statuses/${ZERO_SHA}`,
            '-f',
            'state=pending',
            '-f',
            `context=${PROBE_CONTEXT}`,
        ]);
        if (post?.status === 403) return fail(`cannot write commit statuses (${refused(post)})`);
        if (post?.status !== 422) return fail(`status write probe: ${refused(post)}, expected HTTP 422`);
    }

    const until = expires === null ? 'no expiry' : `expires ${new Date(expires).toISOString().slice(0, 10)}`;
    const passed = `${repo}: ${name} reads${writes ? ' and writes statuses' : ''} (${target.mode}, ${until})`;
    if (expires !== null && expires - now < EXPIRY_WARN_MS) {
        const days = Math.floor((expires - now) / (24 * 60 * 60 * 1000));
        return { passed, warning: `${repo}: ${name} expires in ${days} day(s), at ${new Date(expires).toISOString()}` };
    }
    return { passed };
}

/** Checks every repo's token in turn. Starts nothing and writes nothing. */
export async function preflight(
    run: CommandRunner,
    repos: readonly PreflightRepo[],
    githubTokens: LoopConfig['githubTokens'],
    env: Record<string, string | undefined>,
    now: number,
    probeWrites: (mode: Mode) => boolean = writesGitHub,
): Promise<Preflight> {
    const out: Preflight = { problems: [], warnings: [], passed: [] };
    for (const target of repos) {
        const outcome = await checkRepo(run, target, githubTokens, env, now, probeWrites);
        if ('problem' in outcome) {
            out.problems.push(outcome.problem);
            continue;
        }
        out.passed.push(outcome.passed);
        if (outcome.warning !== undefined) out.warnings.push(outcome.warning);
    }
    return out;
}
