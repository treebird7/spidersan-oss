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

- All cloud features are opt-in
- Use `spidersan config --local-only` to disable all network calls
- Request data deletion anytime

## Contact

Questions about data practices? [privacy@spidersan.dev](mailto:privacy@spidersan.dev)
