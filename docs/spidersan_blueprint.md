# Spidersan: Architecture Blueprint

## 1. System Overview

**Spidersan** is a coordination layer for autonomous AI coding agents. It acts as a semantic "traffic controller" between agents and the underlying Git repository, preventing collisions before they happen and managing parallel work streams through a "Task Torrenting" protocol.

Note: `torrent`, `intent-scan`, `active-windows`, `collab-sync`, and `pulse` are ecosystem-only commands.

### High-Level Architecture

```mermaid
graph TD
    subgraph "Agent Layer"
        AgentA[Agent A (Claude)]
        AgentB[Agent B (Gemini)]
        IDE[Antigravity IDE]
    end

    subgraph "Interface Layer"
        CLI[Spidersan CLI]
        MCP[MCP Server]
    end

    subgraph "Core Logic"
        Conflict[Conflict Engine]
        Torrent[Task Torrenting]
        Watch[File Watcher]
    end

    subgraph "Storage & State"
        LocalStore[Local JSON (.spidersan/)]
        Supabase[Supabase DB (Optional)]
    end

    subgraph "External"
        Git[Git Repository]
        Hub[Treebird Hub]
    end

    AgentA -->|Tools| MCP
    AgentB -->|Tools| MCP
    IDE -->|Tools| MCP
    User -->|Commands| CLI

    CLI --> Conflict
    CLI --> Torrent
    CLI --> Watch
    MCP --> Conflict
    MCP --> Torrent

    Conflict -->|Read/Write| LocalStore
    Conflict -->|Sync| Supabase
    Torrent -->|Manage| Git
    Conflict -->|Notify| Hub
    Watch -->|Register| LocalStore
    Intent -->|Parse| CollabFiles
    ActiveWindow -->|Analyze| GitHistory
```

## 2. Core Components

### A. Conflict Engine (The 7-Layer Model)
Spidersan implements a sophisticated 7-layer conflict detection model, though not all layers are fully active yet.

| Layer | Name | Implementation | Description |
| :--- | :--- | :--- | :--- |
| **L1** | **File-Level** | `src/commands/conflicts.ts` | Regex-based file locking (Tiers 1-3). Blocks critical files. |
| **L3** | **Intent** | `src/commands/intent-scan.ts` | Parses natural language in `collab/*.md` to find overlapping plans. |
| **L4** | **Temporal** | `src/commands/active-windows.ts` | Analyzes Git history to detect overlapping work sessions. |

#### L1: Tiered File Locking
-   **TIER 1 (WARN) 🟡**: Standard source files. Information only.
-   **TIER 2 (PAUSE) 🟠**: Shared infrastructure (`package.json`, `tsconfig.json`). Triggers a "Pause".
-   **TIER 3 (BLOCK) 🔴**: Critical security files (`.env`, `secrets.ts`). Explicitly blocks merges.

#### L3: Intent Scanning
Analyzes the daily collaboration logs (`collab/YYYY-MM-DD-daily.md`) to extract "Intent Signals". If Agent A says "I'm working on Auth" and Agent B says "Refactoring Login", Spidersan warns them *before* they even touch code.

#### L4: Active Windows
Tracks "Work Windows" by analyzing commit bursts. If two agents are active in the same file area at the same time, it flags a "Temporal Conflict".

### B. Task Torrenting (`src/commands/torrent.ts`)
Implements a BitTorrent-inspired protocol for distributing coding tasks across a swarm of agents.

**Concepts:**
-   **Seeding**: Creating a task branch (`task/DASH-001`).
-   **Leeching/Claiming**: An agent assigns itself to a task.
-   **Swarm Optimization**: The `merge-order` command performs a topological sort based on file dependencies to serialize merges effectively, minimizing cascading conflicts.

**Branch Structure:**
-   `task/<TASK-ID>`: Standard format for all work streams.
-   Hierarchical decomposition supported (`DASH-001` -> `DASH-001-A`).

### C. Watcher Daemon (`src/commands/watch.ts`)
Background process that monitors file system events.
-   **Auto-Registration**: Agents don't need to manually tell Spidersan what they are touching. The watcher observes `chokidar` events and updates the `active` file list for the current agent's branch.
-   **Real-time Alerts**: Can push notifications to the Hub if an agent touches a file locked by another.

## 3. Interfaces

### A. MCP Server (`mcp-server/src/server.ts`)
Exposes Spidersan capabilities to AI models via the Model Context Protocol.
-   **Tools**:
    -   `check_conflicts`: "Am I stepping on toes?"
    -   `list_branches`: "What is everyone else doing?"
    -   `get_merge_order`: "In what order should we merge to avoid breaking things?"
    -   `start_watch` / `stop_watch`: Control the daemon.

### B. Command Line Interface (CLI)
Built with `commander`, serving as both the human entry point and the engine for the MCP server.
-   `spidersan conflicts`: Run conflict check (L1).
-   `spidersan intent-scan`: Check for overlapping plans (L3).
-   `spidersan active-windows`: Check for overlapping sessions (L4).
-   `spidersan torrent`: Manage task lifecycle.
-   `spidersan collab-sync`: Sync daily logs with special git handling (stash/pop).
-   `spidersan pulse`: System health and self-awareness check.


## 4. Data Storage

### Storage Adapter Pattern (`src/storage/`)
Spidersan is designed to operate in two modes:
1.  **Local Mode**: State (who owns what file) is stored in `.spidersan/*.json` files within the repo itself. This relies on Git to sync state between agents if they are on different machines.
2.  **Cloud Mode (Supabase)**: State is synced to a Postgres database, allowing real-time locking across distributed agents without waiting for a `git pull`.

## 5. Integration Points

-   **Treebird Hub**: Central coordination server. Spidersan sends "Wake" signals and "Conflict Alerts" to the Hub, which routes them to the appropriate agent.
-   **Mycmail**: Internal agent email system used for direct negotiation ("Hey, I need `auth.ts`, can you release it?").
