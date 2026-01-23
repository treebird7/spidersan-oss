#!/bin/bash
# Spidersan Demo GIF Recording Script
# Run with: asciinema rec demo.cast --command ./scripts/demo-recording.sh

set -e

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${YELLOW}🕷️ SPIDERSAN DEMO${NC}"
echo ""
sleep 2

# Frame 1: Before (DORMANT)
echo "$ spidersan pulse"
sleep 1
echo -e "${GREEN}╭─────────────────────────────────────╮${NC}"
echo -e "${GREEN}│  💤 Web Health: DORMANT             │${NC}"
echo -e "${GREEN}╰─────────────────────────────────────╯${NC}"
echo "   📊 Registry: 0 active threads"
sleep 3
clear

# Frame 2: Chaos begins
echo -e "${YELLOW}10 agents. 1 file. No coordination.${NC}"
sleep 2
echo ""
echo "$ git checkout -b agent1/feature"
echo "$ git checkout -b agent2/feature"
echo "$ git checkout -b agent3/feature"
sleep 2
clear

# Frame 3: CHAOS
echo "$ spidersan conflicts"
sleep 1
echo -e "${RED}⚠️  CONFLICTS DETECTED${NC}"
echo ""
echo -e "${RED}╭─────────────────────────────────────╮${NC}"
echo -e "${RED}│  💥 3 agents editing same file      │${NC}"
echo -e "${RED}│  formation.ts (lines 45-67)         │${NC}"
echo -e "${RED}╰─────────────────────────────────────╯${NC}"
sleep 3
clear

# Frame 4: Dramatic pause
echo ""
echo ""
echo -e "${YELLOW}...${NC}"
echo ""
echo ""
sleep 2
clear

# Frame 5: Spider activated
echo -e "${GREEN}Then we turned the spider on${NC}"
sleep 1
echo ""
echo "$ spidersan conflicts"
sleep 1
echo -e "${GREEN}✅ Conflict detection: ACTIVE${NC}"
echo "   🗺️ Mappersan → formation.ts"
echo "   🐦 Birdsan → formation.ts"
echo "   ⚠️  Overlap detected"
sleep 3
clear

# Frame 6: Merge order
echo "$ spidersan merge-order"
sleep 1
echo -e "${GREEN}🎯 OPTIMAL MERGE ORDER${NC}"
echo ""
echo "1. 🌊 Watsan"
echo "   ↓"
echo "2. 🕵️ Sherlocksan"
echo "   ↓"
echo "3. 🗺️ Mappersan"
echo "   ↓"
echo "4. 🐦 Birdsan"
echo ""
echo "⭐⭐⭐⭐⭐ 98% confidence"
sleep 4
clear

# Frame 7: Success
echo -e "${GREEN}✅ Merged successfully${NC}"
echo ""
echo "   51 min → 5 min"
echo "   12 conflicts → 0"
echo "   🔥🔥🔥🔥🔥 → 🔥"
sleep 3
clear

# Frame 8: Tagline
echo ""
echo ""
echo -e "${GREEN}🕷️ SPIDERSAN${NC}"
echo ""
echo -e "${YELLOW}Coordination for the multi-agent era${NC}"
echo ""
echo ""
sleep 3
