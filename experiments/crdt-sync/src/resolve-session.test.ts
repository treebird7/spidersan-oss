/**
 * Tests for resolve-session.ts — T3 gap-fills (consortium 2026-06-13).
 *
 * Covers:
 *   G1 author≠from reject (Floor-F2 / spec §14.3)
 *   G2 VERIFY index (§16 reward ground truth)
 *   G3 diff() wake-8 transition API
 *   G4 DECISION rationale + steps_completed (grammar v0.2)
 *   G5 ADVICE index + confidence 0-100 validation (grammar §6)
 *
 * Run: npx tsx src/resolve-session.test.ts
 * (No framework — throws on failure, exits 0 on pass; matches parser.test.ts)
 */

import { parseLine, parseLog, TagEvent } from './parser';
import { ResolveSession, WAKE_8 } from './resolve-session';

let passed = 0;
let failed = 0;

function assert(label: string, condition: boolean, detail?: string): void {
  if (condition) {
    console.log(`  ✅ ${label}`);
    passed++;
  } else {
    console.error(`  ❌ ${label}${detail ? ': ' + detail : ''}`);
    failed++;
  }
}

/** Parse a single line into a TagEvent, optionally stamping the T6 `author`. */
function ev(line: string, lineIndex: number, author?: string | null): TagEvent {
  const e = parseLine(line, lineIndex);
  if (!e) throw new Error(`test bug: line did not parse: ${line}`);
  if (author !== undefined) e.author = author;
  return e;
}

// ---------------------------------------------------------------------------
// G2 — VERIFY index
// ---------------------------------------------------------------------------
console.log('\n--- G2. VERIFY index ---');
{
  const s = ResolveSession.from([
    ev('[SESSION id=abc repo=treebird7/spidersan-oss incident=merge-order opened_by=human extra=""]', 0),
    ev('[VERIFY n=1 agent=mycsan checks="isFinite-guard,sha256-bucket-id,ci-green" result=pass sha=0b43f2e extra=""]', 1),
  ]);
  assert('one verification recorded', s.verifications.length === 1);
  assert('verify agent', s.verifications[0].agent === 'mycsan');
  assert('verify n=1', s.verifications[0].n === 1);
  assert('verify checks split into 3', s.verifications[0].checks.length === 3);
  assert('verify result=pass', s.verifications[0].result === 'pass');
  assert('verify sha', s.verifications[0].sha === '0b43f2e');
  assert('verifyAt(1) returns it', s.verifyAt(1)?.agent === 'mycsan');
  assert('verifyAt() returns latest', s.verifyAt()?.n === 1);
  assert('verifyAt(99) undefined', s.verifyAt(99) === undefined);
}

// ---------------------------------------------------------------------------
// G5 — ADVICE index + confidence validation
// ---------------------------------------------------------------------------
console.log('\n--- G5. ADVICE index ---');
{
  const s = ResolveSession.from([
    ev('[ADVICE from=sangit verdict=hold confidence=62 pattern=claim_overlap salt=high extra=""]', 0),
  ]);
  assert('one advice recorded', s.advice.length === 1);
  assert('advice verdict', s.advice[0].verdict === 'hold');
  assert('advice confidence parsed to int 62', s.advice[0].confidence === 62);
  assert('advice pattern', s.advice[0].pattern === 'claim_overlap');
  assert('advice salt=high', s.advice[0].salt === 'high');
}
{
  // Out-of-range confidence → warning, confidence left undefined
  const s = ResolveSession.from([
    ev('[ADVICE from=sangit verdict=go confidence=140 salt=high extra=""]', 0),
  ]);
  assert('out-of-range confidence not set', s.advice[0].confidence === undefined);
  assert('out-of-range confidence warns', s.warnings.some(w => w.includes('confidence')));
}

// ---------------------------------------------------------------------------
// G4 — DECISION rationale + steps_completed
// ---------------------------------------------------------------------------
console.log('\n--- G4. DECISION fields ---');
{
  const s = ResolveSession.from([
    ev('[DECISION outcome=resolved by=spidersan rationale="merged after 3 sign-offs" steps_completed=4 action=merge session=abc extra=""]', 0),
  ]);
  assert('one decision recorded', s.decisions.length === 1);
  assert('decision rationale captured', s.decisions[0].rationale === 'merged after 3 sign-offs');
  assert('decision steps_completed=4', s.decisions[0].steps_completed === 4);
  assert('decision action', s.decisions[0].action === 'merge');
}
{
  // Missing required rationale → warning
  const s = ResolveSession.from([
    ev('[DECISION outcome=resolved by=spidersan extra=""]', 0),
  ]);
  assert('missing rationale warns', s.warnings.some(w => w.includes('rationale')));
  assert('decision still recorded (warn, not drop)', s.decisions.length === 1);
}

// ---------------------------------------------------------------------------
// G1 — author≠from reject (Floor-F2 / §14.3)
// ---------------------------------------------------------------------------
console.log('\n--- G1. author≠from reject ---');
{
  // Spoofed VOTE: transport author=mallory, but tag claims agent=spidersan
  const s = ResolveSession.from([
    ev('[VOTE agent=spidersan action=merge confidence=high extra=""]', 0, 'mallory'),
  ]);
  assert('spoofed vote NOT applied to index', s.votes.size === 0);
  assert('spoofed vote warns', s.warnings.some(w => w.includes('spoofed')));
  assert('spoofed event STILL in canonical log', s.events.length === 1);
}
{
  // Honest VOTE: author matches agent → applied
  const s = ResolveSession.from([
    ev('[VOTE agent=spidersan action=merge confidence=high extra=""]', 0, 'spidersan'),
  ]);
  assert('honest vote applied', s.votes.get('spidersan')?.action === 'merge');
  assert('honest vote no spoof warning', !s.warnings.some(w => w.includes('spoofed')));
}
{
  // Pre-T6 back-compat: no author stamped → enforcement skipped
  const s = ResolveSession.from([
    ev('[VOTE agent=spidersan action=merge confidence=high extra=""]', 0),
  ]);
  assert('no-author vote applied (back-compat)', s.votes.get('spidersan')?.action === 'merge');
}
{
  // Spoofed GO is rejected too (from-keyed)
  const s = ResolveSession.from([
    ev('[GO from=human session=abc step=1 extra=""]', 0, 'mallory'),
  ]);
  assert('spoofed GO warns', s.warnings.some(w => w.includes('spoofed') && w.includes('GO')));
}

// ---------------------------------------------------------------------------
// G3 — diff() wake-8 transition API
// ---------------------------------------------------------------------------
console.log('\n--- G3. diff() wake-8 transitions ---');
{
  const base = ResolveSession.from(parseLog([
    '[SESSION id=abc repo=r incident=merge-order opened_by=human extra=""]',
    '[JOIN agent=spidersan machine=m5 role=driver extra=""]',
  ]));
  const next = base.append([
    ev('[COMMENT by=spidersan msg="thinking" extra=""]', 2),  // not wake-8
    ev('[VOTE agent=spidersan action=merge confidence=high extra=""]', 3, 'spidersan'),
    ev('[GO from=human session=abc step=1 extra=""]', 4, 'human'),
  ]);
  const transitions = next.diff(base);
  assert('diff returns only wake-8 events', transitions.every(t => WAKE_8.has(t.tagName)));
  assert('diff excludes COMMENT', !transitions.some(t => t.tagName === 'COMMENT'));
  assert('diff includes VOTE + GO', transitions.length === 2);
  assert('diff transitions ordered by lineIndex', transitions[0].lineIndex < transitions[1].lineIndex);
  assert('JOIN (pre-existing, not wake-8) excluded', !transitions.some(t => t.tagName === 'JOIN'));
}

// ---------------------------------------------------------------------------
console.log('\n──────────────────────────────────────────────────');
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.error('Some tests FAILED ❌');
  process.exit(1);
}
console.log('All resolve-session tests passed ✅');
