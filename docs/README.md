# 🕷️ Spidersan Documentation

**Branch coordination for AI coding agents**

> Stop the merge chaos. Know what every AI session is doing.

---

## Quick Links

| Document | Description |
|----------|-------------|
| [../README.md](../README.md) | Main project README |
| [../USAGE.md](../USAGE.md) | Complete command reference |
| [../CHANGELOG.md](../CHANGELOG.md) | Version history |
| [MIGRATION_GUIDE.md](MIGRATION_GUIDE.md) | Upgrading between versions |
| [SPIDERSAN_STARTER_KIT.md](SPIDERSAN_STARTER_KIT.md) | Quick start guide |

---

## Core Concepts

### The Problem

Multiple AI agents working simultaneously = merge conflict chaos:
- 🌿 **Branch explosion:** 10-20 branches pile up
- 💥 **Merge chaos:** Wrong order = hours of conflicts
- 🤷 **Context loss:** Sessions don't know what others did

### The Solution

Spidersan provides:
- **Branch registration** - Track what each agent is working on
- **Conflict detection** - 4-tier system (BLOCK → PAUSE → WARN → INFO)
- **Merge ordering** - Topological sort for optimal sequence
- **Semantic analysis** - AST-based symbol-level detection

---

## Quick Start

```bash
# Install
npm install -g spidersan

# Initialize in your project
cd your-project
spidersan init

# Register your branch
spidersan register --files "src/**/*.ts"

# Check for conflicts
spidersan conflicts

# Get optimal merge order
spidersan merge-order
```

---

## Additional Resources

- [LIMITATIONS.md](LIMITATIONS.md) - What Spidersan cannot do
- [FLOCKVIEW_INTEGRATION.md](FLOCKVIEW_INTEGRATION.md) - UI integration
- [HUB_SYNC.md](HUB_SYNC.md) - Real-time synchronization
- [MULTI_ENVIRONMENT_SETUP.md](MULTI_ENVIRONMENT_SETUP.md) - Staging/Production config

---

## Support

- 📖 [GitHub Issues](https://github.com/treebird7/spidersan-oss/issues)
- 💬 [GitHub Discussions](https://github.com/treebird7/spidersan-oss/discussions)

---

**🕷️ Spidersan — Built for the AI-first developer**
