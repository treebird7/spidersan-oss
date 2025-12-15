# Mappersan Starter Kit

> **Everything you need to bootstrap Mappersan from a fresh repo**

---

## Step 1: Create the Repository

```bash
mkdir mappersan && cd mappersan
git init
npm init -y
```

---

## Step 2: Inject CLAUDE.md (Spidermail Style)

Create this file first - it's the "injection" that gives any AI agent instant context:

```bash
cat > CLAUDE.md << 'EOF'
# Mappersan - AI Agent Context

> **Documentation Mapping CLI for AI-Agent-Ready Codebases**

## What is Mappersan?

Mappersan automatically generates tiered documentation that makes any project instantly understandable by AI coding agents. It analyzes codebases and produces:

- `CLAUDE.md` - Auto-loaded context (30 sec read)
- `docs/AGENT_GUIDE.md` - Quick reference (1 min)
- `docs/LIMITATIONS.md` - What it can't do
- `docs/USE_CASES.md` - Comprehensive scenarios

## Core Commands

```bash
mappersan init                    # Initialize in a project
mappersan analyze                 # Analyze codebase structure
mappersan generate                # Generate all documentation tiers
mappersan generate --tier 1       # Generate only CLAUDE.md
mappersan sync                    # Update docs based on code changes
mappersan validate                # Check if docs match codebase
mappersan diff                    # Show what changed since last generate
mappersan watch                   # Auto-regenerate on file changes
```

## Rescue Mode Integration

```bash
mappersan analyze --branch <name>     # Analyze specific branch
mappersan analyze --all-branches      # Analyze all branches
mappersan compare <branch1> <branch2> # Compare two branches
mappersan duplicates                  # Find duplicate code across branches
mappersan extract --components <list> # Extract components to manifest
mappersan report --to spidersan       # Send report via Myceliumail
```

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Mappersan CLI                             │
├─────────────────────────────────────────────────────────────┤
│  Commands: init | analyze | generate | sync | validate       │
├─────────────────────────────────────────────────────────────┤
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐  │
│  │  Analyzers  │  │ Generators  │  │     Validators      │  │
│  ├─────────────┤  ├─────────────┤  ├─────────────────────┤  │
│  │ Structure   │  │ CLAUDE.md   │  │ Command existence   │  │
│  │ Commands    │  │ AGENT_GUIDE │  │ Example validity    │  │
│  │ Limitations │  │ LIMITATIONS │  │ Drift detection     │  │
│  │ Patterns    │  │ USE_CASES   │  │ Link integrity      │  │
│  └─────────────┘  └─────────────┘  └─────────────────────┘  │
├─────────────────────────────────────────────────────────────┤
│  Language Adapters: TypeScript | Python | Go | Rust | Java   │
└─────────────────────────────────────────────────────────────┘
```

## Project Structure

```
src/
├── bin/mappersan.ts      # CLI entry point
├── commands/             # Command implementations
│   ├── init.ts
│   ├── analyze.ts
│   ├── generate.ts
│   ├── sync.ts
│   └── validate.ts
├── analyzers/            # Language-specific analyzers
│   ├── base.ts
│   ├── typescript.ts
│   └── ...
├── generators/           # Documentation generators
│   ├── claude-md.ts
│   ├── agent-guide.ts
│   ├── limitations.ts
│   └── use-cases.ts
└── lib/                  # Utilities
    ├── config.ts
    └── git.ts
```

## Key Interfaces

```typescript
interface AnalysisResult {
  projectType: 'cli' | 'api' | 'library' | 'app';
  language: string;
  commands: Command[];
  limitations: Limitation[];
  patterns: UsagePattern[];
  keyFiles: KeyFile[];
}

interface Command {
  name: string;
  description: string;
  arguments: Argument[];
  options: Option[];
  sourceFile: string;
  sourceLine: number;
}

interface Limitation {
  title: string;
  description: string;
  category: 'core' | 'feature' | 'storage' | 'integration';
  detectedFrom: 'code' | 'comment' | 'error';
  workaround?: string;
}
```

## Testing

```bash
npm test              # Run unit tests
npm run lint          # ESLint
npm run build         # TypeScript compilation
```

## Encryption (Myceliumail)

For encrypted messaging between agents:

\`\`\`bash
spidersan keygen                 # Generate keypair (required, run once per agent)
spidersan keys                    # List known public keys
spidersan key-import <key>        # Import another agent's public key
spidersan send <agent> <subject> --encrypt  # Send encrypted message
\`\`\`

Keys are stored in `~/.spidersan/keys/`. Encryption uses X25519 + XSalsa20-Poly1305 (tweetnacl).

## Related Projects

- **Spidersan** - Branch coordination CLI
- **Myceliumail** - Agent messaging system (E2E encrypted)
- **Recovery-Tree** - Agent state persistence

---

**Full roadmap:** See Spidersan repo `docs/MAPPERSAN_ROADMAP.md`
EOF
```

---

## Step 3: Bootstrap Prompt

Use this prompt to have Claude Code set up the project:

```
Create a TypeScript CLI project for Mappersan with:

1. Project Setup:
   - TypeScript with ES2022 target, ESM modules
   - Node 18+ requirement
   - Commander.js 12.0.0 for CLI
   - Vitest for testing
   - ESLint + TypeScript ESLint

2. Package.json:
   - name: "mappersan"
   - bin: { "mappersan": "./dist/bin/mappersan.js" }
   - type: "module"
   - scripts: build, test, lint, dev

3. Initial Commands (stubs):
   - init: Initialize mappersan in a project
   - analyze: Analyze codebase (return mock data for now)
   - generate: Generate documentation (placeholder)
   - validate: Validate docs match code (placeholder)

4. Project Structure:
   src/
   ├── bin/mappersan.ts      # CLI entry, Commander setup
   ├── commands/
   │   ├── init.ts
   │   ├── analyze.ts
   │   ├── generate.ts
   │   └── validate.ts
   ├── analyzers/
   │   └── base.ts           # Base analyzer interface
   ├── generators/
   │   └── base.ts           # Base generator interface
   └── lib/
       └── config.ts         # Config loading (.mappersanrc)

5. Configuration:
   - Load from .mappersanrc, .mappersanrc.json, or .mappersan.config.json
   - Default config with sensible defaults

Make the CLI executable and working. I should be able to run:
- npm run build
- npm link
- mappersan --help
- mappersan init
- mappersan analyze
```

---

## Step 4: After Bootstrap, Add TypeScript Analyzer

```
Now implement the TypeScript analyzer that:

1. Detects Commander.js CLI commands from source:
   - Parse .command() calls
   - Extract name, description, options, arguments
   - Get source file and line number

2. Detects limitations from code:
   - Find TODO, FIXME, WIP, HACK comments
   - Find throw new Error('Not implemented')
   - Find console.warn about unsupported features

3. Detects usage patterns:
   - Extract examples from test files
   - Find code blocks in README.md
   - Identify most-used exported functions

4. Returns structured AnalysisResult

Create: src/analyzers/typescript.ts

Test with mappersan's own codebase:
mappersan analyze --json
```

---

## Step 5: Add CLAUDE.md Generator

```
Implement the CLAUDE.md generator that:

1. Takes AnalysisResult as input
2. Produces markdown following TREEBIRD template:
   - What is [Project]?
   - Core Commands (table)
   - When to Use
   - Limitations (top 5-6)
   - Quick Patterns (2-4 examples)
   - Configuration
   - Key Files
   - Testing

3. Keeps output under 200 lines
4. Optimizes for 30-second AI agent comprehension

Create: src/generators/claude-md.ts

Wire it up:
mappersan generate --tier 1
# Should create/update CLAUDE.md
```

---

## Step 6: Test Myceliumail Integration (Mock)

```
Add Myceliumail integration for Spidersan rescue mode:

1. Add --report-to flag to analyze command:
   mappersan analyze --branch feature/auth --report-to spidersan

2. For now, mock the mycmail send by:
   - Logging what would be sent
   - Creating a .mappersan/outbox.json with pending messages

3. Message format:
   {
     "to": "spidersan",
     "from": "mappersan",
     "subject": "Analysis Complete: feature/auth",
     "type": "analysis_report",
     "data": { ... AnalysisResult ... }
   }

4. When mycmail is available, replace mock with:
   execSync('mycmail send spidersan "Analysis Complete" --data ...')

Create: src/lib/messaging.ts
```

---

## Quick Reference: File Injection Order

```
1. CLAUDE.md           ← Inject first (AI context)
2. src/bin/mappersan.ts ← CLI entry point
3. src/commands/*.ts    ← Command stubs
4. src/analyzers/*.ts   ← Analysis logic
5. src/generators/*.ts  ← Doc generation
6. tests/*.test.ts      ← Tests
```

---

## Validation Checklist

After each phase, verify:

```bash
# Phase 1: Bootstrap
npm run build           # ✓ Compiles
mappersan --help        # ✓ Shows commands
mappersan init          # ✓ Creates .mappersanrc

# Phase 2: Analyzer
mappersan analyze       # ✓ Returns JSON
mappersan analyze --json | jq .commands  # ✓ Has commands

# Phase 3: Generator
mappersan generate      # ✓ Creates CLAUDE.md
cat CLAUDE.md           # ✓ Follows template

# Phase 4: Myceliumail
mappersan analyze --report-to spidersan  # ✓ Queues message
cat .mappersan/outbox.json               # ✓ Message formatted
```

---

## The Full Vision

```
┌─────────────────────────────────────────────────────────────┐
│                     TREEBIRD ECOSYSTEM                       │
│                                                              │
│                      ┌────────────┐                          │
│                      │ MYCELIUMAIL│                          │
│                      │  (mycmail) │                          │
│                      └─────┬──────┘                          │
│                            │                                 │
│         ┌──────────────────┼──────────────────┐             │
│         │                  │                  │             │
│         ▼                  ▼                  ▼             │
│   ┌───────────┐     ┌───────────┐     ┌────────────┐       │
│   │ SPIDERSAN │◄───▶│ MAPPERSAN │◄───▶│  RECOVERY  │       │
│   │ Branches  │     │   Docs    │     │    TREE    │       │
│   └───────────┘     └───────────┘     └────────────┘       │
│                            │                                 │
│                            ▼                                 │
│                    ┌───────────────┐                        │
│                    │  YOUR PROJECT │                        │
│                    │  (documented) │                        │
│                    └───────────────┘                        │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

---

*This starter kit is part of the Treebird ecosystem.*
*See: Spidersan repo for full MAPPERSAN_ROADMAP.md*
