/**
 * PR coordinator — evidence readers (slice 2 of 4).
 *
 * Each reader is a pure function over input that was already fetched (text or
 * parsed JSON) and returns the `types.ts` shape the decision core reads. The
 * only I/O is `fetchConflicts`, through an injected command runner.
 *
 * Every reader returns a closed set. Input that is unrecognised, missing,
 * truncated or malformed is `null`, `ok: false`, `error`, `unverified`,
 * "not complete" or "touches protected paths" — never clean. A sha the caller
 * stamps must be a full 40-char lowercase sha, or the reader returns no
 * evidence instead of an object carrying it.
 *
 * Like the rest of this directory: Bun only, ES2022 only (no node or bun
 * imports), not part of the published npm package.
 */

import { isFullSha } from './decide';
import { CONFLICT_STATUSES, TRIAGE_MODELS, VARIANTS, VERDICTS } from './types';
import type {
    CiEvidence,
    ConflictsResult,
    Finding,
    OwnerApproval,
    PrSnapshot,
    ReviewRun,
    Triage,
    TriageModel,
    Variant,
    Verdict,
} from './types';

// ── Primitive checks ───────────────────────────────────────────────────────

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isText(value: unknown): value is string {
    return typeof value === 'string' && value.length > 0;
}

function isOneOf<T extends readonly string[]>(set: T, value: unknown): value is T[number] {
    return typeof value === 'string' && set.includes(value);
}

/** A PR number: a safe integer ≥ 1. */
export function isPrNumber(value: unknown): value is number {
    return typeof value === 'number' && Number.isSafeInteger(value) && value >= 1;
}

const REPO_SLUG = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

/** `owner/name`, nothing else. */
export function isRepoSlug(value: unknown): value is string {
    return typeof value === 'string' && REPO_SLUG.test(value);
}

const GIT_REF = /^[A-Za-z0-9][A-Za-z0-9._/-]*$/;

/** A ref safe to pass as one argv element: a full sha or a plain ref name. Never starts with `-`. */
export function isGitRef(value: unknown): value is string {
    return typeof value === 'string' && value.length <= 255 && GIT_REF.test(value) && !value.includes('..');
}

// ── 1. Review files → ReviewRun[] ──────────────────────────────────────────

/** One file from prsan's `reviews/` directory: its base name and its full text. */
export interface ReviewFile {
    name: string;
    text: string;
}

export interface ReviewContext {
    /** `owner/name` of the PR's repo. */
    repo: string;
    pr: number;
    /**
     * The header's `model:` value (the full provider/id prsan ran) → model
     * family. A model that is not an own key here is not a member of any set.
     */
    families: Readonly<Record<string, string>>;
}

export interface RejectedReviewFile {
    name: string;
    reason: string;
}

const PROVENANCE_OPEN = '<!-- prsan-provenance v1';
const PROVENANCE_KEYS = ['run_id', 'head_sha', 'model', 'variant', 'effort', 'prsan', 'pin'] as const;
/** prsan's run id: `r<UTC time>p<pid>`, plus `x<random>` after a name collision. No `-`. */
const RUN_ID = /^r\d{8}T\d{6}Zp\d+(x\d+)?$/;

type Provenance = Record<(typeof PROVENANCE_KEYS)[number], string>;

/** More header lines than this before `-->` is not a header. */
const PROVENANCE_MAX_LINES = 32;

/**
 * The runner-written header: only the block that starts at byte 0. Each line
 * up to the closing `-->` is `key: value`, no key twice, and every key prsan's
 * v1 header prints must be there. A key this reader does not know is allowed
 * and ignored (prsan adds keys). Returns the header and the lines under it,
 * or null.
 */
function readProvenance(text: string): { header: Provenance; body: string[] } | null {
    const lines = text.split('\n');
    if (lines[0] !== PROVENANCE_OPEN) return null;
    const fields = new Map<string, string>();
    let close = -1;
    for (let i = 1; i < lines.length && i <= PROVENANCE_MAX_LINES; i++) {
        const line = lines[i] ?? '';
        if (line === '-->') {
            close = i;
            break;
        }
        const m = /^([a-z_]+): (.+)$/.exec(line);
        if (m === null || m[1] === undefined || m[2] === undefined || fields.has(m[1])) return null;
        fields.set(m[1], m[2]);
    }
    if (close === -1) return null;
    const value = (key: (typeof PROVENANCE_KEYS)[number]): string => fields.get(key) ?? '';
    const header: Provenance = {
        run_id: value('run_id'),
        head_sha: value('head_sha'),
        model: value('model'),
        variant: value('variant'),
        effort: value('effort'),
        prsan: value('prsan'),
        pin: value('pin'),
    };
    if (PROVENANCE_KEYS.some((key) => header[key] === '')) return null;
    return { header, body: lines.slice(close + 1) };
}

const RISK_LEVEL = /^- \*\*Level\*\*: *(CRITICAL|HIGH|MEDIUM|LOW)[ \t]*$/;

/**
 * prsan's own completeness check (`review_defect`), run over everything under
 * the header: exactly one Risk section with a Level, then exactly one Blocking
 * defects section that holds a `### ` defect or starts with `None`, then
 * exactly one Verdict whose next line is exactly `**<VERDICT>**`. The findings
 * are the `### ` headings under Blocking defects, counted whether or not the
 * schema is valid. `review_defect`'s last rule, "a --second review never
 * APPROVEs", is left out: `decide` escalates that run (`second-approved`).
 */
function readSchema(body: readonly string[]): { verdict: Verdict | null; findings: number } {
    let risk = 0;
    let blk = 0;
    let ver = 0;
    let level = false;
    let hasBody = false;
    let first = false;
    let order = false;
    let findings = 0;
    let verdictLine: string | undefined;
    let sec = '';
    for (let i = 0; i < body.length; i++) {
        const line = body[i] ?? '';
        if (line.startsWith('## ')) sec = '';
        if (line.startsWith('## Risk')) {
            risk++;
            sec = 'risk';
        }
        if (line.startsWith('## Blocking defects')) {
            blk++;
            sec = 'blk';
            if (risk === 0) order = true;
            continue;
        }
        if (line.startsWith('## Verdict')) {
            ver++;
            verdictLine = body[i + 1];
            if (blk === 0) order = true;
        }
        if (sec === 'risk' && RISK_LEVEL.test(line)) level = true;
        if (sec === 'blk') {
            if (line.startsWith('### ')) {
                hasBody = true;
                findings++;
            }
            if (!first && line.trim() !== '') {
                first = true;
                if (line.startsWith('None')) hasBody = true;
            }
        }
    }
    const valid = ver === 1 && risk === 1 && level && blk === 1 && hasBody && !order;
    const word = verdictLine !== undefined && /^\*\*.+\*\*$/.test(verdictLine) ? verdictLine.slice(2, -2) : null;
    return { verdict: valid && isOneOf(VERDICTS, word) ? word : null, findings };
}

/**
 * Review files → the runs that are valid members, plus the files that are not
 * and why. A file is a run only when its provenance header is well-formed,
 * names a full head sha, a known variant and a model with a known family, and
 * the file's name is exactly the name prsan builds from those fields for this
 * repo and PR. Anything else is rejected, not emitted: it has no trusted sha
 * to file it under.
 *
 * `schemaValid` runs that fail the schema are still emitted (`verdict: null`),
 * with whatever findings they hold. Finding ids are `<runId>:<n>`. Duplicate
 * run ids are passed through; `decide` refuses that snapshot.
 */
export function readReviewFiles(
    files: unknown,
    context: ReviewContext,
): { runs: ReviewRun[]; rejected: RejectedReviewFile[] } {
    const runs: ReviewRun[] = [];
    const rejected: RejectedReviewFile[] = [];
    if (!Array.isArray(files)) return { runs, rejected: [{ name: '', reason: 'file list is not an array' }] };
    const contextOk =
        isRecord(context) && isRepoSlug(context.repo) && isPrNumber(context.pr) && isRecord(context.families);
    for (const file of files as readonly unknown[]) {
        const name = isRecord(file) && typeof file.name === 'string' ? file.name : '';
        const reject = (reason: string): void => {
            rejected.push({ name, reason });
        };
        if (!contextOk) {
            reject('repo, pr or family map is malformed');
            continue;
        }
        if (!isRecord(file) || !isText(file.name) || typeof file.text !== 'string') {
            reject('not a {name, text} file');
            continue;
        }
        const read = readProvenance(file.text);
        if (read === null) {
            reject('no runner-written provenance header at the start of the file');
            continue;
        }
        const { header, body } = read;
        if (!RUN_ID.test(header.run_id)) {
            reject('header run_id is not a prsan run id');
            continue;
        }
        if (!isFullSha(header.head_sha)) {
            reject('header head_sha is not a full 40-char sha');
            continue;
        }
        if (!isOneOf(VARIANTS, header.variant)) {
            reject('header variant is not a known variant');
            continue;
        }
        const family = Object.prototype.hasOwnProperty.call(context.families, header.model)
            ? context.families[header.model]
            : undefined;
        if (!isText(family)) {
            reject('header model has no configured family');
            continue;
        }
        const variant: Variant = header.variant;
        const modelBase = header.model.slice(header.model.lastIndexOf('/') + 1);
        const expectedName =
            `${context.repo.replace(/\//g, '_')}-${context.pr}-${header.head_sha.slice(0, 7)}` +
            `-${header.run_id}-${modelBase}${variant === 'plain' ? '' : `-${variant}`}.md`;
        if (file.name !== expectedName) {
            reject('file name disagrees with the header, the repo or the PR');
            continue;
        }
        const schema = readSchema(body);
        const blocking: Finding[] = [];
        for (let n = 1; n <= schema.findings; n++) blocking.push({ id: `${header.run_id}:${n}` });
        runs.push({
            runId: header.run_id,
            headSha: header.head_sha,
            family,
            variant,
            schemaValid: schema.verdict !== null,
            verdict: schema.verdict,
            blocking,
        });
    }
    return { runs, rejected };
}

// ── 2. Triage → Triage ─────────────────────────────────────────────────────

/** The efforts `bin/triage` accepts from its model. */
export const TRIAGE_EFFORTS = ['low', 'medium', 'high', 'xhigh'] as const;
/** The reason on the line triage prints when it failed. */
const TRIAGE_FALLBACK_REASON = 'triage failed — default';

/**
 * `bin/triage` stdout → a pick. `headSha` is the head the caller ran triage
 * at; it is never read from the output. Not a full sha → null (no evidence).
 * A pick is exactly one line `<model> <effort> <reason>` with a known model,
 * a known effort and a reason that is not the fallback's; all else is `ok: false`.
 */
export function parseTriage(stdout: unknown, headSha: unknown): Triage | null {
    if (!isFullSha(headSha)) return null;
    const failed: Triage = { ok: false, headSha };
    if (typeof stdout !== 'string') return failed;
    const line = stdout.endsWith('\n') ? stdout.slice(0, -1) : stdout;
    if (line.includes('\n') || line.includes('\r')) return failed;
    const m = /^(\S+) (\S+) (.+)$/.exec(line);
    if (m === null) return failed;
    const [, model, effort, reason] = m;
    if (!isOneOf(TRIAGE_MODELS, model) || !isOneOf(TRIAGE_EFFORTS, effort)) return failed;
    if (reason === undefined || reason.trim() === '' || reason.trim() === TRIAGE_FALLBACK_REASON) return failed;
    const picked: TriageModel = model;
    return { ok: true, headSha, model: picked, effort, reason };
}

// ── 3. CI → CiEvidence ─────────────────────────────────────────────────────

/** What one check run or commit status says, normalised by the caller. */
export const CI_STATES = ['success', 'failure', 'pending', 'skipped', 'neutral'] as const;

/** One required context and the GitHub App that must report it (branch protection's `{context, app_id}`). */
export interface RequiredContext {
    context: string;
    /** A real app id (> 0). "Any source" (-1) is not accepted. */
    appId: number;
}

/**
 * Already-fetched CI for one commit. How raw check-run and status payloads map
 * onto `observations` is the caller's (not in this slice).
 */
export interface CiInput {
    /** The commit the listing was fetched for. */
    headSha: unknown;
    /** `[{context, appId, headSha, state}]`: every check run and commit status on that commit. */
    observations: unknown;
    /** How many entries the source says exist; must equal `observations.length`. */
    expectedCount: unknown;
    /** `RequiredContext[]`, non-empty. */
    required: unknown;
    /** The coordinator's own merge-gate status context, dropped before judging; null = none. */
    gateContext: unknown;
    /** The merge commit the run tested, as `{baseParent, headParent}` full shas; null = not exposed. */
    testedMerge: unknown;
}

function isAppId(value: unknown): value is number {
    return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

/**
 * CI evidence for the commit the listing was fetched for (stamped as given, so
 * evidence for another head stays evidence for that head). Null when the input
 * cannot be read as evidence at all: no full sha, a malformed observation, or
 * an observation that names another commit.
 *
 * `complete`: the listing is whole, the required list is usable, nothing
 * reported is pending or in an unknown state, and every required context has at least one entry from
 * its expected app, all in the same state. `green`: complete, every such entry
 * is `success` (skipped and neutral are not), and every other reported entry
 * is success, skipped or neutral. A state outside `CI_STATES` is no verdict:
 * not complete. `green` implies `complete`.
 */
export function readCi(input: CiInput): CiEvidence | null {
    if (!isRecord(input) || !isFullSha(input.headSha) || !Array.isArray(input.observations)) return null;
    const headSha = input.headSha;
    const all: { context: string; appId: unknown; state: string }[] = [];
    for (const o of input.observations as readonly unknown[]) {
        if (!isRecord(o) || !isText(o.context) || typeof o.state !== 'string' || o.headSha !== headSha) return null;
        all.push({ context: o.context, appId: o.appId, state: o.state });
    }

    const merge = input.testedMerge;
    const testedBase =
        isRecord(merge) && merge.headParent === headSha && isFullSha(merge.baseParent) ? merge.baseParent : null;
    const evidence = (complete: boolean, green: boolean): CiEvidence => ({ headSha, complete, green, testedBase });

    if (input.expectedCount !== all.length) return evidence(false, false);
    if (input.gateContext !== null && !isText(input.gateContext)) return evidence(false, false);
    const required = input.required;
    if (!Array.isArray(required) || required.length === 0) return evidence(false, false);
    const seen = new Set<string>();
    for (const r of required as readonly unknown[]) {
        if (!isRecord(r) || !isText(r.context) || !isAppId(r.appId) || seen.has(r.context)) return evidence(false, false);
        if (r.context === input.gateContext) return evidence(false, false);
        seen.add(r.context);
    }

    const judged = all.filter((o) => o.context !== input.gateContext);
    let complete = !judged.some((o) => o.state === 'pending' || !isOneOf(CI_STATES, o.state));
    let green = judged.every((o) => o.state === 'success' || o.state === 'skipped' || o.state === 'neutral');
    for (const r of required as readonly RequiredContext[]) {
        const states = judged.filter((o) => o.context === r.context && o.appId === r.appId).map((o) => o.state);
        if (states.length === 0 || states.some((s) => s !== states[0])) complete = false;
        if (states.some((s) => s !== 'success')) green = false;
    }
    return evidence(complete, complete && green);
}

// ── 4. Conflicts → ConflictsResult ─────────────────────────────────────────

/** A conflicts result the reader could not trust: no verdict, no pr, no shas. */
const CONFLICTS_UNVERIFIED: ConflictsResult = { status: 'error', pr: null, headSha: null, baseSha: null };

/** `conflicts --real --exit-code`: the exit code each status must come with. */
const CONFLICTS_EXIT: Record<ConflictsResult['status'], number> = {
    clean: 0,
    incomplete: 0,
    conflict: 1,
    blocked: 1,
    error: 2,
};

/**
 * The `conflicts --pr N --real --json --exit-code` document → the checked
 * fields. `headSha` and `baseSha` come from the document's one result. Fails
 * closed to `error` with no pr and no shas when: stdout is not one JSON
 * object, the status is unknown, the exit code is not the one that status
 * exits with, or a verdict (clean, conflict, blocked) is not backed by exactly
 * one result for `refs/spidersan/pr-<pr>` that names both full shas and agrees
 * with the status. `incomplete` and `error` name no pr and no shas.
 *
 * Whether a clean result is for the right PR, head and base is `decide`'s
 * check (`conflictsClean`), not this function's.
 */
export function parseConflicts(stdout: unknown, exitCode: unknown): ConflictsResult {
    if (typeof stdout !== 'string') return CONFLICTS_UNVERIFIED;
    let doc: unknown;
    try {
        doc = JSON.parse(stdout);
    } catch {
        return CONFLICTS_UNVERIFIED;
    }
    if (!isRecord(doc) || !isOneOf(CONFLICT_STATUSES, doc.status)) return CONFLICTS_UNVERIFIED;
    const status = doc.status;
    if (exitCode !== CONFLICTS_EXIT[status]) return CONFLICTS_UNVERIFIED;
    if (!Array.isArray(doc.results) || !Array.isArray(doc.errors)) return CONFLICTS_UNVERIFIED;
    if (status === 'error') return CONFLICTS_UNVERIFIED;
    if (status === 'incomplete') return { status, pr: null, headSha: null, baseSha: null };

    const result: unknown = doc.results[0];
    if (!isPrNumber(doc.pr) || doc.errors.length !== 0 || doc.results.length !== 1 || !isRecord(result)) {
        return CONFLICTS_UNVERIFIED;
    }
    if (result.branch !== `refs/spidersan/pr-${doc.pr}` || result.error !== undefined) return CONFLICTS_UNVERIFIED;
    if (!isFullSha(result.headSha) || !isFullSha(result.baseSha)) return CONFLICTS_UNVERIFIED;
    const gateUnmet = isRecord(doc.gate) ? doc.gate.unmet : doc.gate === undefined ? false : null;
    const agrees =
        status === 'clean'
            ? result.clean === true && gateUnmet === false
            : status === 'conflict'
              ? result.clean === false
              : result.clean === true && gateUnmet === true;
    if (!agrees) return CONFLICTS_UNVERIFIED;
    return { status, pr: doc.pr, headSha: result.headSha, baseSha: result.baseSha };
}

export interface CommandResult {
    /** null = killed or never exited. */
    exitCode: number | null;
    stdout: string;
}

/** Runs one command from an argv array (never a shell string) in `cwd`. Injected; tests never shell out. */
export type CommandRunner = (
    command: string,
    argv: readonly string[],
    options: { cwd: string },
) => CommandResult | Promise<CommandResult>;

/** The argv for the conflicts check. `--base` is always passed: without it the command reads `.spidersanrc` from cwd. */
export function conflictsArgv(pr: number, base: string): string[] | null {
    if (!isPrNumber(pr) || !isGitRef(base)) return null;
    return ['conflicts', '--pr', String(pr), '--real', '--json', '--exit-code', '--base', base];
}

/**
 * Run the conflicts check through `run` and parse it. A bad PR number, base or
 * cwd is refused before anything runs; a runner that throws, or returns
 * something that is not a result, is `error`.
 */
export async function fetchConflicts(
    run: CommandRunner,
    request: { pr: number; base: string; cwd: string },
): Promise<ConflictsResult> {
    if (!isRecord(request) || !isText(request.cwd)) return CONFLICTS_UNVERIFIED;
    const argv = conflictsArgv(request.pr, request.base);
    if (argv === null) return CONFLICTS_UNVERIFIED;
    let result: unknown;
    try {
        result = await run('spidersan', argv, { cwd: request.cwd });
    } catch {
        return CONFLICTS_UNVERIFIED;
    }
    if (!isRecord(result)) return CONFLICTS_UNVERIFIED;
    return parseConflicts(result.stdout, result.exitCode);
}

// ── 5. Touches → PrSnapshot['touches'] ─────────────────────────────────────

/**
 * Path patterns: an exact path (`scripts/release.sh`), or a directory prefix
 * ending in `/` (`supabase/`). No globs. Matched without regard to case.
 */
export interface TouchPatterns {
    /** Trusted roots, the merge gate, the coordinator, its config. Must not be empty. */
    protectedPaths: readonly string[];
    /** Paths whose merge triggers an effect. May be empty. */
    mergeEffects: readonly string[];
}

export interface TouchesInput {
    /** The head the diff was computed at. */
    headSha: unknown;
    /** Every path the diff changes (for a rename, both the old and the new path). */
    files: unknown;
    /** How many paths the source says changed; must equal `files.length`. */
    expectedCount: unknown;
}

function isPattern(value: unknown): value is string {
    return isText(value) && !value.startsWith('/') && !/[*?[\]\\]/.test(value);
}

/**
 * A repo-relative path in normal form. A path git quoted (`"a/\303\251"`), or
 * one with a `.`, `..` or empty segment, a leading `/`, a backslash or a
 * control character, would not match a prefix it is really under.
 */
function isPlainPath(value: unknown): value is string {
    return (
        isText(value) &&
        !/["\\\x00-\x1f\x7f]/.test(value) &&
        value.split('/').every((segment) => segment !== '' && segment !== '.' && segment !== '..')
    );
}

/** Case-insensitive: on a case-insensitive checkout `Coordinator/x` is `coordinator/x`. */
function matches(patterns: readonly string[], file: string): boolean {
    const f = file.toLowerCase();
    return patterns.some((pattern) => {
        const p = pattern.toLowerCase();
        return p.endsWith('/') ? f.startsWith(p) : f === p;
    });
}

/**
 * Classify a changed-file list. Null when `headSha` is not a full sha. Both
 * flags are true (fail closed) when the list is not an array of non-empty, plain (unquoted, normalised)
 * paths, is empty, repeats a path, is not as long as `expectedCount`, or when a pattern list
 * is malformed or `protectedPaths` is empty.
 */
export function classifyTouches(input: TouchesInput, patterns: TouchPatterns): PrSnapshot['touches'] | null {
    if (!isRecord(input) || !isFullSha(input.headSha)) return null;
    const headSha = input.headSha;
    const closed = { headSha, protectedPaths: true, mergeEffects: true };
    if (!isRecord(patterns) || !Array.isArray(patterns.protectedPaths) || !Array.isArray(patterns.mergeEffects)) {
        return closed;
    }
    const protectedPaths: readonly unknown[] = patterns.protectedPaths;
    const mergeEffects: readonly unknown[] = patterns.mergeEffects;
    if (protectedPaths.length === 0 || !protectedPaths.every(isPattern) || !mergeEffects.every(isPattern)) return closed;
    const files: unknown = input.files;
    if (!Array.isArray(files) || files.length === 0 || files.length !== input.expectedCount) return closed;
    if (!files.every(isPlainPath) || new Set(files).size !== files.length) return closed;
    return {
        headSha,
        protectedPaths: files.some((f) => matches(protectedPaths, f)),
        mergeEffects: files.some((f) => matches(mergeEffects, f)),
    };
}

// ── 6. Owner approval and the registry row (source shapes unknown) ─────────

/**
 * What the caller proved about the owner's action on the escalation task. How
 * invoak exposes a server-stamped approver is not known yet (invk-fosip), so
 * no reader fetches this: until one does, the only honest value is `unverified`.
 */
export type ApprovalEvidence =
    | { proof: 'unverified' }
    | {
          /** The actor and action were stamped by the task store's server, not read from text. */
          proof: 'server-stamped';
          /** The principal the server recorded for the action. */
          actor: string;
          action: 'approve' | 'deny';
          /** The full head sha the escalation task is bound to. */
          taskHead: string;
      };

const UNVERIFIED_APPROVAL: OwnerApproval = { state: 'unverified', boundHead: null };

/**
 * Approved or denied only for a server-stamped action whose actor is exactly
 * `ownerPrincipal`, on a task bound to a full head sha. Everything else,
 * including any input shape not listed above, is `unverified` with no head.
 */
export function readOwnerApproval(evidence: unknown, ownerPrincipal: unknown): OwnerApproval {
    if (!isRecord(evidence) || evidence.proof !== 'server-stamped') return UNVERIFIED_APPROVAL;
    if (!isText(ownerPrincipal) || evidence.actor !== ownerPrincipal || !isFullSha(evidence.taskHead)) {
        return UNVERIFIED_APPROVAL;
    }
    if (evidence.action === 'approve') return { state: 'approved', boundHead: evidence.taskHead };
    if (evidence.action === 'deny') return { state: 'denied', boundHead: evidence.taskHead };
    return UNVERIFIED_APPROVAL;
}

/**
 * What the caller read from the branch registry. How an agent-tier principal
 * reads one row is not known yet (invk-fosip), so no reader fetches this.
 */
export type RegistryEvidence =
    | { proof: 'unverified' }
    | {
          /** One row, read from the registry itself as an agent-tier principal. */
          proof: 'registry-row';
          row: { repo: string; branch: string; registeredBy: string } | null;
      };

/**
 * `link.claimantRegisteredBranch`: true only for a registry row that names
 * exactly this repo, this branch and the task's claimant. Everything else is false.
 */
export function claimantRegisteredBranch(
    evidence: unknown,
    expected: { repo: string; branch: string; claimant: string },
): boolean {
    if (!isRecord(evidence) || evidence.proof !== 'registry-row' || !isRecord(evidence.row)) return false;
    if (!isRecord(expected) || !isText(expected.repo) || !isText(expected.branch) || !isText(expected.claimant)) {
        return false;
    }
    const row = evidence.row;
    return row.repo === expected.repo && row.branch === expected.branch && row.registeredBy === expected.claimant;
}
