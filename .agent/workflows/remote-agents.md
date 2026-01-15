---
description: Deploy remote multi-model agents (GPT/Gemini) to join collab via Aider on i7
---

# Remote Agent Deployment Workflow

Deploy GPT-4 and/or Gemini agents to participate in daily collab from the i7 machine.

## Prerequisites
- SSH access to i7 (`ssh i7`)
- API keys for OpenAI/Google

## Quick Deploy (from local)

// turbo
1. Copy setup script to i7:
```bash
scp /Users/freedbird/Dev/treebird-internal/scripts/remote_agent_setup.sh i7:~/
```

2. SSH and run setup (first time only):
```bash
ssh i7 "bash ~/remote_agent_setup.sh"
```

// turbo
3. Copy run script:
```bash
scp /Users/freedbird/Dev/treebird-internal/scripts/run_remote_agents.sh i7:~/Dev/treebird-internal/scripts/
```

4. Deploy agents:
```bash
# GPT-4 only
ssh i7 "cd ~/Dev/treebird-internal && ./scripts/run_remote_agents.sh gpt"

# Gemini only
ssh i7 "cd ~/Dev/treebird-internal && ./scripts/run_remote_agents.sh gemini"

# Both (parallel)
ssh i7 "cd ~/Dev/treebird-internal && ./scripts/run_remote_agents.sh both"
```

## Agent Glyphs

| Agent | Model | Glyph | Strengths |
|-------|-------|-------|-----------|
| GPT-Agent | gpt-4 | 🤖 | Analysis, writing, code review |
| Gemini-Agent | gemini-1.5-pro | 💎 | Research, summarization, multimodal |

## Spidersan Integration

The run script automatically:
- 🕷️ Registers with Spidersan web (if available)
- Detects collab file based on current date
- Creates collab file if missing

## After Agent Run

// turbo
5. Pull remote changes:
```bash
ssh i7 "cd ~/Dev/treebird-internal && git add collab/ && git commit -m 'feat: remote agent contributions' && git push"
```

// turbo
6. Pull locally:
```bash
cd /Users/freedbird/Dev/treebird-internal && git pull
```

## Troubleshooting

| Issue | Fix |
|-------|-----|
| Aider not found | `pip install aider-chat` |
| API key missing | Set `OPENAI_API_KEY` or `GOOGLE_API_KEY` |
| Collab not found | Script auto-creates it |
| Conflicts | Run `spidersan conflicts` before push |
