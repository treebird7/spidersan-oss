/**
 * Regression tests for parser.ts
 *
 * These cover the two bugs flagged in grammar v0.1.1 (sasusan review):
 *   1. Locator bug — TAG_RE with [^\]]* mis-closes on escaped \] inside quoted values
 *   2. Missing-tag bug — DONE/VERIFY absent from v0.1 registry
 *
 * Run: npx ts-node src/parser.test.ts
 * (No test framework needed — throws on failure, exits 0 on pass)
 */

import { parseLine, parseLog, parsePaths, normalizePath, ParseError } from './parser';

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

// ---------------------------------------------------------------------------
// 1. Locator bug regression — escaped \] inside quoted extra=
// ---------------------------------------------------------------------------
console.log('\n--- 1. Locator bug regression (grammar v0.1.1) ---');

{
  // The v0.1 TAG_RE (/[^\]]*/) would stop at \] and mis-close the tag.
  // The correct TAG_RE skips over escape sequences inside the field group.
  const line = '[VOTE agent=spidersan confidence=high extra="see path src/components/[legacy\\]"]';
  const ev = parseLine(line, 0);
  assert('VOTE with escaped \\] in extra — tag found', ev !== null);
  assert('tagName=VOTE', ev?.tagName === 'VOTE');
  assert('extra unescaped to contain ]', ev?.fields['extra']?.includes(']') ?? false);
  assert('agent field preserved', ev?.fields['agent'] === 'spidersan');
}

{
  const line = '[COMMENT by=x msg="ends with \\]" extra=""]';
  const ev = parseLine(line, 1);
  assert('COMMENT — msg with trailing escaped ]', ev !== null);
  assert('msg unescaped correctly', ev?.fields['msg'] === 'ends with ]');
}

{
  // Multiple escaped sequences in one tag
  const line = '[STATE repo=owner/repo branch=feat/x sha=a1b2c3d extra="he said \\"go\\" and \\] done"]';
  const ev = parseLine(line, 2);
  assert('STATE — extra with both \\" and \\]', ev !== null);
  assert('extra has both unescaped chars', ev?.fields['extra'] === 'he said "go" and ] done');
}

// ---------------------------------------------------------------------------
// 2. Missing-tag regression — DONE / VERIFY parse cleanly
// ---------------------------------------------------------------------------
console.log('\n--- 2. Missing-tag regression (DONE + VERIFY) ---');

{
  const line = '[DONE n=1 actor=spidersan result=pass sha=a1b2c3d extra=""]';
  const ev = parseLine(line, 0);
  assert('DONE tag found', ev !== null);
  assert('tagName=DONE', ev?.tagName === 'DONE');
  assert('n field', ev?.fields['n'] === '1');
  assert('actor field', ev?.fields['actor'] === 'spidersan');
  assert('result field', ev?.fields['result'] === 'pass');
}

{
  const line = '[DONE n=2 actor=mappersan result=fail extra="CI failed on integration suite"]';
  const ev = parseLine(line, 1);
  assert('DONE result=fail', ev?.fields['result'] === 'fail');
  assert('DONE extra with spaces', ev?.fields['extra'] === 'CI failed on integration suite');
}

{
  const line = '[VERIFY n=1 agent=spidersan checks="ci,diff_stat" result=pass extra=""]';
  const ev = parseLine(line, 0);
  assert('VERIFY tag found', ev !== null);
  assert('tagName=VERIFY', ev?.tagName === 'VERIFY');
  assert('checks field', ev?.fields['checks'] === 'ci,diff_stat');
  assert('result=pass', ev?.fields['result'] === 'pass');
}

// ---------------------------------------------------------------------------
// 3. Combined: DONE with escaped \] in extra
// ---------------------------------------------------------------------------
console.log('\n--- 3. Combined: [DONE n=1 extra="\\]"] ---');

{
  const line = '[DONE n=1 actor=spidersan result=pass extra="merged main into feat/x \\] clean"]';
  const ev = parseLine(line, 0);
  assert('DONE + escaped \\] in extra — tag found', ev !== null);
  assert('tagName=DONE', ev?.tagName === 'DONE');
  assert('extra unescaped', ev?.fields['extra'] === 'merged main into feat/x ] clean');
}

// ---------------------------------------------------------------------------
// 4. General correctness
// ---------------------------------------------------------------------------
console.log('\n--- 4. General correctness ---');

{
  // Bare values
  const line = '[SESSION id=abc-123 repo=owner/repo incident=merge-conflict opened_by=spidersan proto=0.4 extra=""]';
  const ev = parseLine(line, 0);
  assert('SESSION — all bare values', ev?.tagName === 'SESSION');
  assert('id', ev?.fields['id'] === 'abc-123');
  assert('repo with slash', ev?.fields['repo'] === 'owner/repo');
  assert('incident', ev?.fields['incident'] === 'merge-conflict');
}

{
  // No-field tag
  const line = '[CLOSE session=xyz outcome=resolved by=spidersan extra=""]';
  const ev = parseLine(line, 0);
  assert('CLOSE', ev?.tagName === 'CLOSE');
}

{
  // Mid-line tag — text before and after
  const line = 'Some prose here [GO from=spidersan session=abc step=1 extra=""] and after';
  const ev = parseLine(line, 0);
  assert('mid-line tag found', ev !== null);
  assert('mid-line tagName=GO', ev?.tagName === 'GO');
}

{
  // Line with no tag
  const result = parseLine('This is just prose, no tag here.', 0);
  assert('plain prose → null', result === null);
}

{
  // 4000+ byte line in strict mode
  const longLine = '[GO ' + 'x'.repeat(4000) + ']';
  assertThrows('4001-byte line throws in strict mode', () => parseLine(longLine, 0, 'strict'));
}

{
  // Duplicate field in strict mode
  const line = '[VOTE agent=x agent=y action=merge extra=""]';
  assertThrows('duplicate field throws in strict mode', () => parseLine(line, 0, 'strict'));
}

{
  // Unknown escape in strict mode
  const line = '[COMMENT by=x msg="foo \\z bar" extra=""]';
  assertThrows('unknown escape \\z throws in strict mode', () => parseLine(line, 0, 'strict'));
}

// ---------------------------------------------------------------------------
// 5. parseLog — multiple lines
// ---------------------------------------------------------------------------
console.log('\n--- 5. parseLog ---');

{
  const lines = [
    '[SESSION id=s1 repo=owner/repo incident=merge-conflict opened_by=eyal extra=""]',
    '[JOIN agent=spidersan machine=m5 role=driver extra=""]',
    'Just prose, skipped.',
    '[DONE n=1 actor=spidersan result=pass extra=""]',
    '[VERIFY n=1 agent=spidersan result=pass extra=""]',
    '[CLOSE session=s1 outcome=resolved by=spidersan extra=""]',
  ];
  const events = parseLog(lines);
  assert('parseLog: 5 events from 6 lines (1 prose skipped)', events.length === 5);
  assert('lineIndex preserved for prose-skip', events[2].lineIndex === 3); // DONE is line index 3
  assert('last event is CLOSE', events[4].tagName === 'CLOSE');
}

// ---------------------------------------------------------------------------
// 6. parsePaths / normalizePath
// ---------------------------------------------------------------------------
console.log('\n--- 6. parsePaths + normalizePath ---');

{
  const paths = parsePaths('src/auth.ts,lib/email.ts');
  assert('bare comma list', paths.length === 2 && paths[0] === 'src/auth.ts');
}

{
  const paths = parsePaths('src/auth.ts, lib/email.ts');
  assert('comma with space trimmed', paths[1] === 'lib/email.ts');
}

{
  const paths = parsePaths('weird\\,name.ts,normal.ts');
  assert('escaped comma in path', paths.length === 2 && paths[0] === 'weird,name.ts');
}

{
  assert('normalizePath: leading slash removed', normalizePath('/src/auth.ts') === 'src/auth.ts');
  assert('normalizePath: trailing slash removed', normalizePath('src/') === 'src');
  assert('normalizePath: backslash → forward slash', normalizePath('src\\auth.ts') === 'src/auth.ts');
  assert('normalizePath: double slash collapsed', normalizePath('src//auth.ts') === 'src/auth.ts');
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------
console.log(`\n${'─'.repeat(50)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
} else {
  console.log('All regression tests passed ✅');
}
