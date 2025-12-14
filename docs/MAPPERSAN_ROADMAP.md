# Mappersan - Documentation Mapping CLI

> **Roadmap & Vision Document**
> Automatic documentation generation for AI-agent-ready codebases

---

## Vision

**Mappersan** is a CLI tool that analyzes codebases and generates the tiered documentation pyramid automatically, making any project instantly understandable by AI coding agents.

```
mappersan analyze → mappersan generate → AI agents understand your project
```

---

## The Problem

1. **Manual documentation is tedious** - Developers skip it
2. **AI agents waste tokens** - Re-exploring codebases every session
3. **Documentation gets stale** - Code changes, docs don't
4. **No standard format** - Every project documents differently
5. **Limitations undocumented** - AI agents make false assumptions

---

## The Solution

Mappersan automatically:
- Analyzes codebase structure and patterns
- Identifies commands, APIs, and features
- Detects limitations from code constraints
- Generates tiered documentation (CLAUDE.md, AGENT_GUIDE.md, etc.)
- Keeps docs in sync with code changes

---

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

---

## Prompt Examples for Development

These are example prompts to give AI agents when building Mappersan:

### Phase 1: Project Setup

#### Prompt 1.1: Initialize Project
```
Create a new TypeScript CLI project called "mappersan" with:
- Commander.js for CLI framework
- Similar structure to Spidersan
- ESM modules, Node 18+
- Vitest for testing
- Basic commands: init, analyze, generate, sync, validate
```

#### Prompt 1.2: Configuration System
```
Implement a configuration system for Mappersan that:
- Reads from .mappersanrc, .mappersanrc.json, or .mappersan.config.json
- Supports project-specific customization
- Allows custom templates for each documentation tier
- Has sensible defaults that work out of the box
```

---

### Phase 2: Codebase Analysis

#### Prompt 2.1: Structure Analyzer
```
Create a codebase analyzer that:
- Detects project type (Node, Python, Go, Rust, etc.)
- Identifies entry points (main files, CLI entry, API routes)
- Maps directory structure and key folders
- Finds configuration files and their purposes
- Returns a structured JSON representation of the codebase
```

#### Prompt 2.2: Command/API Extractor
```
Build a command extractor that:
- For CLIs: Parses Commander.js, yargs, argparse, clap, etc.
- For APIs: Extracts routes from Express, FastAPI, Gin, etc.
- For libraries: Identifies exported functions/classes
- Returns structured list of all available commands/endpoints with descriptions
```

#### Prompt 2.3: Limitation Detector
```
Create a limitation detector that analyzes code to find:
- Functions that throw "not implemented" errors
- TODO/FIXME comments indicating missing features
- Conditional blocks that reject certain inputs
- Error messages that indicate unsupported operations
- Configuration options that disable features
Return a structured list of detected limitations with file locations.
```

#### Prompt 2.4: Pattern Recognizer
```
Build a pattern recognizer that identifies common usage patterns:
- Analyze test files for example usage
- Find README examples and code blocks
- Extract from JSDoc/docstring examples
- Identify the most-called functions as "core patterns"
Return top 5 usage patterns with code examples.
```

---

### Phase 3: Documentation Generation

#### Prompt 3.1: CLAUDE.md Generator
```
Create a CLAUDE.md generator that:
- Takes analyzed codebase data as input
- Produces a <200 line markdown document
- Includes: what, why, commands, limitations, patterns, config, key files
- Uses the TREEBIRD template structure
- Optimizes for 30-second comprehension by AI agents
```

#### Prompt 3.2: AGENT_GUIDE.md Generator
```
Build an AGENT_GUIDE.md generator that:
- Creates a <150 line quick reference document
- Generates decision trees from command relationships
- Builds command cheat sheet tables automatically
- Extracts "golden rules" from code constraints and error handling
- Focuses on actionable, imperative guidance
```

#### Prompt 3.3: LIMITATIONS.md Generator
```
Create a LIMITATIONS.md generator that:
- Takes detected limitations from analyzer
- Formats each with: what it does, what it doesn't, why
- Groups limitations by category (core, feature-specific, storage, etc.)
- Generates "common misconceptions" from error messages
- Suggests workarounds where detectable
```

#### Prompt 3.4: USE_CASES.md Generator
```
Build a USE_CASES.md generator that:
- Creates comprehensive scenario documentation
- Generates development use cases from test files
- Creates marketing use cases from README/description
- Adds appropriate hashtags automatically
- Includes industry-specific sections based on project domain
```

---

### Phase 4: Sync & Validation

#### Prompt 4.1: Documentation Drift Detector
```
Create a drift detector that:
- Compares current code against last-generated docs
- Identifies new commands/APIs not in docs
- Finds removed features still documented
- Detects changed signatures or behaviors
- Reports drift as warnings with specific locations
```

#### Prompt 4.2: Auto-Sync System
```
Build an auto-sync system that:
- Watches for file changes in src/
- Triggers re-analysis on relevant changes
- Updates only affected documentation sections
- Preserves manual additions (marked with <!-- manual -->)
- Commits changes automatically (optional)
```

#### Prompt 4.3: Validation Engine
```
Create a validation engine that:
- Checks all documented commands actually exist
- Verifies code examples compile/run
- Ensures limitation claims match code behavior
- Validates internal links between docs
- Reports validation score (0-100%)
```

---

### Phase 5: Advanced Features

#### Prompt 5.1: Multi-Language Support
```
Extend Mappersan to support multiple languages:
- Python (argparse, click, FastAPI, Flask)
- Go (cobra, gin, echo)
- Rust (clap, actix, axum)
- Java (Spring Boot, picocli)
Create language-specific analyzers with common output format.
```

#### Prompt 5.2: AI Enhancement Integration
```
Add optional AI enhancement that:
- Uses Claude/GPT to improve generated descriptions
- Generates more natural-sounding documentation
- Creates additional use cases from codebase context
- Suggests limitations that might be missed by static analysis
Require explicit opt-in and API key configuration.
```

#### Prompt 5.3: CI/CD Integration
```
Create CI/CD integration:
- GitHub Action for documentation validation
- Pre-commit hook for sync checking
- PR comment bot showing documentation drift
- Badge generation for documentation health score
```

#### Prompt 5.4: Template Customization
```
Build a template system that:
- Allows custom templates for each documentation tier
- Supports Handlebars/Mustache syntax
- Includes default templates matching TREEBIRD standard
- Enables organization-wide template sharing
```

---

### Phase 6: Ecosystem Integration

#### Prompt 6.1: Spidersan Integration
```
Integrate Mappersan with Spidersan:
- Auto-register mappersan branches with spidersan
- Generate spidersan-specific documentation
- Coordinate documentation updates across agent branches
- Share limitation data between tools
```

#### Prompt 6.2: MCP Server
```
Create an MCP server for Mappersan that:
- Exposes analyze/generate/validate as MCP tools
- Allows Claude/Cursor to query documentation status
- Enables AI-driven documentation updates
- Provides real-time codebase understanding
```

#### Prompt 6.3: IDE Extensions
```
Build IDE extensions:
- VS Code extension showing documentation coverage
- Inline warnings for undocumented functions
- Quick-fix suggestions to add documentation
- Preview panel for generated docs
```

---

### Phase 7: Rescue Mode Integration

#### Prompt 7.1: Branch Analysis for Spidersan Rescue
```
Create a branch analysis system that:
- Analyzes code on any git branch (not just current)
- Compares branches to identify duplicates (% code overlap)
- Detects salvageable components vs broken/incomplete code
- Generates rescue reports for Spidersan consumption
- Sends reports via Spidermail to rescue master branch
```

#### Prompt 7.2: Multi-Branch Intelligence
```
Build multi-branch intelligence gathering:
- Scan all branches in parallel
- Create unified "archaeology" report of valuable code
- Identify which branch has the "best" version of duplicated work
- Map dependencies between branches
- Generate triage recommendations (MERGE/SALVAGE/ABANDON)
```

#### Prompt 7.3: Component Extraction
```
Create component extraction system:
- Parse codebase to identify independent components
- Score each component: complete/wip/broken
- Extract clean components to manifest file
- Support "replay" of components to target branch
- Preserve git history attribution where possible
```

#### Prompt 7.4: Spidersan Communication Protocol
```
Implement Spidersan communication:
- Send analysis reports via spidersan send command
- Report format: structured JSON with markdown summary
- Message types: analysis_report, salvage_manifest, triage_recommendation
- Listen for rescue mission commands from Spidersan
- Update Spidersan registry with analysis metadata
```

---

## Rescue Mode Workflow

```
┌──────────────────────────────────────────────────────────────────────┐
│                    RESCUE MODE INTEGRATION                            │
├──────────────────────────────────────────────────────────────────────┤
│                                                                       │
│   SPIDERSAN                         MAPPERSAN                        │
│   ─────────                         ─────────                        │
│                                                                       │
│   spidersan rescue                                                   │
│        │                                                             │
│        ├──────── "analyze all branches" ────────▶ mappersan analyze  │
│        │                                              --all-branches │
│        │                                                    │        │
│        │                                                    ▼        │
│        │                                         ┌─────────────────┐ │
│        │                                         │ Branch Reports  │ │
│        │                                         │ - Components    │ │
│        │                                         │ - Status        │ │
│        │◀─────── spidermail reports ─────────────│ - Conflicts     │ │
│        │                                         │ - Duplicates    │ │
│        │                                         └─────────────────┘ │
│        ▼                                                             │
│   ┌──────────┐                                                       │
│   │  TRIAGE  │                                                       │
│   │ Decision │──── "salvage feature/auth" ────▶ mappersan extract    │
│   └──────────┘                                      --components     │
│        │                                                    │        │
│        │◀─────── salvage manifest ──────────────────────────┘        │
│        │                                                             │
│        ▼                                                             │
│   spidersan replay                                                   │
│   (applies salvaged                                                  │
│    code to target)                                                   │
│                                                                       │
└──────────────────────────────────────────────────────────────────────┘
```

---

## Rescue Mode Commands (Mappersan)

| Command | Purpose |
|---------|---------|
| `mappersan analyze --branch <name>` | Analyze specific branch |
| `mappersan analyze --all-branches` | Analyze all branches |
| `mappersan compare <branch1> <branch2>` | Compare two branches |
| `mappersan duplicates` | Find duplicate code across branches |
| `mappersan extract --components <list>` | Extract components to manifest |
| `mappersan report --to spidersan` | Send report via Spidermail |

---

## Rescue Mode Data Models

### BranchAnalysis
```typescript
interface BranchAnalysis {
  branchName: string;
  lastCommit: string;
  lastCommitDate: Date;
  author: string;
  status: 'active' | 'stale' | 'abandoned';
  triageRecommendation: 'merge' | 'salvage' | 'abandon';
  components: ComponentAnalysis[];
  conflicts: ConflictInfo[];
  duplicateOf?: string; // Another branch this duplicates
  overlapPercentage?: number;
}
```

### ComponentAnalysis
```typescript
interface ComponentAnalysis {
  path: string;
  name: string;
  type: 'function' | 'class' | 'module' | 'file';
  status: 'complete' | 'wip' | 'broken';
  hasTests: boolean;
  dependencies: string[];
  wipMarkers: WipMarker[];
  linesOfCode: number;
  salvageable: boolean;
}
```

### SalvageManifest
```typescript
interface SalvageManifest {
  sourceBranch: string;
  extractedAt: Date;
  components: ExtractedComponent[];
  totalLines: number;
  preserveHistory: boolean;
  targetBranch?: string;
}
```

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Mappersan CLI                             │
├─────────────────────────────────────────────────────────────┤
│  Commands: init | analyze | generate | sync | validate       │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐  │
│  │  Analyzers  │  │ Generators  │  │     Validators      │  │
│  ├─────────────┤  ├─────────────┤  ├─────────────────────┤  │
│  │ Structure   │  │ CLAUDE.md   │  │ Command existence   │  │
│  │ Commands    │  │ AGENT_GUIDE │  │ Example validity    │  │
│  │ Limitations │  │ LIMITATIONS │  │ Link integrity      │  │
│  │ Patterns    │  │ USE_CASES   │  │ Drift detection     │  │
│  └─────────────┘  └─────────────┘  └─────────────────────┘  │
│                                                              │
├─────────────────────────────────────────────────────────────┤
│  Language Adapters: TypeScript | Python | Go | Rust | Java   │
├─────────────────────────────────────────────────────────────┤
│  Storage: Local JSON | Git Integration                       │
└─────────────────────────────────────────────────────────────┘
```

---

## Data Models

### AnalysisResult
```typescript
interface AnalysisResult {
  projectType: 'cli' | 'api' | 'library' | 'app';
  language: 'typescript' | 'python' | 'go' | 'rust' | 'java';
  structure: DirectoryStructure;
  commands: Command[];
  limitations: Limitation[];
  patterns: UsagePattern[];
  configuration: ConfigFile[];
  keyFiles: KeyFile[];
  analyzedAt: Date;
}
```

### Command
```typescript
interface Command {
  name: string;
  description: string;
  arguments: Argument[];
  options: Option[];
  examples: string[];
  sourceFile: string;
  sourceLine: number;
}
```

### Limitation
```typescript
interface Limitation {
  id: string;
  title: string;
  description: string;
  category: 'core' | 'feature' | 'storage' | 'integration' | 'performance';
  detectedFrom: 'code' | 'comment' | 'error' | 'config';
  sourceFile: string;
  sourceLine: number;
  workaround?: string;
}
```

### UsagePattern
```typescript
interface UsagePattern {
  name: string;
  description: string;
  code: string;
  frequency: number; // How often this pattern appears
  source: 'test' | 'readme' | 'docstring' | 'example';
}
```

---

## Milestones

### v0.1.0 - Foundation
- [ ] Project setup with TypeScript + Commander.js
- [ ] Basic `init` command
- [ ] TypeScript/JavaScript analyzer (structure only)
- [ ] CLAUDE.md generator (basic)
- [ ] Local configuration support

### v0.2.0 - Full Analysis
- [ ] Command extractor for Commander.js
- [ ] Limitation detector (TODO/FIXME/errors)
- [ ] Pattern recognizer from tests
- [ ] All four documentation tiers
- [ ] `generate` command complete

### v0.3.0 - Sync & Validation
- [ ] `sync` command
- [ ] `validate` command
- [ ] Drift detection
- [ ] Watch mode
- [ ] Git integration

### v0.4.0 - Multi-Language
- [ ] Python support (argparse, click, FastAPI)
- [ ] Go support (cobra, gin)
- [ ] Language auto-detection
- [ ] Unified output format

### v0.5.0 - Ecosystem
- [ ] Spidersan integration
- [ ] GitHub Action
- [ ] Pre-commit hooks
- [ ] Documentation health badge

### v0.6.0 - Rescue Mode
- [ ] Branch analysis (`--branch` flag)
- [ ] Multi-branch scanning (`--all-branches`)
- [ ] Duplicate detection across branches
- [ ] Component extraction and salvage manifests
- [ ] Spidermail report integration
- [ ] Triage recommendations (MERGE/SALVAGE/ABANDON)

### v1.0.0 - Production Ready
- [ ] MCP Server
- [ ] VS Code extension
- [ ] AI enhancement (optional)
- [ ] Template customization
- [ ] Full test coverage
- [ ] Performance optimization

---

## Success Metrics

| Metric | Target |
|--------|--------|
| Time to document new project | <5 minutes |
| Documentation accuracy | >90% |
| Sync detection accuracy | >95% |
| Languages supported | 5+ |
| Lines of manual editing needed | <10% |

---

## Competitive Landscape

| Tool | What it Does | Mappersan Difference |
|------|--------------|---------------------|
| JSDoc/TSDoc | API documentation | Agent-focused, tiered system |
| Sphinx | Python docs | Multi-language, AI-optimized |
| Swagger | API specs | Beyond APIs, full project understanding |
| ReadMe | Doc hosting | Generation, not hosting |
| Mintlify | AI docs | Tiered pyramid, limitation focus |

**Mappersan's unique value:** Documentation specifically optimized for AI coding agents with explicit limitations and decision trees.

---

## Example Workflow

```bash
# 1. Initialize in a new project
cd my-project
mappersan init

# 2. Analyze the codebase
mappersan analyze
# Output: Found 15 commands, 8 limitations, 12 patterns

# 3. Generate all documentation
mappersan generate
# Created: CLAUDE.md, docs/AGENT_GUIDE.md, docs/LIMITATIONS.md, docs/USE_CASES.md

# 4. Validate the generated docs
mappersan validate
# Score: 94% - 2 examples need updating

# 5. Watch for changes
mappersan watch
# Watching for changes... Press Ctrl+C to stop

# 6. After code changes, sync docs
mappersan sync
# Updated: CLAUDE.md (2 new commands), LIMITATIONS.md (1 new limitation)
```

---

## User Prompts for Each Phase

### "I just want my project documented"
```bash
mappersan init && mappersan generate
```

### "Keep docs in sync with my code"
```bash
mappersan watch
# Or add to package.json: "predocs": "mappersan sync"
```

### "Check if my docs are accurate"
```bash
mappersan validate --strict
```

### "Generate only the AI context file"
```bash
mappersan generate --tier 1 --output CLAUDE.md
```

### "What changed since last generation?"
```bash
mappersan diff
```

### "Analyze without generating"
```bash
mappersan analyze --json > analysis.json
```

---

## Configuration Example

```json
// .mappersanrc.json
{
  "projectName": "my-awesome-cli",
  "description": "A CLI that does awesome things",
  "language": "typescript",
  "tiers": {
    "claude": {
      "enabled": true,
      "maxLines": 200,
      "output": "CLAUDE.md"
    },
    "agentGuide": {
      "enabled": true,
      "maxLines": 150,
      "output": "docs/AGENT_GUIDE.md"
    },
    "limitations": {
      "enabled": true,
      "output": "docs/LIMITATIONS.md"
    },
    "useCases": {
      "enabled": true,
      "output": "docs/USE_CASES.md",
      "hashtags": true
    }
  },
  "analyzers": {
    "commands": {
      "framework": "commander",
      "entryPoint": "src/bin/cli.ts"
    },
    "limitations": {
      "patterns": ["TODO", "FIXME", "NOT_IMPLEMENTED", "UNSUPPORTED"]
    }
  },
  "sync": {
    "watch": ["src/**/*.ts"],
    "ignore": ["**/*.test.ts", "**/*.spec.ts"],
    "preserveManual": true
  }
}
```

---

## Next Steps

1. **Validate concept** - Manual documentation mapping (done with Spidersan)
2. **Create repository** - `treebird7/mappersan`
3. **Phase 1 development** - Basic CLI and TypeScript analyzer
4. **Dogfood** - Use Mappersan to document itself
5. **Iterate** - Improve based on real usage

---

## Related Projects

- **Spidersan** - Branch coordination (sister project)
- **Recovery-Tree** - Agent state recovery (shared infrastructure)

---

*Document Version: 1.0*
*Last Updated: 2025-12-13*
*Status: Planning/Roadmap*
