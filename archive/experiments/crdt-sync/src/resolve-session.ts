/**
 * ResolveSession — git-resolve session state
 *
 * The append-log IS the canonical events log (§14.2).
 * All derived state is a deterministic fold over TagEvent[].
 * Nothing is stored here that isn't computable from the log.
 *
 * Architecture:
 *   append-log lines → TagEvent[] (parser.ts)
 *       → ResolveSession.fold() → derived indexes
 *
 * The session itself is immutable once constructed. To apply new events,
 * call session.append(events) which returns a new session with the extended
 * log. This makes the fold testable and replay-safe.
 */

import { TagEvent, parsePaths, normalizePath } from './parser';

// ---------------------------------------------------------------------------
// Derived index types — all are computable from the event log
// ---------------------------------------------------------------------------

export interface AgentRecord {
  name: string;
  machine: string;
  role: string;
  joinedAt: number;      // lineIndex of JOIN
  leftAt?: number;       // lineIndex of LEAVE, if present
  leftReason?: string;
}

export interface VoteRecord {
  agent: string;
  action: string;
  confidence: 'high' | 'medium' | 'low' | string;
  form?: string;
  extra?: string;
  lineIndex: number;
}

export interface ClaimRecord {
  by: string;
  surface: string;
  unit?: string;
  ttl?: string;
  lineIndex: number;
  pruned?: boolean;       // true after a matching [PRUNE]
}

export interface StateRecord {
  repo: string;
  branch: string;
  sha: string;
  expected?: string;
  conflict?: string;
  files: string[];        // normalized paths
  lineIndex: number;
}

export interface EvidenceRecord {
  scan?: string;
  prsConsumed?: number;
  contentLoss?: boolean;
  ci?: 'pass' | 'fail' | 'pending' | string;
  diffStat?: string;
  lineIndex: number;
}

export interface DecisionRecord {
  outcome: string;
  by: string;
  rationale: string;        // grammar v0.2: required — the T4 §8 pair-gen reads it
  steps_completed?: number; // grammar v0.2: optional
  action?: string;
  session?: string;
  lineIndex: number;
}

export interface CollisionRecord {
  type: string;
  surfaces: string[];
  agents: string[];
  lineIndex: number;
}

/** A [VERIFY] event — the §16 reward ground truth + a wake-8 transition. */
export interface VerifyRecord {
  n?: number;
  agent: string;
  checks: string[];
  result: 'pass' | 'fail' | string;
  sha?: string;
  lineIndex: number;
}

/**
 * A [ADVICE] event from Sangit. Not in the wake-8 (it does not move the state
 * machine), but the §16 verified-outcome reward reads Sangit's advice at quorum.
 * `confidence` is an integer 0-100 for ADVICE (vs the VOTE enum) — grammar §6.
 */
export interface AdviceRecord {
  from: string;
  verdict: string;
  confidence?: number;   // 0-100 integer
  pattern?: string;
  salt?: string;
  msg?: string;
  rule?: string;
  lineIndex: number;
}

// ---------------------------------------------------------------------------
// Session outcome
// ---------------------------------------------------------------------------

export type SessionOutcome =
  | 'resolved'
  | 'abandoned'
  | 'deferred'
  | 'partial'
  | 'open';   // not yet closed

/**
 * The normative wake-set (grammar §11.1, "wake-8"): the only tags that move the
 * state machine or demand another actor react. Parsing ingests all tags; only
 * these wake. This is the single scanner shared by the T6 wake-predicate and the
 * Sangit subscriber — do not build a second one.
 */
export const WAKE_8: ReadonlySet<string> = new Set([
  'SESSION', 'VOTE', 'GO', 'DONE', 'VERIFY', 'COLLISION', 'DECISION', 'CLOSE',
]);

/** A wake-8 transition surfaced by ResolveSession.diff() for subscribers. */
export interface Transition {
  tagName: string;       // one of WAKE_8
  lineIndex: number;
  event: TagEvent;
}

/**
 * Maps a tag-name to the field that names its claimed emitter. Used to enforce
 * the author≠from reject (spec §14.3 / Floor-F2): when the transport stamps an
 * authenticated `author`, a keyed mutation is applied only if it matches the
 * claimed emitter — otherwise the event still lands in the canonical log but its
 * mutation is dropped (the spoof attempt becomes a training pair).
 */
const CLAIMED_EMITTER_FIELD: Readonly<Record<string, string>> = {
  JOIN: 'agent', LEAVE: 'agent', VOTE: 'agent',
  CLAIM: 'by', DECISION: 'by',
  GO: 'from', ADVICE: 'from', CORRECT: 'agent',
  // PRUNE is intentionally absent: the grammar registry gives it no self-emitter
  // field (only branch/files). Its R-c ownership is enforced against each
  // existing claim's `by` inside the PRUNE case, not a self-declared field.
};

// ---------------------------------------------------------------------------
// ResolveSession
// ---------------------------------------------------------------------------

export class ResolveSession {
  /** Canonical events log — append-only, ordered by lineIndex */
  readonly events: ReadonlyArray<TagEvent>;

  // Derived indexes (computed by fold, exposed read-only)
  readonly sessionId: string | undefined;
  readonly repo: string | undefined;
  readonly incident: string | undefined;
  readonly openedBy: string | undefined;
  readonly proto: string | undefined;
  readonly outcome: SessionOutcome;

  readonly agents: ReadonlyMap<string, AgentRecord>;
  /** Last vote per agent. An agent that changes its vote replaces the previous. */
  readonly votes: ReadonlyMap<string, VoteRecord>;
  /** Active claims by surface (pruned claims are excluded). */
  readonly claims: ReadonlyMap<string, ClaimRecord>;
  /** Latest STATE tag — the ground truth for repo/branch/sha. */
  readonly state: StateRecord | undefined;
  /** Latest EVIDENCE tag. */
  readonly evidence: EvidenceRecord | undefined;
  /** All DECISION records (a session may reach multiple partial decisions). */
  readonly decisions: ReadonlyArray<DecisionRecord>;
  /** All COLLISION records (audit trail). */
  readonly collisions: ReadonlyArray<CollisionRecord>;
  /** All VERIFY records — §16 reward ground truth. */
  readonly verifications: ReadonlyArray<VerifyRecord>;
  /** All ADVICE records from Sangit (read by the §16 reward at CLOSE). */
  readonly advice: ReadonlyArray<AdviceRecord>;
  /** Warnings emitted during fold (e.g. unknown tag, missing required field, spoofed author). */
  readonly warnings: ReadonlyArray<string>;

  private constructor(
    events: ReadonlyArray<TagEvent>,
    idx: ReturnType<typeof buildIndexes>,
  ) {
    this.events = events;
    this.sessionId = idx.sessionId;
    this.repo = idx.repo;
    this.incident = idx.incident;
    this.openedBy = idx.openedBy;
    this.proto = idx.proto;
    this.outcome = idx.outcome;
    this.agents = idx.agents;
    this.votes = idx.votes;
    this.claims = idx.claims;
    this.state = idx.state;
    this.evidence = idx.evidence;
    this.decisions = idx.decisions;
    this.collisions = idx.collisions;
    this.verifications = idx.verifications;
    this.advice = idx.advice;
    this.warnings = idx.warnings;
  }

  // ---------------------------------------------------------------------------
  // Factory methods
  // ---------------------------------------------------------------------------

  /** Build a ResolveSession from a list of already-parsed TagEvents. */
  static from(events: TagEvent[]): ResolveSession {
    return new ResolveSession(events, buildIndexes(events));
  }

  /** Return a new session with additional events appended (immutable extend). */
  append(newEvents: TagEvent[]): ResolveSession {
    const merged = [...this.events, ...newEvents];
    return ResolveSession.from(merged);
  }

  // ---------------------------------------------------------------------------
  // Query helpers
  // ---------------------------------------------------------------------------

  /** All active (non-pruned) claims for a given surface. */
  claimOn(surface: string): ClaimRecord | undefined {
    return this.claims.get(surface);
  }

  /** Check if a surface has an open claim by an agent OTHER than `by`. */
  hasConflictingClaim(surface: string, by: string): boolean {
    const c = this.claims.get(surface);
    return c !== undefined && c.by !== by;
  }

  /** True if a quorum of agents have voted for the same action. */
  hasConsensus(requiredAgents = 2): { reached: boolean; action?: string } {
    const tally = new Map<string, number>();
    for (const v of this.votes.values()) {
      tally.set(v.action, (tally.get(v.action) ?? 0) + 1);
    }
    for (const [action, count] of tally) {
      if (count >= requiredAgents) return { reached: true, action };
    }
    return { reached: false };
  }

  /** Agents currently in the session (joined, not left). */
  get activeAgents(): AgentRecord[] {
    return [...this.agents.values()].filter(a => a.leftAt === undefined);
  }

  /** True if the session has been formally closed. */
  get isClosed(): boolean {
    return this.outcome !== 'open';
  }

  /** Latest VERIFY for a given step (or the latest overall if `step` omitted). */
  verifyAt(step?: number): VerifyRecord | undefined {
    const matches = step === undefined
      ? this.verifications
      : this.verifications.filter(v => v.n === step);
    return matches.length ? matches[matches.length - 1] : undefined;
  }

  /**
   * Wake-8 transitions appended since `prev` — the subscription surface for the
   * T6 wake-predicate and the Sangit subscriber (G3). `prev` MUST be an earlier
   * snapshot of THIS session (a prefix). The new events are the suffix beyond
   * `prev.events.length` — `append()` only ever appends, so this needs no
   * assumption about `lineIndex` being monotonic or contiguous.
   */
  diff(prev: ResolveSession): Transition[] {
    // N2: enforce the prefix contract instead of silently returning a wrong
    // window. The wake path (T6 predicate / Sangit) must never miss a transition.
    if (prev.events.length > this.events.length) {
      throw new Error('diff(): prev is longer than this — not a prior snapshot');
    }
    const boundary = prev.events.length - 1;
    if (boundary >= 0 && this.events[boundary] !== prev.events[boundary]) {
      throw new Error('diff(): prev is not a prefix of this — stale or unrelated snapshot');
    }
    return this.events
      .slice(prev.events.length)
      .filter(e => WAKE_8.has(e.tagName))
      .map(e => ({ tagName: e.tagName, lineIndex: e.lineIndex, event: e }));
  }

  /** Summary line for logging / hive signals. */
  get summary(): string {
    const agents = this.activeAgents.map(a => a.name).join(', ');
    return `session=${this.sessionId ?? '?'} repo=${this.repo ?? '?'} ` +
      `incident=${this.incident ?? '?'} outcome=${this.outcome} ` +
      `agents=[${agents}] votes=${this.votes.size} claims=${this.claims.size}`;
  }
}

// ---------------------------------------------------------------------------
// Internal: deterministic fold over the event log
// ---------------------------------------------------------------------------

interface Indexes {
  sessionId: string | undefined;
  repo: string | undefined;
  incident: string | undefined;
  openedBy: string | undefined;
  proto: string | undefined;
  outcome: SessionOutcome;
  agents: Map<string, AgentRecord>;
  votes: Map<string, VoteRecord>;
  claims: Map<string, ClaimRecord>;
  state: StateRecord | undefined;
  evidence: EvidenceRecord | undefined;
  decisions: DecisionRecord[];
  collisions: CollisionRecord[];
  verifications: VerifyRecord[];
  advice: AdviceRecord[];
  warnings: string[];
}

function buildIndexes(events: ReadonlyArray<TagEvent>): Indexes {
  const idx: Indexes = {
    sessionId: undefined,
    repo: undefined,
    incident: undefined,
    openedBy: undefined,
    proto: undefined,
    outcome: 'open',
    agents: new Map(),
    votes: new Map(),
    claims: new Map(),
    state: undefined,
    evidence: undefined,
    decisions: [],
    collisions: [],
    verifications: [],
    advice: [],
    warnings: [],
  };

  for (const ev of events) {
    try {
      applyEvent(ev, idx);
    } catch (err) {
      idx.warnings.push(`[fold] line ${ev.lineIndex} ${ev.tagName}: ${(err as Error).message}`);
    }
  }

  return idx;
}

function applyEvent(ev: TagEvent, idx: Indexes): void {
  const f = ev.fields;

  // G1 / Floor-F2 (spec §14.3): if the transport stamped an authenticated
  // `author`, a keyed mutation is applied only when it matches the tag's claimed
  // emitter. A mismatch is a spoofed emitter — drop the mutation but keep the
  // event in the canonical log (the caller already appended it). A falsy author
  // (undefined/null = pre-T6 transport, or "" = transport saw no author) skips
  // enforcement for back-compat — T6 must stamp null, not "", for "unknown".
  const claimField = CLAIMED_EMITTER_FIELD[ev.tagName];
  if (claimField && ev.author) {
    const claimed = f[claimField];
    if (claimed && claimed !== ev.author) {
      idx.warnings.push(
        `[fold] line ${ev.lineIndex} ${ev.tagName}: author "${ev.author}" != ` +
        `${claimField}="${claimed}" — spoofed emitter, mutation rejected ` +
        `(F2/§14.3); event retained in log`,
      );
      return;
    }
  }

  switch (ev.tagName) {
    case 'SESSION': {
      // First SESSION wins (subsequent are ignored with a warning)
      if (idx.sessionId !== undefined) {
        idx.warnings.push(`[fold] line ${ev.lineIndex}: duplicate SESSION — ignoring`);
        break;
      }
      idx.sessionId = f['id'];
      idx.repo = f['repo'];
      idx.incident = f['incident'];
      idx.openedBy = f['opened_by'];
      idx.proto = f['proto'];
      break;
    }

    case 'CLOSE': {
      idx.outcome = (f['outcome'] as SessionOutcome) ?? 'resolved';
      break;
    }

    case 'JOIN': {
      const name = f['agent'];
      if (!name) break;
      idx.agents.set(name, {
        name,
        machine: f['machine'] ?? '',
        role: f['role'] ?? 'observer',
        joinedAt: ev.lineIndex,
      });
      break;
    }

    case 'LEAVE': {
      const name = f['agent'];
      if (!name) break;
      const rec = idx.agents.get(name);
      if (rec) {
        idx.agents.set(name, { ...rec, leftAt: ev.lineIndex, leftReason: f['reason'] });
      }
      break;
    }

    case 'STATE': {
      const rawFiles = f['files'] ?? '';
      const files = parsePaths(rawFiles).map(normalizePath);
      idx.state = {
        repo: f['repo'] ?? idx.repo ?? '',
        branch: f['branch'] ?? '',
        sha: f['sha'] ?? '',
        expected: f['expected'],
        conflict: f['conflict'],
        files,
        lineIndex: ev.lineIndex,
      };
      break;
    }

    case 'EVIDENCE': {
      idx.evidence = {
        scan: f['scan'],
        prsConsumed: f['prs_consumed'] ? parseInt(f['prs_consumed'], 10) : undefined,
        contentLoss: f['content_loss'] === 'yes' ? true
          : f['content_loss'] === 'no' ? false : undefined,
        ci: f['ci'] as EvidenceRecord['ci'],
        diffStat: f['diff_stat'],
        lineIndex: ev.lineIndex,
      };
      break;
    }

    case 'VOTE': {
      const agent = f['agent'];
      if (!agent) break;
      // Last vote per agent replaces previous (agent may change their mind)
      idx.votes.set(agent, {
        agent,
        action: f['action'] ?? '',
        confidence: (f['confidence'] ?? 'medium') as VoteRecord['confidence'],
        form: f['form'],
        extra: f['extra'],
        lineIndex: ev.lineIndex,
      });
      break;
    }

    case 'CLAIM': {
      const surface = f['surface'];
      if (!surface) break;
      // `by` is required (grammar §6). Warn-but-keep (audit/training), mirroring
      // DECISION. A by-less claim has no verifiable owner — PRUNE then denies any
      // authenticated non-self prune of it (N1), so it can't be silently hijacked.
      if (!f['by']) {
        idx.warnings.push(`[fold] line ${ev.lineIndex} CLAIM: missing required field "by"`);
      }
      // First valid claim on a surface wins (F4 floor)
      if (!idx.claims.has(surface)) {
        idx.claims.set(surface, {
          by: f['by'] ?? '',
          surface,
          unit: f['unit'],
          ttl: f['ttl'],
          lineIndex: ev.lineIndex,
        });
      }
      break;
    }

    case 'PRUNE': {
      // De-register the merged branch's claims.
      const branch = f['branch'];
      const files = f['files'] ? parsePaths(f['files']).map(normalizePath) : [];
      for (const [surface, claim] of idx.claims) {
        if (claim.pruned) continue;
        const matchesBranch = branch && surface === branch;
        const matchesFile = files.length > 0 && files.includes(normalizePath(surface));
        if (!matchesBranch && !matchesFile) continue;
        // R-c: only the claim's owner may prune it. (A gitops-authority override
        // is a COORD-PROTOCOL policy decision, not yet wired — see scope doc G1.)
        // When author is unknown (pre-T6), enforcement is skipped for back-compat.
        // N1: deny when the author is known but ownership can't be confirmed —
        // including a claim with an empty/unknown `by` (otherwise it would be
        // prunable by anyone, the original N1 hole).
        if (ev.author && claim.by !== ev.author) {
          const reason = claim.by
            ? `author "${ev.author}" does not own claim "${surface}" (by="${claim.by}")`
            : `author "${ev.author}" cannot prune claim "${surface}" with unverifiable owner (no by)`;
          idx.warnings.push(`[fold] line ${ev.lineIndex} PRUNE: ${reason} — prune rejected (R-c)`);
          continue;
        }
        idx.claims.set(surface, { ...claim, pruned: true });
      }
      break;
    }

    case 'DECISION': {
      if (!f['rationale']) {
        idx.warnings.push(`[fold] line ${ev.lineIndex} DECISION: missing required field "rationale"`);
      }
      let steps: number | undefined;
      if (f['steps_completed'] !== undefined) {
        if (/^\d+$/.test(f['steps_completed'])) {
          steps = +f['steps_completed'];
        } else {
          idx.warnings.push(`[fold] line ${ev.lineIndex} DECISION: steps_completed "${f['steps_completed']}" not a non-negative integer`);
        }
      }
      idx.decisions.push({
        outcome: f['outcome'] ?? '',
        by: f['by'] ?? '',
        rationale: f['rationale'] ?? '',
        steps_completed: steps,
        action: f['action'],
        session: f['session'],
        lineIndex: ev.lineIndex,
      });
      break;
    }

    case 'COLLISION': {
      idx.collisions.push({
        type: f['type'] ?? '',
        surfaces: f['surfaces'] ? parsePaths(f['surfaces']) : [],
        agents: f['agents'] ? f['agents'].split(',').map(s => s.trim()) : [],
        lineIndex: ev.lineIndex,
      });
      break;
    }

    case 'VERIFY': {
      // §16 reward ground truth + a wake-8 transition.
      idx.verifications.push({
        n: f['n'] ? parseInt(f['n'], 10) : undefined,
        agent: f['agent'] ?? '',
        checks: f['checks'] ? f['checks'].split(',').map(s => s.trim()).filter(Boolean) : [],
        result: (f['result'] ?? '') as VerifyRecord['result'],
        sha: f['sha'],
        lineIndex: ev.lineIndex,
      });
      break;
    }

    case 'ADVICE': {
      // Not a wake-8 tag, but the §16 reward reads Sangit's advice at CLOSE.
      // confidence is an integer 0-100 for ADVICE (vs the VOTE enum) — grammar §6.
      let confidence: number | undefined;
      if (f['confidence'] !== undefined) {
        const raw = f['confidence'];
        // Must be a pure non-negative integer 0-100 (grammar §6). parseInt is too
        // lenient — "62.5"/"62abc" would silently coerce to 62; reject them.
        if (/^\d+$/.test(raw) && +raw >= 0 && +raw <= 100) {
          confidence = +raw;
        } else {
          idx.warnings.push(`[fold] line ${ev.lineIndex} ADVICE: confidence "${raw}" not an integer 0-100`);
        }
      }
      idx.advice.push({
        from: f['from'] ?? '',
        verdict: f['verdict'] ?? '',
        confidence,
        pattern: f['pattern'],
        salt: f['salt'],
        msg: f['msg'],
        rule: f['rule'],
        lineIndex: ev.lineIndex,
      });
      break;
    }

    // These tags are recorded in the event log but don't mutate derived indexes:
    // GO, STEP, CLEAR, RATIFY, RESOURCE, CORRECT, COMMENT, WIP
    // Consumers read them directly from session.events filtered by tagName.
    default:
      break;
  }
}
