# Copilot Instructions for Spidersan

Spidersan is a branch coordination CLI that prevents merge conflicts when multiple AI agents (Claude Code, Cursor, Copilot) work on the same codebase simultaneously. It tracks which branches modify which files, detects overlapping work with a tiered conflict system (WARN/PAUSE/BLOCK), and recommends merge ordering.

## Build, Test, and Lint

```bash
npm run build          # TypeScript compilation (tsc)
npm run lint           # ESLint on src/**/*.ts
npm run typecheck      # tsc --noEmit
npm test               # Vitest in watch mode
npm run test:run       # Vitest single run (CI)
npm run test:coverage  # Vitest with v8 coverage

# Run a single test file
npx vitest run tests/core.test.ts

# Run tests matching a pattern
npx vitest run -t "should register a branch"
```

## Architecture

### Storage Adapter Pattern

The core abstraction is `StorageAdapter` (`src/storage/adapter.ts`) — an interface with methods like `list()`, `register()`, `get()`, `findByFiles()`. Two implementations exist:

- **`LocalStorage`** (`src/storage/local.ts`) — default, stores branch registry in `.spidersan/registry.json`
- **`SupabaseStorage`** (`src/storage/supabase.ts`) — optional cloud sync

`src/storage/factory.ts` auto-selects the backend: if `SUPABASE_URL` + `SUPABASE_KEY` env vars (or config equivalents) are set, it uses Supabase; otherwise local JSON.

### CLI Structure

- **Entry point**: `src/bin/spidersan.ts` — uses Commander.js, registers all commands, supports ecosystem plugin loading
- **Commands**: `src/commands/*.ts` — each file exports a `Command` instance (e.g., `registerCommand`, `conflictsCommand`). All re-exported through `src/commands/index.ts`
- **Ecosystem loader**: `src/commands/ecosystem-loader.ts` — dynamically loads additional commands from ecosystem plugins at runtime

### Message Tiers

Agent messaging has three tiers with separate storage adapters:

1. **Local** (`src/storage/local-messages.ts`) — single-machine JSON
2. **Git coordination branch** (`src/storage/git-messages.ts`) — orphan branch `spidersan/messages` for cross-machine sync
3. **Mycmail** (`src/storage/mycmail-adapter.ts`) — external Myceliumail integration

### MCP Server

A separate MCP server lives in `mcp-server/` with its own `package.json`, `tsconfig.json`, and build. It wraps CLI functionality for use as an MCP tool provider.

## Key Conventions

### ESM with `.js` Extensions

The project uses TypeScript with `"module": "NodeNext"` and `"moduleResolution": "NodeNext"`. All source imports must use `.js` extensions, even when importing `.ts` files:

```typescript
// ✅ Correct
import { getStorage } from '../storage/index.js';
import { loadConfig } from '../lib/config.js';

// ❌ Wrong
import { getStorage } from '../storage/index';
import { loadConfig } from '../lib/config.ts';
```

### Security: Input Validation and Shell Safety

- Validate all user inputs with functions from `src/lib/security.ts` (`validateAgentId`, `validateBranchName`, `validateTaskId`, `validateFilePath`)
- Use `execFileSync` or `spawnSync` with argument arrays — never `execSync` with string interpolation
- Use `fs` module methods (`mkdirSync`, `writeFileSync`) instead of shell commands (`mkdir`, `touch`)
- `deepMerge` in `src/lib/config.ts` guards against prototype pollution by skipping `__proto__`, `constructor`, `prototype` keys

### Error Handling

Use the structured error hierarchy in `src/lib/errors.ts`:

- `SpidersanError` (base, has `.code`)
- `StorageError` (has `.operation`)
- `ConfigError`, `GitError`, `SupabaseError`
- Use `formatError()` for CLI output, `handleError()` for fatal exits

### Command Pattern

Each command file exports a Commander `Command` instance. Pattern:

```typescript
import { Command } from 'commander';
import { getStorage } from '../storage/index.js';

export const myCommand = new Command('my-command')
    .description('What it does')
    .option('-f, --flag <value>', 'description')
    .action(async (options) => {
        const storage = await getStorage();
        // ...
    });
```

### Testing

- Tests live in `tests/` (core, security) and can also be in `src/**/*.test.ts`
- Use `vitest` with `describe`/`it`/`expect` from `vitest`
- Temp directories: use `os.tmpdir()` + unique suffix (e.g., `Date.now()`) for isolation
- Security tests mock `child_process` and `fs` to prevent real system operations
- Export internal functions via `_testable` objects when needed for testing (see `src/commands/config.ts`)

### Configuration

Config loads from (in priority order): `~/.spidersanrc`, then project-level `.spidersanrc` / `.spidersanrc.json` / `.spidersan.config.json`. User config deep-merges over defaults defined in `src/lib/config.ts`.

### Conflict Tiers

Files are classified into three tiers by regex patterns in the config and in `src/commands/conflicts.ts`:

| Tier | Action | Trigger Examples |
|------|--------|-----------------|
| 1 WARN | Proceed with caution | `.md`, `.json`, `.css` |
| 2 PAUSE | Coordinate first | tests, migrations, API routes |
| 3 BLOCK | Must resolve before proceeding | `.env`, `package.json`, auth/security files |
