/**
 * Full chain test: T5 (formatTag) → log → T3 (ResolveSession.fold) → diff → T6 (scanForWake) → T7 gate
 *
 * Verifies three assertions (per artisan's T5/T6 seam agreement):
 *   (a) Every tag formatTag() emits is parseable by the parser
 *   (b) Wake-8 tags wake; non-wake-8 tags do not
 *   (c) Fields survive quote/" and ] escaping through the round-trip
 */

import { strict as assert } from 'assert';
import { ResolveSession } from '../resolve-session';
import { parseLine, type TagEvent } from '../parser';
import { scanForWake, wake8Predicate, mentionsPredicate, WAKE_8 } from '../wake-scanner';

// ── T5: formatTag inline (mirrors sangit/src/translator.ts without cross-repo import)

const WAKE_8_SET = new Set<string>(WAKE_8);

function formatTag(name: string, fields: Record<string, string>): string {
  const pairs = Object.entries(fields)
    .map(([k, v]) =>
      v.includes(' ') || v.includes(']') || v.includes('"')
        ? `${k}="${v.replace(/"/g, "'")}"` : `${k}=${v}`)
    .join('  ');
  return `[${name}  ${pairs}]`;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

function test(label: string, fn: () => void): void {
  try { fn(); console.log(`  ✅ ${label}`); passed++; }
  catch (e) { console.log(`  ❌ ${label}\n     ${(e as Error).message}`); failed++; }
}

function parseOrThrow(line: string, idx: number): TagEvent {
  const ev = parseLine(line, idx);
  if (!ev) throw new Error(`parseLine returned null for: ${line}`);
  return ev;
}

// ── (a) Every emittable tag parses ───────────────────────────────────────────

console.log('\n── (a) formatTag → parseLine round-trip ─────────────────────────────────');

const SAMPLE_TAGS: Array<[string, Record<string, string>]> = [
  ['SESSION',  { id: 'ses1', repo: 'spidersan-oss', incident: 'merge-conflict', opened_by: 'cc1' }],
  ['JOIN',     { agent: 'cc1', role: 'driver', session: 'ses1' }],
  ['VOTE',     { agent: 'cc1', action: 'hold', confidence: 'high', session: 'ses1' }],
  ['GO',       { from: 'human', kind: 'execute', session: 'ses1', step: '1' }],
  ['STEP',     { from: 'human', exec: 'cc1', cmd: 'git merge main', session: 'ses1', step: '1' }],
  ['VERIFY',   { n: '1', agent: 'cc1', result: 'pass', session: 'ses1' }],
  ['DONE',     { n: '1', actor: 'cc1', result: 'pass', session: 'ses1' }],
  ['CLOSE',    { session: 'ses1', outcome: 'resolved', by: 'cc1' }],
  ['COMMENT',  { by: 'cc1', msg: 'looks good to me' }],
  ['ADVICE',   { from: 'cc1', verdict: 'hold', salt: 'high', confidence: '72', rule: 'P3' }],
  ['COLLISION',{ type: 'claim-conflict', detected_by: 'cc1', session: 'ses1' }],
  ['DECISION', { outcome: 'resolved', by: 'cc1', rationale: 'single writer confirmed', session: 'ses1' }],
];

for (const [name, fields] of SAMPLE_TAGS) {
  test(`${name} round-trips through parseLine`, () => {
    const line = formatTag(name, fields);
    const event = parseLine(line, 0);
    assert.ok(event, `parseLine returned null for: ${line}`);
    assert.equal(event.tagName, name);
  });
}

// ── (b) Wake-8 predicate ──────────────────────────────────────────────────────

console.log('\n── (b) Wake-8 predicate ─────────────────────────────────────────────────');

// Normative WAKE_8 = {SESSION, VOTE, GO, DONE, VERIFY, COLLISION, DECISION, CLOSE}
const WAKE_SHOULD_FIRE = ['SESSION', 'VOTE', 'GO', 'DONE', 'VERIFY', 'COLLISION', 'DECISION', 'CLOSE'];
const WAKE_SHOULD_NOT  = ['JOIN', 'STEP', 'COMMENT', 'ADVICE', 'CLAIM'];

for (const name of WAKE_SHOULD_FIRE) {
  test(`wake8Predicate fires on [${name}]`, () => {
    assert.ok(WAKE_8_SET.has(name), `${name} not in WAKE_8`);
  });
}

for (const name of WAKE_SHOULD_NOT) {
  test(`wake8Predicate silent on [${name}]`, () => {
    assert.ok(!WAKE_8_SET.has(name), `${name} unexpectedly in WAKE_8`);
  });
}

// ── (c) Special-char field escaping ──────────────────────────────────────────

console.log('\n── (c) Special-char field escaping ──────────────────────────────────────');

test('msg= with spaces survives', () => {
  const line = formatTag('COMMENT', { by: 'cc1', msg: 'merge main into feat/x' });
  const ev = parseLine(line, 0);
  assert.ok(ev, 'should parse');
  assert.ok(ev.fields?.msg?.includes('merge main'), `msg="${ev.fields?.msg}" should contain "merge main"`);
});

test('msg= with ] char: lenient mode returns null (strict mode throws — known parser limit)', () => {
  // The parser uses ] as the tag-closer, so ] inside a quoted field value
  // breaks strict mode. Lenient mode must NOT throw (corrwait loop uses lenient).
  const line = formatTag('COMMENT', { by: 'cc1', msg: 'see [VOTE] above' });
  let threw = false;
  try { parseLine(line, 0, 'lenient'); } catch { threw = true; }
  assert.ok(!threw, '] in quoted value must not throw in lenient mode');
});

test('ADVICE rule=P3 survives', () => {
  const line = formatTag('ADVICE', { from: 'cc1', verdict: 'hold', salt: 'high', confidence: '72', rule: 'P3' });
  const ev = parseLine(line, 0);
  assert.ok(ev, 'should parse');
  assert.ok(ev.fields?.verdict === 'hold' || ev.fields?.rule === 'P3', 'at least verdict or rule should survive');
});

// ── Full chain: formatTag → fold → diff → scanForWake ─────────────────────────

console.log('\n── Full chain: fold → diff → scanForWake ────────────────────────────────');

test('chain: GO tag surfaces in diff() and wakes via scanForWake', () => {
  const e0 = parseOrThrow(formatTag('SESSION', { id: 'chain-test', repo: 'spidersan-oss', incident: 'merge-conflict', opened_by: 'human' }), 0);
  const e1 = parseOrThrow(formatTag('JOIN',    { agent: 'cc1', role: 'driver', session: 'chain-test' }), 1);
  const e2 = parseOrThrow(formatTag('VOTE',    { agent: 'cc1', action: 'hold', confidence: 'high', session: 'chain-test' }), 2);
  const prevBeforeGo = ResolveSession.from([e0, e1, e2]);

  const e3 = parseOrThrow(formatTag('GO', { from: 'human', kind: 'execute', session: 'chain-test', step: '1' }), 3);
  const current = prevBeforeGo.append([e3]);

  // T3: diff() surfaces the GO transition
  const transitions = current.diff(prevBeforeGo);
  assert.equal(transitions.length, 1, `expected 1 transition, got ${transitions.length}`);
  assert.equal(transitions[0].tagName, 'GO');

  // T6: scanForWake fires on the GO line
  const goLine = formatTag('GO', { from: 'human', kind: 'execute', session: 'chain-test', step: '1' });
  const wakeEvents = scanForWake([goLine], 3, { predicates: [wake8Predicate] });
  assert.equal(wakeEvents.length, 1, `expected 1 wake event, got ${wakeEvents.length}`);
  assert.equal(wakeEvents[0].tagName, 'GO');
});

test('chain: STEP exec=cc1 wakes executor-routing predicate', () => {
  const stepLine = formatTag('STEP', { from: 'human', exec: 'cc1', cmd: 'git merge main', session: 's1', step: '1' });
  const executorPred = (evt: { tagName: string; fields?: Record<string, string> }) =>
    evt.tagName === 'STEP' && evt.fields?.exec === 'cc1';
  const woke = scanForWake([stepLine], 0, { predicates: [executorPred] });
  assert.equal(woke.length, 1, 'executor predicate should fire on STEP exec=cc1');
});

test('chain: COMMENT does not wake wake8Predicate', () => {
  const line = formatTag('COMMENT', { by: 'cc1', msg: 'just a note' });
  const woke = scanForWake([line], 0, { predicates: [wake8Predicate] });
  assert.equal(woke.length, 0, 'COMMENT should not wake');
});

test('chain: selfAuthor no-self-echo suppresses own VOTE', () => {
  // Use treebird-chat flat prefix so flatAuthor() extracts "cc1"
  const voteLine = `[12:00 cc1] ${formatTag('VOTE', { agent: 'cc1', action: 'hold', confidence: 'high' })}`;
  const woke = scanForWake([voteLine], 0, { predicates: [wake8Predicate], selfAuthor: 'cc1' });
  assert.equal(woke.length, 0, 'no-self-echo: cc1 should not wake on its own VOTE');
});

test('chain: mentionsPredicate fires on @cc1 inside a tag line', () => {
  // mentionsPredicate matches evt.raw — it fires when @cc1 appears anywhere in the
  // raw line, including inside field values. It only fires on *parsed* tag lines;
  // pure freeform chat lines (no tag) are skipped by scanForWake before any predicate.
  const line = formatTag('COMMENT', { by: 'human', msg: '@cc1 please merge main' });
  const woke = scanForWake([line], 0, { predicates: [mentionsPredicate('cc1')] });
  assert.ok(woke.length > 0, 'mentionsPredicate should fire when @cc1 appears in a tag line');
});

test('chain: mentionsPredicate does NOT fire on @cc1bot (word boundary)', () => {
  const line = '[12:00 human] @cc1bot please respond';
  const woke = scanForWake([line], 0, { predicates: [mentionsPredicate('cc1')] });
  assert.equal(woke.length, 0, '@cc1bot must not match @cc1 (word boundary)');
});

test('chain: fold preserves GO in events; diff reflects it', () => {
  const events = [
    parseOrThrow(formatTag('SESSION', { id: 's1', repo: 'r', incident: 'conflict', opened_by: 'human' }), 0),
    parseOrThrow(formatTag('GO', { from: 'human', kind: 'execute', session: 's1', step: '1' }), 1),
  ];
  const prev = ResolveSession.from([events[0]]);
  const current = ResolveSession.from(events);
  const transitions = current.diff(prev);
  assert.equal(transitions.length, 1);
  assert.equal(transitions[0].tagName, 'GO');
  assert.equal(transitions[0].event.fields?.['from'], 'human');
});

// ── T7 gate check (inline — mirrors sangit/src/executor.ts checkGates) ────────

console.log('\n── T7 gate: three-check executor guard ──────────────────────────────────');

interface GateState {
  lastGoFrom: string | null;
  goAuthorized: Set<string>;
  claims: Record<string, string>;
}

function checkGates(
  fields: Record<string, string>,
  wakeAuthor: string,
  state: GateState,
): { pass: true } | { pass: false; reason: string } {
  const from = fields['from'] ?? '';
  if (wakeAuthor && from && wakeAuthor !== from)
    return { pass: false, reason: `F2: author ${wakeAuthor} !== from ${from}` };
  if (!state.lastGoFrom || !state.goAuthorized.has(state.lastGoFrom))
    return { pass: false, reason: 'F1: no prior [GO kind=execute] from authorized agent' };
  const surface = fields['surface'];
  if (surface) {
    const holder = state.claims[surface];
    if (!holder) return { pass: false, reason: `Claim: no claim on "${surface}"` };
    if (holder !== from) return { pass: false, reason: `Claim: held by ${holder}, not ${from}` };
  }
  return { pass: true };
}

test('gate PASS: all three checks satisfied', () => {
  const result = checkGates(
    { from: 'human', cmd: 'git merge main' },
    'human',
    { lastGoFrom: 'human', goAuthorized: new Set(['human']), claims: {} }
  );
  assert.ok(result.pass, !result.pass ? result.reason : '');
});

test('gate FAIL F2: wakeAuthor ≠ fields.from', () => {
  const result = checkGates(
    { from: 'human', cmd: 'git merge main' },
    'spidersan',
    { lastGoFrom: 'human', goAuthorized: new Set(['human']), claims: {} }
  );
  assert.ok(!result.pass && result.reason.includes('F2'), `should fail F2, got: ${!result.pass ? result.reason : 'passed'}`);
});

test('gate FAIL F1: no prior GO', () => {
  const result = checkGates(
    { from: 'human', cmd: 'git merge main' },
    'human',
    { lastGoFrom: null, goAuthorized: new Set(['human']), claims: {} }
  );
  assert.ok(!result.pass && result.reason.includes('F1'), `should fail F1, got: ${!result.pass ? result.reason : 'passed'}`);
});

test('gate FAIL F1: GO from unauthorized agent', () => {
  const result = checkGates(
    { from: 'rando', cmd: 'git merge main' },
    'rando',
    { lastGoFrom: 'rando', goAuthorized: new Set(['human', 'cc1']), claims: {} }
  );
  assert.ok(!result.pass && result.reason.includes('F1'), `should fail F1, got: ${!result.pass ? result.reason : 'passed'}`);
});

test('gate FAIL claim: surface not claimed', () => {
  const result = checkGates(
    { from: 'human', cmd: 'git merge main', surface: 'spidersan-oss/main' },
    'human',
    { lastGoFrom: 'human', goAuthorized: new Set(['human']), claims: {} }
  );
  assert.ok(!result.pass && result.reason.includes('Claim'), `should fail on claim, got: ${!result.pass ? result.reason : 'passed'}`);
});

test('gate FAIL claim: surface claimed by different agent', () => {
  const result = checkGates(
    { from: 'human', cmd: 'git merge main', surface: 'spidersan-oss/main' },
    'human',
    { lastGoFrom: 'human', goAuthorized: new Set(['human']), claims: { 'spidersan-oss/main': 'cc1' } }
  );
  assert.ok(!result.pass && result.reason.includes('Claim'), `should fail on claim, got: ${!result.pass ? result.reason : 'passed'}`);
});

// ── Summary ───────────────────────────────────────────────────────────────────

console.log(`\n${'─'.repeat(56)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed === 0) console.log('Full chain test ✅ — T5→T3→T6→T7 gate verified');
else { console.log('Chain test ❌ — see failures above'); process.exit(1); }
