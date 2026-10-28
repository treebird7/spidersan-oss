/**
 * Regression tests for resolve-watch.ts (T6-b: the corrwait tag-loop integration).
 *
 * Covers the integration contract: parse-all → fold (reducer) + wake-subset
 * (scanForWake), the T6→T3 author-stamping seam (so §14.3 spoof-reject fires over
 * a live log), the trailing-empty cursor guard (the 0.3.7 off-by-one applied to
 * the resolve loop), the live watch loop (stop / ended / CLOSE), and fileSource.
 *
 * Run: npx tsx src/resolve-watch.test.ts
 * (No framework — throws on failure, exits 0 on pass; same as parser.test.ts.)
 */

import { mkdtempSync, writeFileSync, appendFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { step, watchResolve, realLineCount, fileSource, type ResolveSource } from './resolve-watch';
import { wake8Predicate, type WakeEvent } from './wake-scanner';
import type { ResolveSession } from './resolve-session';

let passed = 0, failed = 0;
function check(name: string, cond: boolean): void {
  if (cond) { passed++; console.log(`  ✅ ${name}`); }
  else { failed++; console.log(`  ❌ ${name}`); }
}
function eq<T>(name: string, got: T, want: T): void { check(`${name} (got ${JSON.stringify(got)})`, got === want); }
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// A flat-wrapped tag line as in a .resolve log.
const L = (author: string, tag: string) => `[15:00 ${author}] ${tag}`;

async function main() {
  // ── realLineCount: trailing empty excluded ────────────────────────────────
  console.log('\nrealLineCount (trailing-empty guard):');
  eq('newline-terminated excludes phantom empty', realLineCount(['a', 'b', '']), 2);
  eq('no trailing newline counts all', realLineCount(['a', 'b']), 2);
  eq('empty log', realLineCount(['']), 0);

  // ── step: parse-all folds; wake only on new lines past cursor ──────────────
  console.log('\nstep — parse-all fold + wake-subset:');
  {
    const lines = [
      L('human', '[SESSION id=s1 repo=r incident=merge-order opened_by=human extra=""]'),
      L('spidersan', '[VOTE agent=spidersan action=merge confidence=high extra=""]'),
      '', // trailing empty
    ];
    // cursor=2 → everything before is "seen"; nothing new past it
    const r0 = step(lines, 2);
    eq('session folded all (vote present though not re-woken)', r0.session.votes.get('spidersan')?.action, 'merge');
    eq('no wake — all lines were before the cursor', r0.events.length, 0);
    eq('cursor advanced to realLineCount (2, not 3)', r0.cursor, 2);
    // now a fresh GO arrives at index 2 (the empty becomes the GO, new trailing empty at 3)
    const lines2 = [lines[0], lines[1], L('human', '[GO from=human session=s1 step=1 extra=""]'), ''];
    const r1 = step(lines2, 2); // cursor from r0
    eq('the new GO wakes', r1.events.length, 1);
    eq('woken tag is GO', r1.events[0].tagName, 'GO');
    eq('cursor now 3', r1.cursor, 3);
  }

  // ── THE integration test: T6 author-stamping makes T3 §14.3 reject fire ────
  console.log('\nT6→T3 author-stamping seam (§14.3 over a live log):');
  {
    // transport author (flat prefix) = mallory, tag claims agent=spidersan → spoof
    const spoof = step([L('mallory', '[VOTE agent=spidersan action=merge confidence=high extra=""]'), ''], 0);
    eq('reducer REJECTS the spoofed vote (author≠agent)', spoof.session.votes.size, 0);
    eq('but the scanner still WAKES on it (wake≠apply)', spoof.events.length, 1);
    // honest: transport author == agent → applied
    const honest = step([L('spidersan', '[VOTE agent=spidersan action=merge confidence=high extra=""]'), ''], 0);
    eq('honest vote applied (author==agent)', honest.session.votes.get('spidersan')?.action, 'merge');
  }

  // ── step: no-self-echo ─────────────────────────────────────────────────────
  console.log('\nstep — no-self-echo:');
  {
    const lines = [L('artisan', '[VOTE agent=artisan action=merge confidence=high extra=""]'),
                   L('bob', '[GO from=bob session=s1 step=1 extra=""]'), ''];
    const r = step(lines, 0, { selfAuthor: 'artisan' });
    eq('self VOTE filtered from wakes, bob GO kept', r.events.length, 1);
    eq('survivor is bob GO', r.events[0].author, 'bob');
  }

  // ── step: predicates read the folded session state (§13.6-style) ───────────
  console.log('\nstep — predicate reads session state:');
  {
    // wake on VOTE only when the session already has >=1 vote (quorum-ish)
    const pred = (e: WakeEvent, s: ResolveSession) => e.tagName === 'VOTE' && s.votes.size >= 1;
    const lines = [L('spidersan', '[VOTE agent=spidersan action=merge confidence=high extra=""]'), ''];
    const r = step(lines, 0, { predicates: [pred] });
    eq('predicate sees session.votes after the fold', r.events.length, 1);
  }

  // ── watchResolve: live loop over a growing array source ────────────────────
  console.log('\nwatchResolve — live loop:');
  {
    let lines: string[] = [L('human', '[SESSION id=s repo=r incident=merge-order opened_by=human extra=""]'), ''];
    const source: ResolveSource = { read: () => lines };
    const woke: WakeEvent[] = [];
    const h = watchResolve(source, { onWake: (evs) => { woke.push(...evs); } }, { predicates: [wake8Predicate] }, 20);
    await sleep(50);
    lines = [lines[0], L('bob', '[GO from=bob session=s step=1 extra=""]'), '']; // append a GO
    await sleep(60);
    h.stop();
    await h.done;
    check('loop woke on the GO appended mid-flight', woke.some((e) => e.tagName === 'GO'));
    eq('SESSION did not double-wake after stop', woke.filter((e) => e.tagName === 'GO').length, 1);
  }

  // ── watchResolve: a CLOSE tag ends the session ─────────────────────────────
  console.log('\nwatchResolve — CLOSE ends the loop:');
  {
    const lines = [L('human', '[SESSION id=s repo=r incident=merge-order opened_by=human extra=""]'),
                   L('human', '[CLOSE session=s outcome=resolved by=human extra=""]'), ''];
    let ended = false;
    const h = watchResolve({ read: () => lines }, { onEnd: () => { ended = true; } }, {}, 20);
    await h.done; // should resolve on its own (isClosed) without stop()
    check('loop self-terminated on CLOSE', ended);
  }

  // ── watchResolve: kill-switch via ended() ──────────────────────────────────
  console.log('\nwatchResolve — kill-switch:');
  {
    let kill = false;
    const h = watchResolve({ read: () => [L('a', '[VOTE agent=a action=x confidence=low extra=""]'), ''], ended: () => kill }, {}, {}, 20);
    await sleep(40);
    kill = true;
    await h.done;
    check('loop halted when ended() went true', true); // reaching here means done resolved
  }

  // ── fileSource: real .resolve file + .end sidecar ──────────────────────────
  console.log('\nfileSource — fs-backed:');
  {
    const dir = mkdtempSync(join(tmpdir(), 'resolve-watch-'));
    const f = join(dir, 'session.resolve');
    writeFileSync(f, L('human', '[SESSION id=s repo=r incident=merge-order opened_by=human extra=""]') + '\n');
    const src = fileSource(f);
    eq('reads the SESSION line', (await src.read()).some((l) => l.includes('[SESSION')), true);
    eq('not ended yet', await src.ended!(), false);
    appendFileSync(f, L('bob', '[GO from=bob session=s step=1 extra=""]') + '\n');
    eq('sees the appended GO', (await src.read()).some((l) => l.includes('[GO')), true);
    writeFileSync(`${f}.end`, '');
    eq('ended() true once .end exists', await src.ended!(), true);
    rmSync(dir, { recursive: true, force: true });
  }

  // ── #3 partial-line guard: a torn final tag is NOT folded until completed ──
  console.log('\n#3 partial-line guard:');
  {
    // mid-write: the final line has no trailing newline → it is incomplete.
    const torn = [L('human', '[SESSION id=s repo=r incident=merge-order opened_by=human extra=""]'),
                  '[VOTE agent=spi'];            // torn — no closing fields, no newline
    const r = step(torn, 0);
    eq('torn final line is NOT consumed (no vote folded)', r.session.votes.size, 0);
    eq('cursor stops before the partial line', r.cursor, 1);
    // once the writer finishes the line (trailing '' appears), it folds.
    const whole = [torn[0], L('spidersan', '[VOTE agent=spidersan action=merge confidence=high extra=""]'), ''];
    const r2 = step(whole, r.cursor);
    eq('completed line now folds the vote', r2.session.votes.get('spidersan')?.action, 'merge');
  }

  // ── #4 incremental fold == full re-fold (determinism) ──────────────────────
  console.log('\n#4 incremental fold == full re-fold:');
  {
    const lines = [
      L('human', '[SESSION id=s repo=r incident=merge-order opened_by=human extra=""]'),
      L('spidersan', '[VOTE agent=spidersan action=merge confidence=high extra=""]'),
      L('mycsan', '[VERIFY n=1 agent=mycsan checks="x" result=pass extra=""]'), '',
    ];
    const full = step(lines, 0);                          // one-shot full fold
    // incremental: fold line-by-line, threading prev session through
    let prev = step([lines[0], ''], 0).session;
    prev = step([lines[0], lines[1], ''], 1, {}, prev).session;
    const incr = step(lines, 2, {}, prev);
    eq('same votes', incr.session.votes.get('spidersan')?.action, full.session.votes.get('spidersan')?.action);
    eq('same verify count', incr.session.verifications.length, full.session.verifications.length);
    eq('same final cursor', incr.cursor, full.cursor);
  }

  // ── #1 onEnd ALWAYS runs + done RESOLVES even when a handler throws ─────────
  console.log('\n#1 cleanup contract (error never leaks):');
  {
    let ended = false; let errored = false;
    const h = watchResolve(
      { read: () => [L('bob', '[GO from=bob session=s step=1 extra=""]'), ''] },
      {
        onWake: () => { throw new Error('boom in onWake'); },   // handler throws
        onError: () => { errored = true; },
        onEnd: () => { ended = true; },
      },
      {}, { pollMs: 10 },
    );
    await sleep(40);
    h.stop();
    await h.done;                                                // must RESOLVE, not reject
    check('onError fired on the handler throw', errored);
    check('onEnd ran despite the throw (cleanup contract)', ended);
  }

  // ── #2 transient read() error → backoff + recovery, loop survives ──────────
  console.log('\n#2 backoff recovery:');
  {
    let reads = 0;
    const source: ResolveSource = {
      read: () => {
        reads++;
        if (reads === 1) throw new Error('transient read fail');  // first read throws
        return [L('bob', '[GO from=bob session=s step=1 extra=""]'), ''];
      },
    };
    const woke: WakeEvent[] = [];
    let errs = 0;
    const h = watchResolve(source, { onWake: (e) => { woke.push(...e); }, onError: () => { errs++; } },
      { predicates: [wake8Predicate] }, { pollMs: 10, maxBackoffMs: 30 });
    await sleep(80);
    h.stop();
    await h.done;
    check('the transient error was reported', errs >= 1);
    check('loop survived and still woke on the GO after recovery', woke.some((e) => e.tagName === 'GO'));
  }

  console.log('\n' + '─'.repeat(50));
  console.log(`Results: ${passed} passed, ${failed} failed`);
  if (failed > 0) { console.log('Some tests FAILED ❌'); process.exit(1); }
  console.log('All resolve-watch tests passed ✅');
}

main().catch((e) => { console.error(e); process.exit(1); });
