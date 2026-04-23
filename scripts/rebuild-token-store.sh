#!/bin/bash
# Rebuild token store from on-chain UsedToken accounts
# Use this script to recover from token store corruption

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${BLUE}=== Token Store Rebuild Utility ===${NC}"
echo ""

# Check if relayer is running
if ! pgrep -f "target/release/relayer" > /dev/null; then
    echo -e "${RED}✗ Relayer is not running${NC}"
    echo -e "${YELLOW}Start the relayer first: ./scripts/start-tracezero.sh${NC}"
    exit 1
fi

echo -e "${GREEN}✓ Relayer is running${NC}"
echo ""

# Check current token store stats
echo -e "${BLUE}[STEP 1] Checking current token store...${NC}"
STATS=$(curl -s http://localhost:8080/admin/token_store_stats)
CURRENT_COUNT=$(echo "$STATS" | jq -r '.token_count')
CURRENT_CHECKSUM=$(echo "$STATS" | jq -r '.checksum')

echo -e "Current token count: ${YELLOW}$CURRENT_COUNT${NC}"
echo -e "Current checksum: ${YELLOW}${CURRENT_CHECKSUM:0:16}...${NC}"
echo ""

# Confirm rebuild
echo -e "${YELLOW}⚠ WARNING: This will rebuild the token store from on-chain data${NC}"
echo -e "${YELLOW}⚠ This operation may take a few seconds${NC}"
echo ""
read -p "Continue? (y/N) " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo -e "${BLUE}Cancelled${NC}"
    exit 0
fi

# Backup current store
echo ""
echo -e "${BLUE}[STEP 2] Backing up current token store...${NC}"
if [ -f "used_tokens.dat" ]; then
    BACKUP_NAME="used_tokens_backup_$(date +%Y%m%d_%H%M%S).dat"
    cp used_tokens.dat "$BACKUP_NAME"
    echo -e "${GREEN}✓ Backed up to $BACKUP_NAME${NC}"
else
    echo -e "${YELLOW}⚠ No existing token store found${NC}"
fi

# Rebuild from on-chain
echo ""
echo -e "${BLUE}[STEP 3] Rebuilding from on-chain data...${NC}"
echo -e "${YELLOW}This may take a few seconds...${NC}"

RESULT=$(curl -s -X POST http://localhost:8080/admin/rebuild_token_store)
SUCCESS=$(echo "$RESULT" | jq -r '.success')
TOKENS_REBUILT=$(echo "$RESULT" | jq -r '.tokens_rebuilt')
ERROR=$(echo "$RESULT" | jq -r '.error')

if [ "$SUCCESS" = "true" ]; then
    echo -e "${GREEN}✓ Successfully rebuilt token store${NC}"
    echo -e "Tokens rebuilt: ${GREEN}$TOKENS_REBUILT${NC}"
else
    echo -e "${RED}✗ Rebuild failed${NC}"
    echo -e "${RED}Error: $ERROR${NC}"
    exit 1
fi

# Verify new stats
echo ""
echo -e "${BLUE}[STEP 4] Verifying new token store...${NC}"
NEW_STATS=$(curl -s http://localhost:8080/admin/token_store_stats)
NEW_COUNT=$(echo "$NEW_STATS" | jq -r '.token_count')
NEW_CHECKSUM=$(echo "$NEW_STATS" | jq -r '.checksum')

echo -e "New token count: ${GREEN}$NEW_COUNT${NC}"
echo -e "New checksum: ${GREEN}${NEW_CHECKSUM:0:16}...${NC}"
echo ""

# Compare
if [ "$NEW_COUNT" -gt "$CURRENT_COUNT" ]; then
    DIFF=$((NEW_COUNT - CURRENT_COUNT))
    echo -e "${GREEN}✓ Added $DIFF tokens from on-chain${NC}"
elif [ "$NEW_COUNT" -lt "$CURRENT_COUNT" ]; then
    DIFF=$((CURRENT_COUNT - NEW_COUNT))
    echo -e "${YELLOW}⚠ Token count decreased by $DIFF${NC}"
    echo -e "${YELLOW}⚠ This may indicate local store had invalid entries${NC}"
elif [ "$NEW_COUNT" -eq "$CURRENT_COUNT" ]; then
    echo -e "${GREEN}✓ Token count unchanged (already in sync)${NC}"
fi

# Summary
echo ""
echo -e "${BLUE}=== Rebuild Complete ===${NC}"
echo ""
echo -e "${GREEN}Summary:${NC}"
echo "  Before: $CURRENT_COUNT tokens"
echo "  After:  $NEW_COUNT tokens"
echo "  Rebuilt: $TOKENS_REBUILT tokens from on-chain"
echo ""
echo -e "${BLUE}Next steps:${NC}"
echo "  1. Monitor relayer logs for any issues"
echo "  2. Test deposit functionality"
echo "  3. Verify no double-spend attempts succeed"
echo ""
echo -e "${GREEN}✓ Token store rebuild successful${NC}"
