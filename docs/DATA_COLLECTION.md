---
tags: [agent/spidersan]
---

# Data Collection Policy

## Overview

Spidersan is designed with a **local-first** architecture. Your code and branch data stay on your machine.

## What We Collect

### Local Mode

**Nothing.** The CLI operates entirely locally with no network calls.

### Optional Cloud Sync

When using a cloud backend (Supabase):

| Data | Purpose | Retention |
|------|---------|-----------|
| Branch names | Coordination | Session only |
| File paths (not contents) | Conflict detection | Session only |
| Anonymous usage metrics | Product improvement | 30 days |

## What We Never Collect

- ❌ Source code contents
- ❌ Git commit messages
- ❌ Personal information
- ❌ Repository secrets or credentials

## Your Control

- **All cloud features are opt-in** - Core works entirely offline
- **Optional Supabase sync** - Use `depends --cloud` to enable cross-machine coordination
- **No tracking by default** - Core CLI has zero telemetry
- **Request data deletion anytime** - Contact us if you used cloud features

## Version 0.4.0 Privacy

Spidersan 0.4.0 **core** has:
- ✅ Zero telemetry
- ✅ Zero network calls (unless you opt-in to cloud sync)
- ✅ All data stays local
- ✅ Open source (MIT license) - audit the code yourself

Advanced ecosystem features (optional plugin, coming soon) may include additional opt-in cloud features with the same privacy-first approach.

## Contact

Questions about data practices? File an issue on [GitHub](https://github.com/treebird7/spidersan-oss/issues)
