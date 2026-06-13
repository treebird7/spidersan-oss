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
 * missed. We apply that lesson here so the resolve loop can't inherit the bug.
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
function stampAll(lines: string[], authorOf: (raw: string) => string | null): WakeEvent[] {
  const out: WakeEvent[] = [];
  for (let i = 0; i < lines.length; i++) {
    let tag;
    try { tag = parseLine(lines[i], i, 'lenient'); } catch { continue; }
    if (tag) out.push(toWakeEvent(tag, authorOf(lines[i])));
  }
  return out;
}

export interface WatchHandlers {
  /** Wake-worthy events from each new batch + the folded session. */
  onWake?(events: WakeEvent[], session: ResolveSession): void | Promise<void>;
  /** Every batch with new content, even if nothing woke (state still moved). */
  onTick?(session: ResolveSession): void | Promise<void>;
  /** Fired once when the loop ends (kill-switch, CLOSE, or stop()). */
  onEnd?(session: ResolveSession | undefined): void | Promise<void>;
}

/** Real lines seen — excludes the phantom trailing '' (see CURSOR NOTE). */
export function realLineCount(lines: string[]): number {
  return lines.length > 0 && lines[lines.length - 1] === '' ? lines.length - 1 : lines.length;
}

/**
 * One scan step (pure — no I/O, fully unit-testable). Given the full log and the
 * prior cursor: fold the whole log into a session, scan ONLY the lines past the
 * cursor for wakes, and return the events, session, and advanced cursor.
 */
export function step(
  lines: string[],
  cursor: number,
  opts: WatchOptions = {},
): { events: WakeEvent[]; session: ResolveSession; cursor: number } {
  const authorOf = opts.authorOf ?? flatAuthor;
  const session = ResolveSession.from(stampAll(lines, authorOf)); // parse-all (author-stamped) → fold
  const newLines = lines.slice(cursor);
  const events = scanForWake(newLines, cursor, {                  // wake-subset only
    selfAuthor: opts.selfAuthor,
    predicates: opts.predicates,
    state: session,                                               // §13.6 triggers read state
    authorOf,
  });
  return { events, session, cursor: realLineCount(lines) };
}

export interface WatchHandle {
  /** Stop the loop after the current tick. */
  stop(): void;
  /** Resolves when the loop ends (stop / ended / error). */
  done: Promise<void>;
}

/**
 * The corrwait tag-loop. Polls `source`, runs `step`, fires handlers, until
 * `source.ended()`, `session.isClosed` (a CLOSE tag), or `stop()`.
 */
export function watchResolve(
  source: ResolveSource,
  handlers: WatchHandlers,
  opts: WatchOptions = {},
  pollMs = 500,
): WatchHandle {
  let cursor = 0;
  let stopped = false;
  let lastSession: ResolveSession | undefined;

  const done = (async () => {
    while (!stopped) {
      if (source.ended && (await source.ended())) break;       // kill-switch
      const lines = await source.read();
      if (realLineCount(lines) > cursor) {
        const r = step(lines, cursor, opts);
        cursor = r.cursor;
        lastSession = r.session;
        if (handlers.onTick) await handlers.onTick(r.session);
        if (r.events.length && handlers.onWake) await handlers.onWake(r.events, r.session);
        if (r.session.isClosed) break;                         // a CLOSE tag ends the session
      }
      if (stopped) break;
      await sleep(pollMs);
    }
    if (handlers.onEnd) await handlers.onEnd(lastSession);
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
