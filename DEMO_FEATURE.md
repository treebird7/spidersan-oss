# Demo Feature

This is a demo file to showcase the auto-register workflow.

## What happens when this is pushed?

1. GitHub Actions detects the push
2. Workflow extracts the agent name from branch prefix: `demo`
3. Workflow detects changed files: `DEMO_FEATURE.md`
4. Workflow runs: `spidersan register --agent demo --files DEMO_FEATURE.md`
5. Branch is now registered in Spidersan registry
6. Workflow checks for conflicts with other registered branches
7. If conflicts exist, they're reported in the workflow logs

## Result

Other agents working in the repo can now:
- See that `demo` agent is working on this branch
- Know which files are being modified
- Get warned if they try to modify the same files
- Check the merge order to avoid conflicts
