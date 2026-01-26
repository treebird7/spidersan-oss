# FlockView + Spidersan Integration

> How FlockView can auto-sync collabs to prevent merge conflicts

Note: `collab-sync` is an ecosystem-only command.

---

## Quick Start

```bash
# When user opens collab
spidersan collab-sync --pre --json

# When user saves/closes
spidersan collab-sync --post --json --agent "flockview"
```

---

## API Response Format

### Pre-edit (`--pre`)
```json
{
  "success": true,
  "action": "pre",
  "branch": "main",
  "stashed": true,    // Had uncommitted changes
  "pulled": true,     // Got latest from remote
  "popped": true,     // Restored local changes
  "conflicts": false  // No merge conflicts
}
```

### Post-edit (`--post`)
```json
{
  "success": true,
  "action": "post",
  "branch": "main",
  "staged": true,     // Files added to git
  "committed": true,  // Changes committed
  "pushed": true,     // Pushed to remote
  "files": ["collab/2026-01-16-daily.md"]
}
```

---

## Integration Code (TypeScript)

```typescript
import { exec } from 'child_process';
import { promisify } from 'util';
const execAsync = promisify(exec);

interface SyncResult {
  success: boolean;
  action: 'pre' | 'post';
  conflicts?: boolean;
  pushed?: boolean;
  error?: string;
}

async function collabSync(action: 'pre' | 'post', agent?: string): Promise<SyncResult> {
  const cmd = agent 
    ? `spidersan collab-sync --${action} --json --agent "${agent}"`
    : `spidersan collab-sync --${action} --json`;
  
  const { stdout } = await execAsync(cmd, { cwd: '/path/to/repo' });
  return JSON.parse(stdout);
}

// FlockView usage
async function onCollabOpen() {
  const result = await collabSync('pre');
  if (result.conflicts) {
    showConflictWarning();
  }
}

async function onCollabSave(agentId: string) {
  const result = await collabSync('post', agentId);
  if (result.pushed) {
    showSyncSuccess();
  }
}
```

---

## Options

| Flag | Description |
|------|-------------|
| `--pre` | Pull latest before editing |
| `--post` | Commit and push after editing |
| `--json` | Output as JSON (required for API) |
| `--agent <name>` | Agent name for commit message |
| `--pattern <glob>` | File pattern (default: `collab/*.md`) |

---

## Error Handling

```json
// Conflict detected
{
  "success": false,
  "action": "pre",
  "conflicts": true,
  "error": "Conflicts detected"
}
```

FlockView should show a warning and let user resolve manually.

---

*Questions? Ask Spidersan in daily collab!* 🕷️
