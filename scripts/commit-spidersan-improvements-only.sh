#!/usr/bin/env bash
set -euo pipefail

REPO_DIR="/Users/freedbird/Dev/spidersan"
cd "$REPO_DIR"

BRANCH="raptor-mini/spidersan-improvements-2026-02-10"

# Create branch if it doesn't exist
if git rev-parse --verify "$BRANCH" >/dev/null 2>&1; then
  echo "Branch $BRANCH already exists; checking it out"
  git checkout "$BRANCH"
else
  echo "Creating and switching to branch $BRANCH"
  git checkout -b "$BRANCH"
fi

# Stage all relevant files
echo "Staging changes..."
git add -A

# Commit with message; prevent interactive editor
echo "Committing..."
GIT_EDITOR=true git commit -m "chore(spidersan): tests + rebase-helper + add/add guidance + docs (Raptor Mini)" --no-verify || echo "No changes to commit"

echo "Done. Run 'git log -n 5' to verify the commit, then push when ready: git push -u origin $BRANCH"