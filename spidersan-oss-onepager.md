# 🕷️ Spidersan: The Nervous System for AI Swarms

**Spidersan** turns a chaotic crowd of AI agents into a synchronized, high-performance swarm. It provides the "digital nervous system" that allows 10, 50, or 100 agents to code in the same repository simultaneously without destroying each other's work.

## 🚀 Core Features

### 1. 🧠 The "Shared Brain" (CRDT State)
Most agents are isolated islands. Spidersan connects them.
*   **What it is:** A decentralized shared state that every agent has a copy of.
*   **Why it matters:** It triggers a "hive mind" effect. If Agent A learns something or claims a task, Agent B knows about it *instantly*. No central master server required—it works even over a local file system!

### 2. 🔒 The "Digital Talking Stick" (Locking)
Prevent the "too many cooks" problem where agents overwrite each other.
*   **How it works:** Before touching a file or function, an agent grabs a lock (`spidersan lock`).
*   **The Magic:** Other agents check the lock status before acting. If `Sherlocksan` is securing the database class, `Birdsan` knows to wait. It turns chaos into a queue.

### 3. 🧬 DNA-Level Security (AST Hashing)
Locking by filename isn't enough—files change lines all the time.
*   **The Genious:** We fingerprint the *structure* of the code (Abstract Syntax Tree).
*   **The Benefit:** If an agent tries to lock a function, but the code has changed significantly since they last read it, Spidersan rejects the lock. It forces the agent to "refresh its memory" before making mistakes.

### 4. 🕵️ "Who Owns This?" (Attribution)
Context is king. Agents shouldn't just guess who wrote code.
*   **The Feature:** Instantly identify which agent (or human!) is the expert on a specific file.
*   **The Flow:** Instead of blind refactoring, an agent can ping the original creator: *"Hey, you wrote this auth logic. I found a bug."*

### 6. 🛡️ The 7-Layer Shield (Conflict Radar)
Spidersan doesn't just check for git conflicts. It checks for *logic* conflicts.
*   **The Depth:** It scans 7 layers deep—from simple file edits (L1) to semantic dependencies (L2) and intent overlaps (L3).
*   **The Result:** It warns you before you even write the code: *"Agent B is modifying the function you're about to call."*

### 7. 🚑 "Rescue Mode" (Cleanup)
When the chaos inevitably happens (because humans involved), Spidersan cleans up.
*   **The Capability:** `spidersan rescue` scans for abandoned branches and broken merges.
*   **The Action:** It salvages useful code chunks and archives the rest, keeping your repo pristine.

### 8. 🌊 Task Torrenting (Distributed Work)
The ultimate swarm behavior.
*   **The Concept:** Break a massive epic into 50 shards (`spidersan torrent decompose`).
*   **The Execution:** Agents claim shards, work in parallel, and Spidersan orchestrates the merge order (`spidersan merge-order`) so they reassemble perfectly.

---

### 🌟 Why Spidersan?
Because **collaborative AI > isolated AI**. Spidersan provides the primitives—Locking, Syncing, Sensing, and Shielding—that let you build **complex, multi-agent workflows** that actually work.
