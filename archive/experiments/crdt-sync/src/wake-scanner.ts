/**
 * git-resolve wake-scanner — T6 transport/corrwait seam
 *
 * The thin layer between the .resolve append-log and "who needs to wake".
 * It does NOT re-parse: it builds on parser.ts (`parseLine` → TagEvent) and adds
 * the one thing the parser can't know — the transport-authenticated author — then
 * applies pluggable wake-predicates over the same event stream.
 *
 * Design contract (consortium 2026-06-13):
 *  - PARSE ≠ WAKE. The parser tokenizes every tag; the scanner only *wakes* on
 *    tags that oblige another actor to act or move the state machine.
 *  - wake-8 is the normative default-on set (frozen for P0). The predicate
 *    registry stays OPEN so §13.6 ADVICE_TRIGGERS (Sangit) layer on without a
 *    scanner rewrite — they are just more predicates over the same stream.
 *  - No-self-echo: an agent never wakes on a tag it authored (reuses the exact
 *    property treebird-chat's corrwait gives for free; requires corrwait ≥0.3.7,
 *    whose cursor off-by-one fix this loop depends on).
 *  - @mention is not special — it is one built-in predicate. The tag-scanner IS
 *    treebird-chat's mention scanner generalised to a wake-predicate.
 *
 * Boundary: T6 owns line → WakeEvent + predicate dispatch. The from=/agent= vs
 * transport-author mismatch-reject (§14.3) and the events-log fold belong to the
 * T3 reducer (ResolveSession), which reads `author` + `fields.from` off WakeEvent.
 *
 * Grammar: spidersan-ai/collab/git-resolve-grammar.md (WakeEvent pinned in §15).
 */

import { parseLine, type TagEvent, type ParseMode } from './parser';

/** A parsed tag event plus its transport-authenticated author. */
export interface WakeEvent extends TagEvent {
  /**
   * Transport-authenticated sender (treebird-chat flat prefix `[HH:MM author]`,
   * or hive session id). `null` when the line carries no transport prefix (a raw
   * tag log). The reducer (T3) compares this against `fields.from`/`fields.agent`
   * for the §14.3 mismatch-reject — the scanner only carries it.
   */
  author: string | null;
}

/**
 * The 8 tag types whose arrival obliges another actor to act or advances the
 * session state machine. Normative for P0 — frozen by the index owner (artisan,
 * T6) + grammar owner (sasusan, T1) on 2026-06-13. Everything else parses but
 * does not wake until measured.
 */
export const WAKE_8 = [
  'SESSION', 'VOTE', 'GO', 'DONE', 'VERIFY', 'COLLISION', 'DECISION', 'CLOSE',
] as const;

const WAKE_8_SET: ReadonlySet<string> = new Set(WAKE_8);

/**
 * A wake-predicate over the event stream. Returns true = "this should wake me".
 * `state` is whatever the subscriber supplies (e.g. a ResolveSession for the
 * §13.6 triggers that read votes/phase); the built-in wake-8 predicate ignores it.
 */
export type WakePredicate<S = unknown> = (evt: WakeEvent, state: S) => boolean;

/** Built-in: the normative wake-8 set. The default predicate. */
export const wake8Predicate: WakePredicate = (evt) => WAKE_8_SET.has(evt.tagName);

/**
 * Built-in: wakes when the raw line @mentions `name`. Generalises treebird-chat's
 * mention scanner. Word-boundary guard so `@artisanbot` does not match `@artisan`.
 */
export function mentionsPredicate(name: string): WakePredicate {
  const re = new RegExp(`@${escapeRe(name)}(?![A-Za-z0-9_-])`, 'i');
  return (evt) => re.test(evt.raw);
}

/** Build a WakeEvent from a parsed TagEvent + its transport author. */
export function toWakeEvent(tag: TagEvent, author: string | null): WakeEvent {
  // Contract (spidersan #224 review): author is null, never "". An empty-string
  // author makes the T3 reducer skip its §14.3 mismatch-reject — so coerce ""→null
  // here, the single WakeEvent constructor, regardless of what authorOf returned.
  return { tagName: tag.tagName, fields: tag.fields, raw: tag.raw, lineIndex: tag.lineIndex, author: author || null };
}

/**
 * Default author extractor: the treebird-chat flat prefix `[HH:MM author]`
 * (optionally dated, optionally a `#N` parallel-hand suffix). Mirrors
 * treebird-chat's FLAT_RE author group. Returns null when there is no prefix.
 */
export function flatAuthor(raw: string): string | null {
  const m = raw.match(/^\[(?:\d{4}-\d{2}-\d{2} )?\d{2}:\d{2} ([^\]#]+?)(?:#\d+)?\]/);
  if (!m) return null;
  const a = m[1].trim();
  return a === '' ? null : a; // all-whitespace prefix → null, never "" (see toWakeEvent)
}

export interface ScanOptions<S = unknown> {
  /** This agent — tags it authored never wake it (no-self-echo). */
  selfAuthor?: string | null;
  /** Predicates; a line wakes if ANY returns true. Defaults to [wake8Predicate]. */
  predicates?: WakePredicate<S>[];
  /** State passed to predicates (for §13.6 triggers that read session state). */
  state?: S;
  /** Parser mode. Default 'lenient': a malformed tag mid-stream is skipped, not thrown. */
  mode?: ParseMode;
  /** Transport-author extractor. Default: treebird-chat flat prefix. */
  authorOf?: (raw: string) => string | null;
}

/**
 * Scan new append-log lines and return the WakeEvents that should wake the caller.
 *
 *  - Non-tag lines → skipped (parseLine returns null).
 *  - Self-authored tags → skipped (no-self-echo).
 *  - A tag wakes iff ANY predicate returns true.
 *
 * `startIndex` is the absolute index of `lines[0]` in the full log, so each
 * WakeEvent.lineIndex stays globally stable (it defines total order). In a
 * corrwait loop, pass the slice of new lines past the per-agent cursor and the
 * cursor value as startIndex.
 */
export function scanForWake<S = unknown>(
  lines: string[],
  startIndex: number,
  opts: ScanOptions<S> = {},
): WakeEvent[] {
  const predicates = opts.predicates ?? [wake8Predicate as WakePredicate<S>];
  const authorOf = opts.authorOf ?? flatAuthor;
  const mode: ParseMode = opts.mode ?? 'lenient';
  const state = opts.state as S;
  const woke: WakeEvent[] = [];

  for (let i = 0; i < lines.length; i++) {
    let tag: TagEvent | null;
    try {
      tag = parseLine(lines[i], startIndex + i, mode);
    } catch {
      // lenient: a single malformed tag must not kill the wake loop.
      continue;
    }
    if (tag === null) continue;

    const author = authorOf(lines[i]) || null; // normalize ""→null before any comparison
    if (opts.selfAuthor != null && author != null && author === opts.selfAuthor) {
      continue; // no-self-echo
    }

    const evt = toWakeEvent(tag, author);
    if (predicates.some((p) => p(evt, state))) woke.push(evt);
  }
  return woke;
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
