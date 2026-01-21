#!/usr/bin/env bash
# Spidersan Demo GIF Recording Script
# Run with: asciinema rec demo.cast --command ./scripts/demo-recording.sh

set -euo pipefail

GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

printc() {
    printf "%b\n" "$1"
}

pause() {
    sleep "${1:-1}"
}

clear
printc "${YELLOW}SPIDERSAN DEMO${NC}"
echo ""
pause 2

# Frame 1: Before (DORMANT)
printc "$ spidersan pulse"
pause 1
printc "${GREEN}+-------------------------------------+${NC}"
printc "${GREEN}|  Web Health: DORMANT                |${NC}"
printc "${GREEN}+-------------------------------------+${NC}"
printc "   Registry: 0 active threads"
pause 3
clear

# Frame 2: Chaos begins
printc "${YELLOW}10 agents. 1 file. No coordination.${NC}"
pause 2
echo ""
printc "$ git checkout -b agent1/feature"
printc "$ git checkout -b agent2/feature"
printc "$ git checkout -b agent3/feature"
pause 2
clear

# Frame 3: CHAOS
printc "$ spidersan conflicts"
pause 1
printc "${RED}WARNING: CONFLICTS DETECTED${NC}"
echo ""
printc "${RED}+-------------------------------------+${NC}"
printc "${RED}|  3 agents editing same file         |${NC}"
printc "${RED}|  formation.ts (lines 45-67)         |${NC}"
printc "${RED}+-------------------------------------+${NC}"
pause 3
clear

# Frame 4: Dramatic pause
printc ""
printc "${YELLOW}...${NC}"
printc ""
pause 2
clear

# Frame 5: Spider activated
printc "${GREEN}Then we turned the spider on${NC}"
pause 1
echo ""
printc "$ spidersan conflicts"
pause 1
printc "${GREEN}Conflict detection: ACTIVE${NC}"
printc "   Mappersan -> formation.ts"
printc "   Birdsan   -> formation.ts"
printc "   Overlap detected"
pause 3
clear

# Frame 6: Merge order
printc "$ spidersan merge-order"
pause 1
printc "${GREEN}OPTIMAL MERGE ORDER${NC}"
echo ""
printc "1. Watsan"
printc "   |"
printc "2. Sherlocksan"
printc "   |"
printc "3. Mappersan"
printc "   |"
printc "4. Birdsan"
echo ""
printc "Score: 98% confidence"
pause 4
clear

# Frame 7: Success
printc "${GREEN}Merged successfully${NC}"
echo ""
printc "   51 min -> 5 min"
printc "   12 conflicts -> 0"
printc "   Burnout -> calm"
pause 3
clear

# Frame 8: Tagline
printc ""
printc "${GREEN}SPIDERSAN${NC}"
printc ""
printc "${YELLOW}Coordination for the multi-agent era${NC}"
printc ""
pause 3
