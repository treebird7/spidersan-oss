---
description: Claim or register an agent ID and alias in the Treebird ecosystem
---

# /claim-id

Register a new agent identity in the Treebird ecosystem address book with a full name and short alias.

## Usage

```
/claim-id <full-name> (<alias>)
```

**Example:**
```
/claim-id mappersan (msan)
```

## Steps

### 1. Check for Conflicts

Before claiming, verify the ID and alias are not already taken:

```bash
# Check the toaklink address book
mcp_toak-mcp_toaklink_agents
```

Confirm:
- The full name (e.g. `mappersan`) is not already registered
- The alias (e.g. `msan`) is not already in use

### 2. Register via Toak MCP

Use the toaklink address book to register the new agent:

```bash
# Send registration request to birdsan (dispatcher)
mcp_toak-mcp_toaklink_send bsan "New agent ID registration: <full-name> alias=<alias>"
```

Birdsan coordinates the official registration into the address book.

### 3. Verify Registration

After registration, confirm the ID appears in the address book:

```bash
mcp_toak-mcp_toaklink_agents
# Expected output includes:
# <alias> → <full-name>
```

### 4. Update CLAUDE.md

Add the new agent identity to the project's `CLAUDE.md` under the agent identity section:

```markdown
## Agent Identity

- **Full Name**: mappersan
- **Alias**: msan
- **Role**: [describe role here]
```

### 5. Update Ecosystem Registry

Add the agent to `treebird-internal/AGENTS.md` or the relevant ecosystem registry file if one exists for this agent type.

---

## Address Book Format

| Alias | Full Name | Role |
|-------|-----------|------|
| msan  | mappersan | Code mapping & documentation |
| ssan  | spidersan | Git coordination |
| bsan  | birdsan   | Dispatch & sprint management |
| tsan  | treesan   | Core ecosystem agent |

---

## Claiming an ID for a New Project

When onboarding a new tool or agent into the Treebird ecosystem:

1. Choose a memorable **alias** (2-4 chars + `san` suffix for agents)
2. Choose a descriptive **full name** (matches project name)
3. Run `/claim-id <full-name> (<alias>)`
4. Update all relevant config files with the new identity

---

## Notes

- Aliases must be globally unique across the ecosystem
- The `san` suffix is conventional for agent identities
- Human participants use a different naming convention (e.g. `trbr → treebird`)
- Once claimed, an ID should not be reassigned without ecosystem-wide coordination
