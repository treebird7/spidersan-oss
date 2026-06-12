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

// ---------------------------------------------------------------------------
// Session outcome
// ---------------------------------------------------------------------------

export type SessionOutcome =
  | 'resolved'
  | 'abandoned'
  | 'deferred'
  | 'partial'
  | 'open';   // not yet closed

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
  /** Warnings emitted during fold (e.g. unknown tag, missing required field). */
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
      // De-register the merged branch's claims
      const branch = f['branch'];
      const files = f['files'] ? parsePaths(f['files']).map(normalizePath) : [];
      for (const [surface, claim] of idx.claims) {
        if (claim.pruned) continue;
        const matchesBranch = branch && surface === branch;
        const matchesFile = files.length > 0 && files.includes(normalizePath(surface));
        if (matchesBranch || matchesFile) {
          idx.claims.set(surface, { ...claim, pruned: true });
        }
      }
      break;
    }

    case 'DECISION': {
      idx.decisions.push({
        outcome: f['outcome'] ?? '',
        by: f['by'] ?? '',
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

    // These tags are recorded in the event log but don't mutate derived indexes:
    // GO, STEP, ADVICE, CLEAR, RATIFY, RESOURCE, CORRECT, COMMENT, WIP
    // Consumers read them directly from session.events filtered by tagName.
    default:
      break;
  }
}
