/// <reference types="node" />
/**
 * PR coordinator — invoak: notes and escalations (slice 4 of 4, part 2b).
 *
 * The four effects that live in invoak, through the `invoak` CLI and an
 * injected `CommandRunner`:
 *
 *   deliverNote       `invoak comment <task> <body>`; the receipt is the comment id.
 *   findDelivery      `invoak show <task>`: a comment by this coordinator whose
 *                     body carries the action id. `show` returns every comment.
 *   createEscalation  `invoak create --legacy-id <id derived from the action id>`.
 *                     invoak keeps legacy ids unique, so a second create for the
 *                     same action is refused by the server, not by a search.
 *   findEscalation    `invoak show <that legacy id>`.
 *
 * Fail closed: `absent` is answered only on invoak's own NOT_FOUND, or on a
 * task that was read whole and holds no such comment. Everything else that is
 * not a clean answer is `unknown`, and the intent stays pending.
 *
 * Not here (invk-fosip, unanswered): who approved a task, and registry rows.
 */

import { createHash } from 'node:crypto';
import type { EscalationRequest, Lookup, NoteRequest, SendOutcome } from './effects';
import type { CommandRunner } from './readers';

const UNKNOWN = { kind: 'unknown' } as const;
const ABSENT = { kind: 'absent' } as const;

const TASK_ID = /^[a-z0-9]{2,12}-[a-z0-9][a-z0-9-]{0,80}$/;
const PRINCIPAL = /^[a-z0-9][a-z0-9-]{0,62}$/;
const PROJECT = /^[a-z0-9]{2,12}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** One argv element the CLI cannot take for a flag, and that holds no NUL. */
function isArgText(value: unknown): value is string {
    return typeof value === 'string' && value !== '' && !value.startsWith('-') && !value.includes('\0');
}

/**
 * Does `body` carry this action id on a line of its own? A substring match
 * would not do: `…:1` is the start of `…:10`.
 */
function carries(body: string, actionId: string): boolean {
    return body.split('\n').some((line) => line.trimEnd() === `action-id: ${actionId}`);
}

/** The legacy id of the escalation task for one action: the same action always gives the same id. */
export function escalationId(project: string, actionId: string): string {
    return `${project}-esc-${createHash('sha256').update(actionId).digest('hex').slice(0, 32)}`;
}

export interface InvoakOptions {
    /** This coordinator's invoak principal: only its own comments count as deliveries. */
    self: string;
    /** The project escalation tasks are created in. */
    project: string;
    /** The owner principal. An escalation to the owner waits for human dispatch and is addressed to nobody. */
    owner: string;
}

export class Invoak {
    readonly #run: CommandRunner;
    readonly #options: InvoakOptions;

    constructor(run: CommandRunner, options: InvoakOptions) {
        if (!PRINCIPAL.test(options.self) || !PRINCIPAL.test(options.owner) || !PROJECT.test(options.project)) {
            throw new TypeError('coordinator: invalid invoak options');
        }
        this.#run = run;
        this.#options = { ...options };
    }

    /** The JSON document a command printed, with its exit code; undefined when there is none to read. */
    async #invoak(argv: readonly string[]): Promise<{ ok: boolean; doc: Record<string, unknown> } | undefined> {
        try {
            const result: unknown = await this.#run('invoak', [...argv, '--json'], { cwd: '/' });
            if (!isRecord(result) || typeof result.stdout !== 'string') return undefined;
            const doc: unknown = JSON.parse(result.stdout);
            return isRecord(doc) ? { ok: result.exitCode === 0, doc } : undefined;
        } catch {
            return undefined;
        }
    }

    /** `show <id>`: the answer, `absent` on invoak's NOT_FOUND, else undefined. */
    async #show(id: string): Promise<Record<string, unknown> | 'absent' | undefined> {
        const answer = await this.#invoak(['show', id]);
        if (answer === undefined) return undefined;
        if (answer.ok) return isRecord(answer.doc.task) ? answer.doc : undefined;
        return isRecord(answer.doc.error) && answer.doc.error.code === 'NOT_FOUND' ? 'absent' : undefined;
    }

    async findDelivery(query: { taskId: string; actionId: string }): Promise<Lookup> {
        if (!isRecord(query) || !TASK_ID.test(String(query.taskId)) || !isArgText(query.actionId)) return UNKNOWN;
        const shown = await this.#show(query.taskId);
        // A note is only ever sent to a task that exists: a missing task is not "not delivered yet".
        if (shown === undefined || shown === 'absent' || !Array.isArray(shown.comments)) return UNKNOWN;
        const receipts: string[] = [];
        for (const comment of shown.comments as readonly unknown[]) {
            if (!isRecord(comment) || typeof comment.body !== 'string' || typeof comment.author !== 'string')
                return UNKNOWN;
            if (comment.author !== this.#options.self || !carries(comment.body, query.actionId)) continue;
            if (typeof comment.id !== 'string' || comment.id === '') return UNKNOWN;
            receipts.push(comment.id);
        }
        const first = receipts[0];
        return first === undefined ? ABSENT : { kind: 'found', receipt: first };
    }

    async deliverNote(request: NoteRequest): Promise<SendOutcome> {
        if (!isRecord(request) || !TASK_ID.test(String(request.taskId)) || !isArgText(request.body)) return UNKNOWN;
        if (!isArgText(request.actionId) || !carries(request.body, request.actionId)) return UNKNOWN;
        const answer = await this.#invoak(['comment', request.taskId, request.body]);
        const comment = answer?.ok === true ? answer.doc.comment : undefined;
        if (!isRecord(comment) || typeof comment.id !== 'string' || comment.id === '') return UNKNOWN;
        return { kind: 'sent', receipt: comment.id };
    }

    async findEscalation(query: { actionId: string }): Promise<Lookup> {
        if (!isRecord(query) || !isArgText(query.actionId)) return UNKNOWN;
        const legacy = escalationId(this.#options.project, query.actionId);
        const shown = await this.#show(legacy);
        if (shown === undefined) return UNKNOWN;
        if (shown === 'absent') return ABSENT;
        const task = shown.task;
        if (!isRecord(task) || task.legacyId !== legacy || typeof task.id !== 'string' || task.id === '')
            return UNKNOWN;
        return { kind: 'found', receipt: task.id };
    }

    async createEscalation(request: EscalationRequest): Promise<SendOutcome> {
        if (!isRecord(request) || !isArgText(request.actionId) || !isArgText(request.body)) return UNKNOWN;
        if (!carries(request.body, request.actionId)) return UNKNOWN;
        if (!isArgText(request.reason) || !Number.isSafeInteger(request.pr) || !isArgText(request.repo)) return UNKNOWN;
        if (typeof request.to !== 'string' || !PRINCIPAL.test(request.to)) return UNKNOWN;
        const { project, owner } = this.#options;
        const legacy = escalationId(project, request.actionId);
        const summary = `Coordinator escalation: ${request.repo}#${request.pr} ${request.reason}`;
        const route = request.to === owner ? ['--needs-approval'] : ['--for', `@${request.to}`];
        const answer = await this.#invoak([
            'create',
            '--project',
            project,
            '--summary',
            summary,
            '--description',
            request.body,
            '--legacy-id',
            legacy,
            ...route,
        ]);
        const task = answer?.ok === true ? answer.doc.task : undefined;
        if (!isRecord(task) || task.legacyId !== legacy || typeof task.id !== 'string' || task.id === '')
            return UNKNOWN;
        return { kind: 'sent', receipt: task.id };
    }
}
