#!/bin/bash
# Spidersan Auto-Register Workflow Installer
# Usage: ./install-auto-register.sh [target-repo-path]

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
WORKFLOW_FILE="auto-register.yml"
WORKFLOW_URL="https://raw.githubusercontent.com/treebird7/spidersan-oss/main/.github/workflows/auto-register.yml"
SPIDERSAN_REPO="${SPIDERSAN_REPO:-}"

# Target repo (default: current directory)
TARGET_REPO="${1:-.}"

echo -e "${BLUE}🕷️  Installing Spidersan Auto-Register Workflow${NC}"
echo ""

# Pre-flight checks
echo -e "${YELLOW}✓ Pre-flight checks:${NC}"

# Check if target is a git repo
cd "$TARGET_REPO" || { echo -e "${RED}❌ Cannot access target directory${NC}"; exit 1; }
if ! git rev-parse --git-dir > /dev/null 2>&1; then
    echo -e "${RED}   ✗ Not a git repository${NC}"
    exit 1
fi
echo -e "   ${GREEN}✓ Git repository${NC}"

# Check if workflow already exists
WORKFLOW_PATH=".github/workflows/$WORKFLOW_FILE"
if [ -f "$WORKFLOW_PATH" ]; then
    echo -e "${YELLOW}   ⚠ Workflow already exists${NC}"
    read -p "   Overwrite? [y/N] " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        echo -e "${BLUE}   Skipping installation${NC}"
        exit 0
    fi
else
    echo -e "   ${GREEN}✓ Workflow does not exist (will create)${NC}"
fi

echo ""

# Download/copy workflow file
echo -e "${YELLOW}📥 Installing workflow file...${NC}"

# Create directory if needed
mkdir -p .github/workflows

# Try to copy from local spidersan repo first
if [ -n "$SPIDERSAN_REPO" ] && [ -f "$SPIDERSAN_REPO/.github/workflows/$WORKFLOW_FILE" ]; then
    echo "   Using local file: $SPIDERSAN_REPO/.github/workflows/$WORKFLOW_FILE"
    cp "$SPIDERSAN_REPO/.github/workflows/$WORKFLOW_FILE" "$WORKFLOW_PATH"
    echo -e "   ${GREEN}✓ Copied from local repo${NC}"
# Try to find spidersan-oss in common locations
elif [ -f "../spidersan/.github/workflows/$WORKFLOW_FILE" ]; then
    cp "../spidersan/.github/workflows/$WORKFLOW_FILE" "$WORKFLOW_PATH"
    echo -e "   ${GREEN}✓ Copied from ../spidersan${NC}"
elif [ -f "../spidersan-oss/.github/workflows/$WORKFLOW_FILE" ]; then
    cp "../spidersan-oss/.github/workflows/$WORKFLOW_FILE" "$WORKFLOW_PATH"
    echo -e "   ${GREEN}✓ Copied from ../spidersan-oss${NC}"
# Download from GitHub
else
    echo "   Downloading from GitHub..."
    if command -v curl &> /dev/null; then
        curl -fsSL "$WORKFLOW_URL" -o "$WORKFLOW_PATH"
        echo -e "   ${GREEN}✓ Downloaded from GitHub${NC}"
    elif command -v wget &> /dev/null; then
        wget -q "$WORKFLOW_URL" -O "$WORKFLOW_PATH"
        echo -e "   ${GREEN}✓ Downloaded from GitHub${NC}"
    else
        echo -e "${RED}   ✗ Neither curl nor wget found${NC}"
        echo "   Please install curl or wget, or set SPIDERSAN_REPO env var"
        exit 1
    fi
fi

echo -e "${GREEN}✓ Created: $WORKFLOW_PATH${NC}"
echo ""

# Verify file
if [ ! -s "$WORKFLOW_PATH" ]; then
    echo -e "${RED}❌ Workflow file is empty${NC}"
    exit 1
fi

# Commit changes
echo -e "${YELLOW}📝 Committing changes...${NC}"

git add "$WORKFLOW_PATH"

# Check if there are changes to commit
if git diff --cached --quiet; then
    echo -e "${BLUE}   No changes to commit (file already up to date)${NC}"
else
    git commit -m "feat: add spidersan auto-register workflow

Enables automatic branch registration on every push.
Auto-detects agent, files, and conflicts.

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
    echo -e "${GREEN}✓ Committed changes${NC}"
fi

echo ""

# Ask to push
read -p "Push to origin? [Y/n] " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Nn]$ ]]; then
    echo -e "${YELLOW}🚀 Pushing to origin...${NC}"

    # Get current branch
    CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD)

    # Push
    if git push origin "$CURRENT_BRANCH"; then
        echo -e "${GREEN}✓ Pushed to origin/$CURRENT_BRANCH${NC}"
    else
        echo -e "${YELLOW}⚠ Push failed (you may need to push manually)${NC}"
    fi
else
    echo -e "${BLUE}Skipping push${NC}"
fi

echo ""
echo -e "${GREEN}🎉 Installation Complete!${NC}"
echo ""
echo -e "${BLUE}Next steps:${NC}"
echo "1. Create a test branch:"
echo "   ${YELLOW}git checkout -b test/auto-register${NC}"
echo ""
echo "2. Make a change and push:"
echo "   ${YELLOW}echo 'test' >> README.md${NC}"
echo "   ${YELLOW}git add README.md && git commit -m 'test: verify auto-register'${NC}"
echo "   ${YELLOW}git push origin test/auto-register${NC}"
echo ""
echo "3. View workflow runs:"
echo "   ${YELLOW}gh run list --workflow=auto-register.yml${NC}"
echo "   Or visit: ${BLUE}https://github.com/$(git remote get-url origin | sed 's/.*github.com[:/]\(.*\)\.git/\1/')/actions${NC}"
echo ""
echo -e "${BLUE}Documentation:${NC} INSTALL_AUTO_REGISTER.md"
echo -e "${BLUE}Use Cases:${NC} AUTO_REGISTER_USE_CASES.md"
echo ""
