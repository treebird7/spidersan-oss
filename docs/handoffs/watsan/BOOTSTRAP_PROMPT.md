# Watsan Bootstrap Prompt

> **Copy this entire prompt to a new Claude Code session in the Watsan repo**

---

## Context

You are bootstrapping **Watsan** (wsan) - the collective brain and orchestrator for the Treebird ecosystem. Watsan coordinates AI agents across repositories and use cases.

**Treebird Ecosystem:**
- **Watsan** (this project): Orchestrator/brain - schedules tasks, generates prompts, dispatches to agents
- **Spidersan** (ssan): Branch coordination CLI - prevents merge conflicts between AI agents
- **Myceliumail** (mycm): Encrypted messaging system for inter-agent communication
- **Mappersan** (maps): Repo analysis and CLAUDE.md generation

**Your Identity:**
- Agent ID: `wsan`
- Role: Building the orchestrator that will eventually orchestrate agents like you

---

## Your Mission

Build Phase 0 + Phase 1 of Watsan:

### Phase 0: Prerequisites (work with Myceliumail team separately)
- [ ] Spec for mycmail push notifications
- [ ] Spec for work session workflow (`watsan sync`)

### Phase 1: Foundation
- [ ] Initialize TypeScript project with Commander.js CLI
- [ ] Create Supabase schema (projects, tasks, agent_sessions tables)
- [ ] Implement basic commands: `status`, `sync`, `tasks`
- [ ] Set up MCP server skeleton
- [ ] Create documentation structure

---

## Task 1: Project Setup

```bash
# Initialize the project
npm init -y

# Install dependencies
npm install commander @supabase/supabase-js @modelcontextprotocol/sdk dotenv chalk

# Install dev dependencies
npm install -D typescript @types/node tsx eslint @typescript-eslint/eslint-plugin @typescript-eslint/parser

# Initialize TypeScript
npx tsc --init
```

Update `package.json`:
```json
{
  "name": "watsan",
  "version": "0.1.0",
  "description": "The collective brain - AI agent orchestrator for Treebird ecosystem",
  "type": "module",
  "bin": {
    "watsan": "./dist/bin/watsan.js"
  },
  "scripts": {
    "build": "tsc",
    "dev": "tsx src/bin/watsan.ts",
    "start": "node dist/bin/watsan.js",
    "lint": "eslint src/",
    "test": "echo 'No tests yet'"
  }
}
```

Update `tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "declaration": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

---

## Task 2: Create Directory Structure

```
src/
├── bin/watsan.ts              # CLI entry point
├── commands/
│   ├── index.ts               # Command registry
│   ├── status.ts              # Show ecosystem overview
│   ├── sync.ts                # Agent context sync
│   └── tasks.ts               # Task management
├── core/
│   ├── scheduler.ts           # Task scheduling (stub)
│   └── prompt-gen.ts          # Prompt generator (stub)
├── storage/
│   ├── supabase.ts            # Supabase adapter
│   └── factory.ts             # Storage factory
├── mcp/
│   └── server.ts              # MCP server (stub)
└── lib/
    ├── config.ts              # Config loading
    └── types.ts               # Type definitions
```

---

## Task 3: Supabase Schema

Create `supabase/migrations/20251217000001_watsan_schema.sql`:

```sql
-- Watsan schema
CREATE SCHEMA IF NOT EXISTS watsan;

-- Projects table
CREATE TABLE IF NOT EXISTS watsan.projects (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    repo_url TEXT,
    repo_path TEXT,
    description TEXT,
    status TEXT DEFAULT 'active',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Tasks table with hierarchy
CREATE TABLE IF NOT EXISTS watsan.tasks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID REFERENCES watsan.projects(id) ON DELETE CASCADE,
    parent_task_id UUID REFERENCES watsan.tasks(id) ON DELETE SET NULL,
    title TEXT NOT NULL,
    description TEXT,
    status TEXT DEFAULT 'pending',  -- pending, assigned, in_progress, blocked, done
    assigned_agent TEXT,
    priority INTEGER DEFAULT 0,
    depends_on UUID[] DEFAULT '{}',
    scheduled_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    prompt TEXT,
    context JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Agent sessions
CREATE TABLE IF NOT EXISTS watsan.agent_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    agent_id TEXT NOT NULL,
    project_id UUID REFERENCES watsan.projects(id) ON DELETE CASCADE,
    repo_path TEXT,
    branch TEXT,
    status TEXT DEFAULT 'active',  -- active, idle, blocked, finished
    current_task_id UUID REFERENCES watsan.tasks(id) ON DELETE SET NULL,
    last_heartbeat TIMESTAMPTZ DEFAULT NOW(),
    context JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_tasks_project ON watsan.tasks(project_id);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON watsan.tasks(status);
CREATE INDEX IF NOT EXISTS idx_tasks_assigned ON watsan.tasks(assigned_agent);
CREATE INDEX IF NOT EXISTS idx_sessions_agent ON watsan.agent_sessions(agent_id);

-- RLS policies
ALTER TABLE watsan.projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE watsan.tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE watsan.agent_sessions ENABLE ROW LEVEL SECURITY;

-- Allow all operations for authenticated users (adjust as needed)
CREATE POLICY "Allow all for projects" ON watsan.projects FOR ALL USING (true);
CREATE POLICY "Allow all for tasks" ON watsan.tasks FOR ALL USING (true);
CREATE POLICY "Allow all for sessions" ON watsan.agent_sessions FOR ALL USING (true);
```

---

## Task 4: Implement Core CLI

### `src/bin/watsan.ts`
```typescript
#!/usr/bin/env node
import { Command } from 'commander';
import { registerCommands } from '../commands/index.js';
import { loadConfig } from '../lib/config.js';
import 'dotenv/config';

const program = new Command();

program
  .name('watsan')
  .description('The collective brain - AI agent orchestrator')
  .version('0.1.0');

// Load config and register commands
await loadConfig();
registerCommands(program);

program.parse();
```

### `src/commands/status.ts`
```typescript
import { Command } from 'commander';
import { getStorage } from '../storage/factory.js';

export function registerStatusCommand(program: Command): void {
  program
    .command('status')
    .description('Show ecosystem overview')
    .action(async () => {
      const storage = await getStorage();
      
      console.log('🧠 Watsan Mission Control\n');
      
      const projects = await storage.listProjects();
      console.log(`📁 Projects: ${projects.length}`);
      
      const tasks = await storage.listTasks();
      const pending = tasks.filter(t => t.status === 'pending').length;
      const inProgress = tasks.filter(t => t.status === 'in_progress').length;
      const done = tasks.filter(t => t.status === 'done').length;
      
      console.log(`📋 Tasks: ${pending} pending, ${inProgress} in progress, ${done} done`);
      
      const sessions = await storage.listSessions();
      const active = sessions.filter(s => s.status === 'active').length;
      console.log(`🤖 Active agents: ${active}`);
    });
}
```

---

## Task 5: Environment Setup

Create `.env.example`:
```bash
# Supabase
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_KEY=your-anon-key

# Agent identity
WATSAN_AGENT_ID=wsan
MYCELIUMAIL_AGENT_ID=wsan
```

---

## Deliverables

When complete, you should have:
1. ✅ Working CLI with `watsan status` command
2. ✅ Supabase migration ready to apply
3. ✅ TypeScript project building successfully
4. ✅ Basic project structure in place
5. ✅ CLAUDE.md and documentation

---

## Communication

Report progress via Myceliumail:
```bash
mycmail send treebird "Watsan Progress" --message "Phase 1 complete: [details]"
```

If you hit a junction (decision point), alert:
```bash
mycmail send treebird "JUNCTION: [question]" --message "[context and options]"
```

---

## References

- **Spidersan CLAUDE.md**: Pattern for CLI structure and storage adapters
- **Myceliumail**: Use `mycmail` for inter-agent communication
- **Implementation Plan**: Full architecture details in docs/IMPLEMENTATION_PLAN.md

Good luck! 🧠🕸️
