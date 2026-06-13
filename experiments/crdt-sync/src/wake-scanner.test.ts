/**
 * Regression tests for wake-scanner.ts (T6 transport/corrwait seam).
 *
 * Covers the P0 contract: parse≠wake, the normative wake-8 set, no-self-echo,
 * pluggable predicate registry (the open registry that lets §13.6 triggers layer
 * on), the @mention built-in, author extraction, and lenient malformed-tag skip.
 *
 * Run: npx ts-node src/wake-scanner.test.ts
 * (No framework — throws on failure, exits 0 on pass; same as parser.test.ts.)
 */

import {
  scanForWake,
  wake8Predicate,
  mentionsPredicate,
  toWakeEvent,
  flatAuthor,
  WAKE_8,
  type WakeEvent,
  type WakePredicate,
} from './wake-scanner';
import { parseLine } from './parser';

let passed = 0;
let failed = 0;
function check(name: string, cond: boolean): void {
  if (cond) { passed++; console.log(`  ✅ ${name}`); }
  else { failed++; console.log(`  ❌ ${name}`); }
}
function eq<T>(name: string, got: T, want: T): void {
  check(`${name} (got ${JSON.stringify(got)})`, got === want);
}

// A flat-wrapped tag line as it appears in the .resolve log.
const line = (author: string, tag: string) => `[15:00 ${author}] ${tag}`;

// ── wake-8: each of the 8 wakes; STEP/JOIN/LEAVE/ADVICE do not ──────────────
{
  console.log('\nwake-8 membership:');
  for (const t of WAKE_8) {
    const woke = scanForWake([line('alice', `[${t} x=1]`)], 0);
    eq(`${t} wakes`, woke.length, 1);
  }
  for (const t of ['STEP', 'JOIN', 'LEAVE', 'ADVICE', 'WIP', 'EVIDENCE']) {
    const woke = scanForWake([line('alice', `[${t} x=1]`)], 0);
    eq(`${t} does NOT wake (parse≠wake)`, woke.length, 0);
  }
}

// ── non-tag lines are skipped ───────────────────────────────────────────────
{
  console.log('\nnon-tag lines:');
  const woke = scanForWake([line('alice', 'just some prose, no tag'), '', line('bob', '[GO from=bob]')], 0);
  eq('only the GO tag wakes; prose + blank skipped', woke.length, 1);
  eq('the woken tag is GO', woke[0].tagName, 'GO');
}

// ── no-self-echo: my own authored tag never wakes me ────────────────────────
{
  console.log('\nno-self-echo:');
  const lines = [line('artisan', '[VOTE agent=artisan action=merge]'), line('bob', '[GO from=bob]')];
  const woke = scanForWake(lines, 0, { selfAuthor: 'artisan' });
  eq('self VOTE filtered, bob GO kept', woke.length, 1);
  eq('survivor is bob GO', woke[0].author, 'bob');
  // without selfAuthor, both wake
  eq('without selfAuthor both wake', scanForWake(lines, 0).length, 2);
}

// ── lineIndex is globally stable via startIndex ─────────────────────────────
{
  console.log('\nglobal line order:');
  const woke = scanForWake([line('bob', '[GO from=bob]')], 42);
  eq('lineIndex offset by startIndex', woke[0].lineIndex, 42);
}

// ── @mention predicate (generalised treebird-chat scanner) ──────────────────
{
  console.log('\n@mention predicate:');
  const preds = [mentionsPredicate('artisan')];
  // An ADVICE tag normally does NOT wake (not in wake-8), but @mention should.
  eq('@artisan wakes even on a non-wake-8 tag',
    scanForWake([line('sangit', '[ADVICE from=sangit extra="ping @artisan"]')], 0, { predicates: preds }).length, 1);
  eq('@artisanbot does NOT match @artisan (word boundary)',
    scanForWake([line('bob', '[ADVICE extra="see @artisanbot"]')], 0, { predicates: preds }).length, 0);
  eq('no mention → no wake under mention-only predicate',
    scanForWake([line('bob', '[ADVICE extra="hello"]')], 0, { predicates: preds }).length, 0);
}

// ── open registry: a custom predicate layers on without a scanner change ────
{
  console.log('\nopen predicate registry (§13.6 future triggers):');
  // Simulate a future "hold_opened" trigger when an extension HOLD tag is enabled.
  const holdTrigger: WakePredicate = (evt) => evt.tagName === 'HOLD';
  // wake-8 OR hold: a HOLD now wakes, a STEP still doesn't.
  const preds = [wake8Predicate, holdTrigger];
  eq('HOLD wakes once its predicate is registered',
    scanForWake([line('bob', '[HOLD reason=ci]')], 0, { predicates: preds }).length, 1);
  eq('STEP still does not wake (not registered)',
    scanForWake([line('bob', '[STEP n=1 cmd="x"]')], 0, { predicates: preds }).length, 0);
  eq('GO still wakes via wake8Predicate alongside the custom one',
    scanForWake([line('bob', '[GO from=bob]')], 0, { predicates: preds }).length, 1);
}

// ── state-aware predicate receives the supplied state ───────────────────────
{
  console.log('\nstate-aware predicate:');
  // A predicate that only wakes on VOTE when state says quorum is one short.
  const quorumPred: WakePredicate<{ votesNeeded: number }> = (evt, st) =>
    evt.tagName === 'VOTE' && st.votesNeeded === 1;
  eq('VOTE wakes when state.votesNeeded===1',
    scanForWake([line('bob', '[VOTE agent=bob action=go]')], 0, { predicates: [quorumPred], state: { votesNeeded: 1 } }).length, 1);
  eq('VOTE does NOT wake when state.votesNeeded===3',
    scanForWake([line('bob', '[VOTE agent=bob action=go]')], 0, { predicates: [quorumPred], state: { votesNeeded: 3 } }).length, 0);
}

// ── author extraction ───────────────────────────────────────────────────────
{
  console.log('\nauthor extraction:');
  eq('flat author parsed', flatAuthor('[15:00 artisan] [GO from=artisan]'), 'artisan');
  eq('dated flat author parsed', flatAuthor('[2026-06-13 15:00 mycsan] [VOTE]'), 'mycsan');
  eq('parallel-hand suffix stripped', flatAuthor('[15:00 yosef#2] [GO]'), 'yosef');
  eq('no prefix → null author', flatAuthor('[GO from=bob]'), null);
  // a raw tag log (no transport prefix) still wakes; author is null
  eq('raw tag (no prefix) still wakes', scanForWake(['[GO from=bob]'], 0).length, 1);
  eq('raw tag author is null', scanForWake(['[GO from=bob]'], 0)[0].author, null);
}

// ── carries fields.from for the T3 reducer's §14.3 mismatch-reject ──────────
{
  console.log('\nreducer boundary (carries author + fields.from, does not reject):');
  const woke = scanForWake([line('eve', '[GO from=artisan]')], 0); // spoofed from=
  eq('scanner still wakes (it does not reject — that is T3)', woke.length, 1);
  eq('transport author carried', woke[0].author, 'eve');
  eq('claimed from carried for reducer comparison', woke[0].fields.from, 'artisan');
}

// ── lenient: a malformed tag mid-stream is skipped, not thrown ──────────────
{
  console.log('\nlenient malformed-tag skip:');
  // An over-length tag would throw in strict mode; lenient must skip and continue.
  const huge = `[GO from=bob extra="${'x'.repeat(5000)}"]`;
  const lines = [line('bob', huge), line('carol', '[VERIFY n=1 result=pass]')];
  const woke = scanForWake(lines, 0); // default lenient
  check('loop survives a malformed tag and still wakes on the next', woke.some((e) => e.tagName === 'VERIFY'));
}

// ── toWakeEvent shape ───────────────────────────────────────────────────────
{
  console.log('\ntoWakeEvent:');
  const tag = parseLine('[GO from=bob step=2]', 7, 'strict')!;
  const evt = toWakeEvent(tag, 'bob');
  eq('preserves tagName', evt.tagName, 'GO');
  eq('preserves lineIndex', evt.lineIndex, 7);
  eq('adds author', evt.author, 'bob');
  eq('keeps fields', evt.fields.step, '2');
}

console.log('\n' + '─'.repeat(50));
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) { console.log('Some tests FAILED ❌'); process.exit(1); }
console.log('All wake-scanner tests passed ✅');
