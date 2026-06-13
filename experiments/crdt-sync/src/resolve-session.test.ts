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

function assertThrows(label: string, fn: () => void): void {
  try {
    fn();
    console.error(`  ❌ ${label}: expected throw, got none`);
    failed++;
  } catch {
    console.log(`  ✅ ${label}`);
    passed++;
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
// G1b — CLAIM / PRUNE ownership (R-c) — rubberduck findings #1, #2
// ---------------------------------------------------------------------------
console.log('\n--- G1b. CLAIM/PRUNE ownership (R-c) ---');
{
  // Spoofed CLAIM: author != by → rejected, not registered
  const s = ResolveSession.from([
    ev('[CLAIM by=spidersan surface=feat/x extra=""]', 0, 'mallory'),
  ]);
  assert('spoofed CLAIM not registered', s.claims.size === 0);
  assert('spoofed CLAIM warns', s.warnings.some(w => w.includes('spoofed')));
}
{
  // Honest CLAIM then NON-OWNER PRUNE (authed honestly as mallory) → prune rejected
  const s = ResolveSession.from([
    ev('[CLAIM by=spidersan surface=feat/x extra=""]', 0, 'spidersan'),
    ev('[PRUNE branch=feat/x extra=""]', 1, 'mallory'),
  ]);
  assert('claim registered by owner', s.claimOn('feat/x') !== undefined);
  assert('non-owner PRUNE did NOT prune', s.claimOn('feat/x')?.pruned !== true);
  assert('non-owner PRUNE warns (R-c)', s.warnings.some(w => w.includes('does not own')));
}
{
  // Owner PRUNE → succeeds
  const s = ResolveSession.from([
    ev('[CLAIM by=spidersan surface=feat/x extra=""]', 0, 'spidersan'),
    ev('[PRUNE branch=feat/x extra=""]', 1, 'spidersan'),
  ]);
  assert('owner PRUNE marks claim pruned', s.claims.get('feat/x')?.pruned === true);
}
{
  // Pre-T6 (no author) PRUNE → back-compat, prunes
  const s = ResolveSession.from([
    ev('[CLAIM by=spidersan surface=feat/x extra=""]', 0),
    ev('[PRUNE branch=feat/x extra=""]', 1),
  ]);
  assert('no-author PRUNE prunes (back-compat)', s.claims.get('feat/x')?.pruned === true);
}

// ---------------------------------------------------------------------------
// G5b — confidence edge cases — rubberduck finding #3
// ---------------------------------------------------------------------------
console.log('\n--- G5b. confidence edge cases ---');
for (const bad of ['62.5', '62abc', '-5', '', 'abc']) {
  const s = ResolveSession.from([
    ev(`[ADVICE from=sangit verdict=hold confidence=${bad || '""'} salt=high extra=""]`, 0),
  ]);
  assert(`confidence "${bad}" rejected (undefined)`, s.advice[0].confidence === undefined);
}
{
  const s = ResolveSession.from([ev('[ADVICE from=sangit verdict=hold confidence=0 salt=high extra=""]', 0)]);
  assert('confidence boundary 0 accepted', s.advice[0].confidence === 0);
}
{
  const s = ResolveSession.from([ev('[ADVICE from=sangit verdict=hold confidence=100 salt=high extra=""]', 0)]);
  assert('confidence boundary 100 accepted', s.advice[0].confidence === 100);
}

// ---------------------------------------------------------------------------
// G1c — author="" footgun — rubberduck finding #4
// ---------------------------------------------------------------------------
console.log('\n--- G1c. author="" skips enforcement ---');
{
  const s = ResolveSession.from([
    ev('[VOTE agent=spidersan action=merge confidence=high extra=""]', 0, ''),
  ]);
  assert('empty-string author skips enforcement (vote applied)', s.votes.get('spidersan')?.action === 'merge');
  assert('empty-string author does not warn spoof', !s.warnings.some(w => w.includes('spoofed')));
}

// ---------------------------------------------------------------------------
// G3b — diff edge cases — rubberduck finding #5
// ---------------------------------------------------------------------------
console.log('\n--- G3b. diff edge cases ---');
{
  const empty = ResolveSession.from([]);
  const s = empty.append([
    ev('[VOTE agent=spidersan action=merge confidence=high extra=""]', 0, 'spidersan'),
  ]);
  assert('diff against empty prev returns the new wake-8 event', s.diff(empty).length === 1);
}
{
  // Spoofed second vote must NOT replace the honest first
  const s = ResolveSession.from([
    ev('[VOTE agent=spidersan action=merge confidence=high extra=""]', 0, 'spidersan'),
    ev('[VOTE agent=spidersan action=abandon confidence=high extra=""]', 1, 'mallory'),
  ]);
  assert('spoofed second vote did not replace honest first', s.votes.get('spidersan')?.action === 'merge');
}

// ---------------------------------------------------------------------------
// G2b — verifyAt supersede + re-fold determinism
// ---------------------------------------------------------------------------
console.log('\n--- G2b. verifyAt supersede + determinism ---');
{
  const s = ResolveSession.from([
    ev('[VERIFY n=1 agent=a checks="x" result=pass extra=""]', 0),
    ev('[VERIFY n=1 agent=b checks="x" result=fail extra=""]', 1),
  ]);
  assert('verifyAt(1) returns the latest (fail supersedes)', s.verifyAt(1)?.result === 'fail');
}
{
  // from(a).append(b) must equal from([...a,...b]) for derived state
  const a = [ev('[SESSION id=z repo=r incident=merge-order opened_by=human extra=""]', 0)];
  const b = [ev('[VOTE agent=spidersan action=merge confidence=high extra=""]', 1, 'spidersan')];
  const split = ResolveSession.from(a).append(b);
  const whole = ResolveSession.from([...a, ...b]);
  assert('re-fold determinism: votes equal', split.votes.get('spidersan')?.action === whole.votes.get('spidersan')?.action);
  assert('re-fold determinism: sessionId equal', split.sessionId === whole.sessionId);
  assert('re-fold determinism: event count equal', split.events.length === whole.events.length);
}

// ---------------------------------------------------------------------------
// N1 — by-less CLAIM warns + is unprunable by another author; PRUNE files= path
// ---------------------------------------------------------------------------
console.log('\n--- N1 + PRUNE files= path ---');
{
  // CLAIM with no `by` → warns, and a different authed actor cannot prune it
  const s = ResolveSession.from([
    ev('[CLAIM surface=feat/x extra=""]', 0, 'spidersan'),  // no by=
    ev('[PRUNE branch=feat/x extra=""]', 1, 'mallory'),
  ]);
  assert('by-less CLAIM warns', s.warnings.some(w => w.includes('CLAIM') && w.includes('by')));
  assert('by-less claim NOT prunable by other author (N1)', s.claims.get('feat/x')?.pruned !== true);
  assert('N1 prune rejection warns unverifiable owner', s.warnings.some(w => w.includes('unverifiable owner')));
}
{
  // PRUNE by files= path: non-owner rejected, owner succeeds
  const nonOwner = ResolveSession.from([
    ev('[CLAIM by=spidersan surface=src/x.ts extra=""]', 0, 'spidersan'),
    ev('[PRUNE files=src/x.ts extra=""]', 1, 'mallory'),
  ]);
  assert('PRUNE files= by non-owner rejected', nonOwner.claims.get('src/x.ts')?.pruned !== true);
  const owner = ResolveSession.from([
    ev('[CLAIM by=spidersan surface=src/x.ts extra=""]', 0, 'spidersan'),
    ev('[PRUNE files=src/x.ts extra=""]', 1, 'spidersan'),
  ]);
  assert('PRUNE files= by owner prunes', owner.claims.get('src/x.ts')?.pruned === true);
}

// ---------------------------------------------------------------------------
// N2 — diff() rejects a non-prefix prev instead of silently returning wrong window
// ---------------------------------------------------------------------------
console.log('\n--- N2. diff() prefix contract enforced ---');
{
  const base = ResolveSession.from([ev('[SESSION id=a repo=r incident=merge-order opened_by=human extra=""]', 0)]);
  const longerPrev = base.append([ev('[VOTE agent=x action=merge confidence=high extra=""]', 1, 'x')]);
  // prev longer than this → throw
  assertThrows('diff throws when prev longer than this', () => base.diff(longerPrev));
  // unrelated same-length prev (different boundary event) → throw
  const unrelated = ResolveSession.from([ev('[SESSION id=b repo=r2 incident=merge-conflict opened_by=human extra=""]', 0)]);
  const next = base.append([ev('[GO from=human session=a step=1 extra=""]', 1, 'human')]);
  assertThrows('diff throws on non-prefix (unrelated) prev', () => next.diff(unrelated));
}

// ---------------------------------------------------------------------------
console.log('\n──────────────────────────────────────────────────');
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.error('Some tests FAILED ❌');
  process.exit(1);
}
console.log('All resolve-session tests passed ✅');
