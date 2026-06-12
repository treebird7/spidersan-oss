/**
 * git-resolve tag parser — v0.1
 *
 * Parses lines from a .resolve append-log into TagEvent structs.
 * Grammar: spidersan-ai/collab/git-resolve-grammar.md
 *
 * Design:
 *  - One tag per line (transport guarantee)
 *  - Bare values: no unescaping needed
 *  - Quoted values: unescape \" → ", \] → ], \\ → \
 *  - Unknown fields: passed through as opaque (forward-compat)
 *  - Lines with no valid tag: return null (caller skips)
 */

/** A single parsed tag event from the append-log. */
export interface TagEvent {
  /** Tag name in UPPER-CASE, e.g. "GO", "VOTE", "SESSION" */
  tagName: string;
  /** All fields as a string→string map (values already unescaped). */
  fields: Record<string, string>;
  /** The raw original line (for audit/replay). */
  raw: string;
  /** Zero-based line index in the append-log (defines total order). */
  lineIndex: number;
}

/** Errors the parser can emit in strict mode. */
export class ParseError extends Error {
  constructor(
    message: string,
    public readonly line: string,
    public readonly lineIndex: number,
  ) {
    super(`[parser] line ${lineIndex}: ${message} — "${line}"`);
    this.name = 'ParseError';
  }
}

export type ParseMode = 'strict' | 'lenient';

// Matches the outermost [...] on a line.
// Capture group 1 = tag-name, group 2 = rest of fields (may be undefined)
const TAG_RE = /\[([A-Z][A-Z0-9-]*)(\s[^\]\\]*(?:\\.[^\]\\]*)*)?\]/;

/**
 * Parse a single line from the .resolve append-log.
 *
 * @returns TagEvent if a valid tag was found, null if the line has no tag.
 * @throws ParseError in strict mode when a tag is found but malformed.
 */
export function parseLine(
  line: string,
  lineIndex: number,
  mode: ParseMode = 'strict',
): TagEvent | null {
  if (line.length > 4000) {
    if (mode === 'strict') {
      throw new ParseError('line exceeds 4000-byte cap', line, lineIndex);
    }
    line = line.slice(0, 4000); // lenient: truncate
  }

  const match = TAG_RE.exec(line);
  if (!match) return null;

  const tagName = match[1];
  const fieldStr = match[2] ?? '';

  const fields = tokenizeFields(fieldStr.trim(), line, lineIndex, mode);

  return { tagName, fields, raw: line, lineIndex };
}

/**
 * Parse all lines from a .resolve append-log.
 * Lines with no tag are skipped silently; malformed tags throw in strict mode.
 */
export function parseLog(
  lines: string[],
  mode: ParseMode = 'strict',
): TagEvent[] {
  const events: TagEvent[] = [];
  for (let i = 0; i < lines.length; i++) {
    const ev = parseLine(lines[i], i, mode);
    if (ev !== null) events.push(ev);
  }
  return events;
}

// ---------------------------------------------------------------------------
// Internal: field tokenizer
// ---------------------------------------------------------------------------

/**
 * Tokenize the field portion of a tag line into name→value pairs.
 * Input: everything after the tag-name, before the closing `]`.
 */
function tokenizeFields(
  raw: string,
  line: string,
  lineIndex: number,
  mode: ParseMode,
): Record<string, string> {
  const fields: Record<string, string> = {};
  let pos = 0;

  while (pos < raw.length) {
    // Skip whitespace
    while (pos < raw.length && (raw[pos] === ' ' || raw[pos] === '\t')) pos++;
    if (pos >= raw.length) break;

    // Read field name (lowercase, digits, hyphens, underscores)
    const nameStart = pos;
    while (pos < raw.length && /[a-z0-9_-]/.test(raw[pos])) pos++;
    const name = raw.slice(nameStart, pos);

    if (!name) {
      if (mode === 'strict') {
        throw new ParseError(`unexpected character at pos ${pos}: '${raw[pos]}'`, line, lineIndex);
      }
      pos++; // lenient: skip bad char
      continue;
    }

    // Expect '='
    if (raw[pos] !== '=') {
      if (mode === 'strict') {
        throw new ParseError(`expected '=' after field name '${name}'`, line, lineIndex);
      }
      continue;
    }
    pos++; // consume '='

    // Read value: quoted or bare
    let value: string;
    if (raw[pos] === '"') {
      [value, pos] = readQuotedValue(raw, pos + 1, line, lineIndex, mode);
    } else {
      [value, pos] = readBareValue(raw, pos);
    }

    if (name in fields && mode === 'strict') {
      throw new ParseError(`duplicate field '${name}'`, line, lineIndex);
    }
    fields[name] = value;
  }

  return fields;
}

/**
 * Read a quoted value starting at `pos` (after the opening `"`).
 * Returns [unescaped-value, new-pos-after-closing-quote].
 */
function readQuotedValue(
  raw: string,
  pos: number,
  line: string,
  lineIndex: number,
  mode: ParseMode,
): [string, number] {
  let result = '';

  while (pos < raw.length) {
    const ch = raw[pos];

    if (ch === '\\') {
      pos++;
      if (pos >= raw.length) {
        if (mode === 'strict') throw new ParseError('trailing backslash in quoted value', line, lineIndex);
        break;
      }
      const next = raw[pos];
      if (next === '"' || next === ']' || next === '\\' || next === ',') {
        result += next;
        pos++;
      } else {
        if (mode === 'strict') {
          throw new ParseError(`unknown escape sequence '\\${next}'`, line, lineIndex);
        }
        result += '\\' + next; // lenient: pass through
        pos++;
      }
    } else if (ch === '"') {
      pos++; // consume closing quote
      return [result, pos];
    } else {
      result += ch;
      pos++;
    }
  }

  // Unclosed quote
  if (mode === 'strict') {
    throw new ParseError('unclosed quoted value', line, lineIndex);
  }
  return [result, pos]; // lenient: return what we have
}

/**
 * Read a bare (unquoted) value starting at `pos`.
 * Returns [value, new-pos] — value ends at whitespace or end-of-string.
 */
function readBareValue(raw: string, pos: number): [string, number] {
  const start = pos;
  while (pos < raw.length && raw[pos] !== ' ' && raw[pos] !== '\t') {
    pos++;
  }
  return [raw.slice(start, pos), pos];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Split a `files=` value into a normalized path array.
 * Handles escaped commas (\,) and trims whitespace around each segment.
 * Paths are expected to already be unescaped (pass the field value, not raw).
 */
export function parsePaths(filesValue: string): string[] {
  // Split on unescaped commas using a placeholder technique
  // (JS lacks lookbehind in older envs; use a two-pass approach)
  const placeholder = '\x00';
  const escaped = filesValue.replace(/\\,/g, placeholder);
  return escaped
    .split(',')
    .map(p => p.trim().replace(new RegExp(placeholder, 'g'), ','))
    .filter(p => p.length > 0);
}

/**
 * Normalize a single repository-relative path:
 *  - Strip leading '/'
 *  - Strip trailing '/'
 *  - Replace backslashes with forward slashes
 *  - Collapse repeated slashes
 */
export function normalizePath(p: string): string {
  return p
    .replace(/\\/g, '/')
    .replace(/\/+/g, '/')
    .replace(/^\//, '')
    .replace(/\/$/, '');
}
