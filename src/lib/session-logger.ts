/**
 * Session Logger — captures raw spidersan ask/advise/explain sessions for training.
 *
 * Writes to ~/.spidersan/sessions/YYYY-MM-DD.jsonl (one JSON object per line).
 * Each entry is a raw session: context + result + outcome.
 *
 * Outcome is what makes this a gold pair. Without it we just have questions.
 * Outcome is captured inline (TTY prompt after response) or left null.
 *
 * Anonymization + gold pair transformation happens at `watsan index-pair` time,
 * not here. This logger stores raw data locally — nothing leaves the machine.
 *
 * Design:
 *   - Never throws — session logging must not crash spidersan ask
 *   - Append-only JSONL — safe for concurrent writes, easy to process
 *   - File per day — easy to hand to watsan for a given date range
 */

import { appendFileSync, readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { randomUUID } from 'crypto';
import type { Interface as ReadlineInterface } from 'readline';
import type { SpiderContext } from './ai/types.js';
import type { ReasoningResult, ReasoningMode } from './ai/index.js';

// ─── Types ────────────────────────────────────────────────────

export type SessionOutcome =
  | 'followed'            // acted on the advice as given
  | 'ignored'             // saw it, didn't act
  | `modified:${string}`  // followed with changes — string is a brief description
  | null;                 // not yet captured

export interface RawSession {
  session_id: string;     // opaque UUID — never derived from branch name
  logged_at: string;      // ISO timestamp
  mode: ReasoningMode;
  question?: string;      // ask mode
  branch?: string;        // explain mode — raw name, anonymized by watsan later
  context: SpiderContext;
  result: ReasoningResult;
  outcome: SessionOutcome;
  outcome_captured_at: string | null;
}

// ─── Paths ────────────────────────────────────────────────────

function sessionsDir(): string {
  return join(homedir(), '.spidersan', 'sessions');
}

function dateFile(offsetDays = 0): string {
  const d = new Date(Date.now() - offsetDays * 86_400_000);
  const ymd = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return join(sessionsDir(), `${ymd}.jsonl`);
}

function ensureDir(): void {
  const dir = sessionsDir();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 });
}

// ─── Write ────────────────────────────────────────────────────

/**
 * Append a session entry to today's log file.
 * Returns the session_id so the caller can later capture the outcome.
 * Never throws.
 */
export function logSession(
  mode: ReasoningMode,
  context: SpiderContext,
  result: ReasoningResult,
  opts?: { question?: string; branch?: string },
): string {
  const session_id = randomUUID();
  try {
    ensureDir();
    const entry: RawSession = {
      session_id,
      logged_at: new Date().toISOString(),
      mode,
      question: opts?.question,
      branch: opts?.branch,
      context,
      result,
      outcome: null,
      outcome_captured_at: null,
    };
    appendFileSync(dateFile(), JSON.stringify(entry) + '\n', { encoding: 'utf-8' });
  } catch {
    // Silent — logging must never crash the main command
  }
  return session_id;
}

/**
 * Update the outcome for a previously logged session.
 * Checks today's and yesterday's log files.
 * Never throws.
 */
export function captureOutcome(session_id: string, outcome: SessionOutcome): void {
  try {
    const now = new Date().toISOString();
    // Check today and yesterday (covers sessions that started near midnight)
    for (const filePath of [dateFile(0), dateFile(1)]) {
      if (!existsSync(filePath)) continue;
      const lines = readFileSync(filePath, 'utf-8').split('\n').filter(Boolean);
      const idx = lines.findIndex(line => {
        try { return (JSON.parse(line) as RawSession).session_id === session_id; }
        catch { return false; }
      });
      if (idx === -1) continue;

      const entry = JSON.parse(lines[idx]!) as RawSession;
      entry.outcome = outcome;
      entry.outcome_captured_at = now;
      lines[idx] = JSON.stringify(entry);
      writeFileSync(filePath, lines.join('\n') + '\n', { encoding: 'utf-8' });
      return;
    }
  } catch {
    // Silent
  }
}

// ─── Inline outcome prompt ────────────────────────────────────

/**
 * Show a brief outcome prompt after a response (TTY only).
 * Non-blocking: skips if stdin is not a TTY or SPIDERSAN_NO_OUTCOME_PROMPT=1.
 * Returns the captured outcome (or null if skipped).
 */
export async function promptOutcome(
  session_id: string,
  rl: ReadlineInterface,
): Promise<SessionOutcome> {
  if (!process.stdin.isTTY || process.env['SPIDERSAN_NO_OUTCOME_PROMPT'] === '1') {
    return null;
  }

  return new Promise((resolve) => {
    process.stdout.write('\x1b[2m  Follow this advice? [y/n/m=modified, Enter to skip] \x1b[0m');

    rl.once('line', (answer: string) => {
      const a = answer.trim().toLowerCase();

      if (a === 'y' || a === 'yes') {
        captureOutcome(session_id, 'followed');
        resolve('followed');
      } else if (a === 'n' || a === 'no') {
        captureOutcome(session_id, 'ignored');
        resolve('ignored');
      } else if (a.startsWith('m')) {
        process.stdout.write('\x1b[2m  What changed? (one line) \x1b[0m');
        rl.once('line', (desc: string) => {
          const outcome: SessionOutcome = `modified:${desc.trim().slice(0, 200)}`;
          captureOutcome(session_id, outcome);
          resolve(outcome);
        });
      } else {
        // Enter / anything else → skip
        resolve(null);
      }
    });
  });
}
