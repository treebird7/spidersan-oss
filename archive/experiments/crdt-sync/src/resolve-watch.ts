/**
 * git-resolve resolve-watch — T6-b: the corrwait tag-loop integration
 *
 * Ties the two halves of "parse ≠ wake" together over a live `.resolve` log:
 *  - PARSE every new line → fold the full append-log into a ResolveSession (T3).
 *  - WAKE only on the wake-8 subset (or registered predicates) via scanForWake (T6-a).
 * Then fire the caller's handlers (e.g. Sangit's advise(), an agent's react()).
 *
 * It reuses corrwait's role — poll + per-agent cursor + no-self-echo + the `.end`
 * kill-switch — rather than reimplementing wake logic. The line source is
 * injectable: production wires it to a `.resolve` file (fileSource) or the
 * corrwait binary; tests pass a growing array. scanForWake supplies no-self-echo;
 * `ended()` is the human kill-switch (drop `<file>.end`, every loop halts).
 *
 * CURSOR NOTE: the cursor is the count of REAL lines seen, EXCLUDING the phantom
 * trailing '' that split('\n') yields for a newline-terminated file. Using the
 * raw array length would re-introduce the exact off-by-one fixed in treebird-chat
 * 0.3.7 — the first single appended line would land in the skipped slot and be
 * missed. `completeLineCount` generalises that guard: the final split element is
 * never a complete line (empty after a final '\n', OR a torn line caught
 * mid-write), so it is never folded until a newline terminates it (DRI #3).
 *
 * Grammar: spidersan-ai/collab/git-resolve-grammar.md. Reducer: resolve-session.ts.
 */

import { existsSync, readFileSync } from 'node:fs';
import { parseLine } from './parser';
import { scanForWake, toWakeEvent, flatAuthor, type WakeEvent, type WakePredicate } from './wake-scanner';
import { ResolveSession } from './resolve-session';

/** A source of append-log lines. Returns the FULL current log (the watcher owns
 *  the cursor). `ended()` is the optional kill-switch (corrwait `.end` sidecar). */
export interface ResolveSource {
  read(): string[] | Promise<string[]>;
  ended?(): boolean | Promise<boolean>;
}

export interface WatchOptions {
  /** This agent — tags it authored never wake it (no-self-echo). */
  selfAuthor?: string | null;
  /** Wake predicates; default [wake8Predicate]. Pass §13.6 triggers here. */
  predicates?: WakePredicate<ResolveSession>[];
  /** Transport-author extractor. Default: treebird-chat flat prefix. */
  authorOf?: (raw: string) => string | null;
}

/**
 * Parse every line and stamp the transport author onto each tag — the T6 → T3
 * seam. The reducer reads `event.author` for its §14.3 author≠from reject; feeding
 * it author-LESS events (bare parseLog) would make that enforcement silently skip
 * on every keyed mutation. So the watch loop stamps author on ALL events (not just
 * the wake subset) before folding. Non-tag lines and malformed tags are dropped.
 */
function stampAll(
  lines: string[],
  authorOf: (raw: string) => string | null,
  startIndex = 0,
): WakeEvent[] {
  const out: WakeEvent[] = [];
  for (let i = 0; i < lines.length; i++) {
    let tag;
    try { tag = parseLine(lines[i], startIndex + i, 'lenient'); } catch { continue; }
    if (tag) out.push(toWakeEvent(tag, authorOf(lines[i])));
  }
  return out;
}

export interface WatchHandlers {
  /** Wake-worthy events from each new batch + the folded session. */
  onWake?(events: WakeEvent[], session: ResolveSession): void | Promise<void>;
  /** Every batch with new content, even if nothing woke (state still moved). */
  onTick?(session: ResolveSession): void | Promise<void>;
  /** Fired once when the loop ends (kill-switch, CLOSE, or stop()). ALWAYS runs. */
  onEnd?(session: ResolveSession | undefined): void | Promise<void>;
  /**
   * Fired on a caught loop error (a `read()`/`step()`/handler throw). The loop
   * does NOT die — it backs off and retries. If omitted, errors are swallowed.
   */
  onError?(err: unknown, session: ResolveSession | undefined): void | Promise<void>;
}

/** Real lines seen — excludes the phantom trailing '' (see CURSOR NOTE). */
export function realLineCount(lines: string[]): number {
  return lines.length > 0 && lines[lines.length - 1] === '' ? lines.length - 1 : lines.length;
}

/**
 * Count of COMPLETE lines, given `read()` returns `split('\n')` output. The final
 * element of a split is never a complete line — it is the empty string after a
 * trailing `\n`, OR a partial line caught mid-write (a torn final tag). Either way
 * it is unsafe to fold until a newline terminates it, so complete lines are
 * everything before that final element. This supersedes the trailing-'' guard:
 * it also prevents folding a truncated tag (DRI fast-follow #3).
 */
export function completeLineCount(lines: string[]): number {
  return lines.length > 0 ? lines.length - 1 : 0;
}

/**
 * One scan step. Folds the complete lines into a session, scans only the complete
 * lines past `cursor` for wakes, returns events + session + advanced cursor.
 *
 * Pass `prev` (the session from the previous step) to fold INCREMENTALLY — only
 * the new tags are appended (O(new) instead of O(log) per tick, DRI fast-follow
 * #4). `prev.append(newTags)` is deterministically equal to a full re-fold (the
 * reducer guarantees re-fold determinism). Omit `prev` for a pure one-shot fold.
 */
export function step(
  lines: string[],
  cursor: number,
  opts: WatchOptions = {},
  prev?: ResolveSession,
): { events: WakeEvent[]; session: ResolveSession; cursor: number } {
  const authorOf = opts.authorOf ?? flatAuthor;
  const complete = completeLineCount(lines);
  const consumable = lines.slice(0, complete);          // drop the trailing ''/partial line (#3)
  const newLines = consumable.slice(cursor);
  const session = prev
    ? prev.append(stampAll(newLines, authorOf, cursor)) // incremental: append new tags only (#4)
    : ResolveSession.from(stampAll(consumable, authorOf));
  const events = scanForWake(newLines, cursor, {        // wake-subset only
    selfAuthor: opts.selfAuthor,
    predicates: opts.predicates,
    state: session,                                     // §13.6 triggers read state
    authorOf,
  });
  return { events, session, cursor: complete };
}

export interface WatchHandle {
  /** Stop the loop after the current tick. */
  stop(): void;
  /** ALWAYS resolves when the loop ends (stop / ended / CLOSE) — never rejects;
   *  loop errors are routed to `onError` and the loop retries with backoff. */
  done: Promise<void>;
}

export interface LoopOptions {
  /** Base poll interval (ms). Default 500. */
  pollMs?: number;
  /** Cap for the exponential read-error backoff (ms). Default 30_000. */
  maxBackoffMs?: number;
}

/**
 * The corrwait tag-loop. Polls `source`, runs `step` (incremental fold), fires
 * handlers, until `source.ended()`, a `CLOSE` tag (`session.isClosed`), or `stop()`.
 *
 * Robustness (DRI fast-follows):
 *  - #1 the loop body is wrapped so `onEnd` ALWAYS runs and `done` ALWAYS resolves
 *    — a throw can't leak an unhandledRejection or skip cleanup.
 *  - #2 a `read()`/`step()`/handler throw is caught, routed to `onError`, and the
 *    loop retries with exponential backoff instead of dying on one transient error.
 */
export function watchResolve(
  source: ResolveSource,
  handlers: WatchHandlers,
  opts: WatchOptions = {},
  loop: LoopOptions | number = {},
): WatchHandle {
  // Back-compat: a bare number was the old `pollMs` positional arg.
  const { pollMs = 500, maxBackoffMs = 30_000 } = typeof loop === 'number' ? { pollMs: loop } : loop;
  let cursor = 0;
  let stopped = false;
  let session: ResolveSession | undefined;

  const done = (async () => {
    let backoff = 0;
    try {
      while (!stopped) {
        try {
          if (source.ended && (await source.ended())) break;     // kill-switch
          const lines = await source.read();
          if (completeLineCount(lines) > cursor) {
            const r = step(lines, cursor, opts, session);        // incremental (#4)
            cursor = r.cursor;
            session = r.session;
            if (handlers.onTick) await handlers.onTick(r.session);
            if (r.events.length && handlers.onWake) await handlers.onWake(r.events, r.session);
            if (r.session.isClosed) break;                       // a CLOSE tag ends the session
          }
          backoff = 0;                                           // success → reset backoff
        } catch (err) {                                          // #2 transient error → retry
          if (handlers.onError) {
            try { await handlers.onError(err, session); } catch { /* never let onError kill the loop */ }
          }
          backoff = Math.min((backoff || pollMs) * 2, maxBackoffMs);
          if (stopped) break;
          await sleep(backoff);
          continue;
        }
        if (stopped) break;
        await sleep(pollMs);
      }
    } finally {
      // #1 cleanup always runs, whatever happened above.
      if (handlers.onEnd) {
        try { await handlers.onEnd(session); } catch { /* onEnd must not reject done */ }
      }
    }
  })();

  return { stop: () => { stopped = true; }, done };
}

/**
 * A `.resolve` file source. `read()` returns the file's lines; `ended()` mirrors
 * corrwait's kill-switch (`<file>.end` sidecar exists). This is the role corrwait
 * plays; a corrwait-binary-backed source can drop in with the same interface.
 */
export function fileSource(path: string): ResolveSource {
  return {
    read: () => (existsSync(path) ? readFileSync(path, 'utf8').split('\n') : []),
    ended: () => existsSync(`${path}.end`),
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((res) => setTimeout(res, ms));
}
