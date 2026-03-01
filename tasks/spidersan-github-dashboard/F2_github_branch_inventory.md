# F2: GitHub Branch Inventory — API-Aware Branch State

## Objective

Fetch branch, PR, and CI status from GitHub for all configured repos, storing the result in Supabase so any machine can see the full picture without running `git fetch` everywhere.

## Context

**Problem:** Local registries only know about branches that were manually registered via `spidersan register`. Unregistered remote branches (sentinel security fixes, bot PRs, etc.) are invisible. Today's session found 10 unregistered branches with active work — discovered only by manually scanning git remotes.

**Existing infra:**
- GitHub MCP Server already connected (list_branches, list_pull_requests, get_commit, actions_list, get_job_logs)
- `gh` CLI available on all machines
- SpiderSan MCP `create_pr` tool already creates PRs
- Supabase `spider_registries` from F1

**Key insight (Feb 19 session):** The manual audit we did today — checking push status, finding unregistered branches, discovering fresh sentinel fixes — is exactly what this feature automates.

## Files to Read

- `src/storage/supabase.ts` — Supabase adapter (F1 extensions)
- `src/commands/sync.ts` — Existing `spidersan sync` command (syncs registry with local git)
- `src/commands/conflicts.ts` — Conflict detection logic (reuse tier system)
- `package.json` — Check for `@octokit/rest` or similar

## Files to Create/Modify

- **Create:** `src/commands/github-sync.ts` — New `spidersan github-sync` command
- **Create:** `src/lib/github.ts` — GitHub API client (wraps `gh` CLI or Octokit)
- **Create:** `supabase/migrations/005_spider_github_branches.sql` — GitHub branch state table
- **Modify:** `src/bin/spidersan.ts` — Register new command
- **Create:** `tests/github-inventory.test.ts`

## Deliverables

### 1. SQL Migration: `spider_github_branches` table

```sql
CREATE TABLE spider_github_branches (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    repo_owner TEXT NOT NULL,           -- e.g. "treebird7"
    repo_name TEXT NOT NULL,            -- e.g. "spidersan-oss"
    branch_name TEXT NOT NULL,
    last_commit_sha TEXT,
    last_commit_date TIMESTAMPTZ,
    last_commit_author TEXT,
    last_commit_message TEXT,
    ahead_of_main INT DEFAULT 0,
    behind_main INT DEFAULT 0,
    
    -- PR state
    pr_number INT,
    pr_state TEXT,                      -- open, closed, merged
    pr_title TEXT,
    pr_draft BOOLEAN DEFAULT false,
    pr_review_status TEXT,              -- approved, changes_requested, pending
    
    -- CI state
    ci_status TEXT,                     -- success, failure, pending, none
    ci_conclusion TEXT,                 -- per last workflow run
    ci_url TEXT,
    
    -- Spidersan mapping
    registered BOOLEAN DEFAULT false,   -- exists in spider_registries?
    registry_machine_id TEXT,           -- which machine registered it?
    conflict_tier INT,                  -- 1=WARN, 2=PAUSE, 3=BLOCK
    
    -- Metadata
    is_stale BOOLEAN DEFAULT false,     -- no activity > 7 days
    age_days INT,
    fetched_at TIMESTAMPTZ DEFAULT NOW(),
    
    UNIQUE(repo_owner, repo_name, branch_name)
);

CREATE INDEX idx_sgb_repo ON spider_github_branches(repo_owner, repo_name);
CREATE INDEX idx_sgb_stale ON spider_github_branches(is_stale);
CREATE INDEX idx_sgb_pr ON spider_github_branches(pr_number) WHERE pr_number IS NOT NULL;
CREATE INDEX idx_sgb_ci ON spider_github_branches(ci_status);
```

### 2. GitHub API client

```typescript
// src/lib/github.ts
export interface GitHubBranchInfo {
    name: string;
    lastCommit: { sha: string; date: string; author: string; message: string };
    aheadBehind: { ahead: number; behind: number };
    pr?: { number: number; state: string; title: string; draft: boolean; reviewStatus: string };
    ci?: { status: string; conclusion: string; url: string };
}

export interface RepoConfig {
    owner: string;
    name: string;
}

// Uses `gh` CLI (available on all machines, already authenticated)
export async function fetchBranches(repo: RepoConfig): Promise<GitHubBranchInfo[]>;
export async function fetchPRs(repo: RepoConfig): Promise<PRInfo[]>;
export async function fetchCIStatus(repo: RepoConfig, branch: string): Promise<CIInfo>;

// Match GitHub branches to local registry
export function mapToRegistry(
    githubBranches: GitHubBranchInfo[],
    registryBranches: BranchRecord[]
): MappedBranch[];
```

**Implementation:** Use `gh api` for reliability — it handles auth, pagination, rate limits:
```bash
gh api repos/{owner}/{repo}/branches --paginate --jq '.[].name'
gh api repos/{owner}/{repo}/pulls?state=open --paginate
gh api repos/{owner}/{repo}/actions/runs?per_page=5
```

### 3. New command: `spidersan github-sync`

```typescript
export function githubSyncCommand(program: Command): void {
    program
        .command('github-sync')
        .description('Fetch branch/PR/CI status from GitHub for configured repos')
        .option('--repo <owner/name>', 'Sync specific repo (default: current)')
        .option('--all', 'Sync all configured repos from .spidersan/repos.json')
        .option('--unregistered', 'Show only branches not in spidersan registry')
        .option('--ci', 'Include CI/Actions status (slower)')
        .option('--stale-days <n>', 'Mark branches older than N days as stale', '7')
        .option('--json', 'Output as JSON')
        .action(async (options) => { ... });
}
```

**Output example:**
```
🕷️ GitHub sync: treebird7/spidersan-oss (29 branches)

  ✅ Registered (22):
    main                          ✓ CI:pass  PR:—      M2
    fix/salvage-sentinel-gaps     ✓ CI:pass  PR:—      M2     ← NEW
    wave0-hygiene-sasusan         ✓ CI:fail  PR:#18    M2

  ⚠️  Unregistered (7):
    sentinel/fix-stale-path-*     CI:pass  PR:#20  5hrs ago   ← register?
    perf/ast-traversal-*          CI:pass  PR:#19  20hrs ago  ← register?
    copilot/fix-git-injection-*   CI:—     PR:—    27hrs ago

  🔴 Stale (4 weeks+):
    demo-gif-codex                CI:—  PR:—  abandoned
    security-hardening-codex      CI:—  PR:—  abandoned
```

### 4. Repo configuration: `.spidersan/repos.json`

```json
{
  "repos": [
    { "owner": "treebird7", "name": "spidersan-oss" },
    { "owner": "treebird7", "name": "toak" },
    { "owner": "treebird7", "name": "Envoak" },
    { "owner": "treebird7", "name": "myceliumail" },
    { "owner": "treebird7", "name": "invoak" },
    { "owner": "treebird7", "name": "Sasusan" },
    { "owner": "treebird7", "name": "mappersan" }
  ],
  "defaults": {
    "staleDays": 7,
    "includeCi": true
  }
}
```

## Test Cases

| Test | Expected |
|------|----------|
| Fetch branches for single repo | Returns all remote branches with metadata |
| Match GitHub branches to registry | Correctly identifies registered vs unregistered |
| PR status mapping | Open PRs show number, title, review status |
| CI status mapping | Last workflow run status shown per branch |
| Stale detection | Branches > N days marked stale |
| No `gh` CLI → graceful error | "GitHub CLI (gh) not found. Install: https://cli.github.com" |
| Rate limit handling | Backs off and retries on 403 |
| `--all` flag syncs configured repos | Iterates repos.json, aggregates results |
| Store to Supabase | Upserts into spider_github_branches |

## Constraints

- Must use `gh` CLI (already authenticated, handles SSO/2FA)
- Supabase storage is optional (works local-only with console output)
- Rate limits: respect GitHub's 5000/hr for authenticated requests
- CI fetch is opt-in (`--ci`) because it's slower (extra API calls per branch)
- Must not require GitHub MCP Server running (uses `gh` CLI directly)

## Definition of Done

- [ ] `spidersan github-sync` shows all branches for current repo
- [ ] `--unregistered` flag highlights branches missing from registry
- [ ] PR status and CI status shown when available
- [ ] Results stored in Supabase `spider_github_branches` table
- [ ] Works with `--all` across multiple repos from `repos.json`
- [ ] Tests pass
- [ ] Handles missing `gh` CLI gracefully
