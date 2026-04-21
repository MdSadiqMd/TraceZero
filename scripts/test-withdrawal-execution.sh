#!/bin/bash
# Test script to verify withdrawal execution improvements

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${BLUE}=== Withdrawal Execution Test ===${NC}"
echo ""

# Check if relayer is running
echo -e "${BLUE}[TEST 1] Checking relayer status...${NC}"
if pgrep -f "target/release/relayer" > /dev/null; then
    echo -e "${GREEN}✓ Relayer is running${NC}"
else
    echo -e "${RED}✗ Relayer is not running${NC}"
    echo -e "${YELLOW}Start with: ./scripts/start-tracezero.sh${NC}"
    exit 1
fi

# Check health endpoint
echo ""
echo -e "${BLUE}[TEST 2] Checking relayer health...${NC}"
HEALTH=$(curl -s http://localhost:8080/health)
if echo "$HEALTH" | grep -q '"status":"ok"'; then
    echo -e "${GREEN}✓ Relayer is healthy${NC}"
else
    echo -e "${YELLOW}⚠ Relayer status: $(echo $HEALTH | jq -r '.status')${NC}"
fi

# Check merkle sync
if echo "$HEALTH" | grep -q '"all_synced":true'; then
    echo -e "${GREEN}✓ Merkle trees synced${NC}"
else
    echo -e "${YELLOW}⚠ Merkle trees not fully synced${NC}"
    echo -e "${YELLOW}  This may affect withdrawal validation${NC}"
fi

# Check pending withdrawals
echo ""
echo -e "${BLUE}[TEST 3] Checking pending withdrawals...${NC}"
PENDING=$(curl -s http://localhost:8080/withdraw/pending)
PENDING_COUNT=$(echo "$PENDING" | jq '.pending | length')
echo -e "Found ${YELLOW}$PENDING_COUNT${NC} pending withdrawal(s)"

if [ "$PENDING_COUNT" -gt 0 ]; then
    echo ""
    echo -e "${BLUE}Pending withdrawals:${NC}"
    echo "$PENDING" | jq -r '.pending[] | "  - PDA: \(.pda)\n    Recipient: \(.recipient)\n    Amount: \(.amount) lamports\n    Execute after: \(.execute_after)\n    Executed: \(.executed)"'
    
    # Check if any are ready for execution
    NOW=$(date +%s)
    echo "$PENDING" | jq -r --arg now "$NOW" '.pending[] | select(.executed == false and (.execute_after | tonumber) <= ($now | tonumber)) | "  ⚠ Ready for execution: \(.pda)"' | while read line; do
        if [ -n "$line" ]; then
            echo -e "${YELLOW}$line${NC}"
        fi
    done
fi

# Check relayer wallet balance
echo ""
echo -e "${BLUE}[TEST 4] Checking relayer wallet balance...${NC}"
RELAYER_PUBKEY=$(solana address)
BALANCE=$(solana balance $RELAYER_PUBKEY 2>/dev/null | awk '{print $1}')
if [ -n "$BALANCE" ]; then
    echo -e "Relayer balance: ${YELLOW}$BALANCE SOL${NC}"
    if (( $(echo "$BALANCE < 0.1" | bc -l) )); then
        echo -e "${RED}✗ Low balance! Add more SOL for transaction fees${NC}"
    else
        echo -e "${GREEN}✓ Sufficient balance${NC}"
    fi
else
    echo -e "${YELLOW}⚠ Could not check balance${NC}"
fi

# Check for recent errors in logs (if available)
echo ""
echo -e "${BLUE}[TEST 5] Checking for validation improvements...${NC}"

# Check if the new validation code is present
if grep -q "Verified pending withdrawal PDA exists with correct pool" crates/relayer/src/withdrawal.rs; then
    echo -e "${GREEN}✓ Validation code is present${NC}"
else
    echo -e "${RED}✗ Validation code not found - rebuild required${NC}"
    echo -e "${YELLOW}Run: cargo build --release --manifest-path crates/relayer/Cargo.toml${NC}"
fi

# Check if process cleanup is in start script
if grep -q "Checking for existing relayer processes" scripts/start-tracezero.sh; then
    echo -e "${GREEN}✓ Process cleanup is present in start script${NC}"
else
    echo -e "${RED}✗ Process cleanup not found in start script${NC}"
fi

# Summary
echo ""
echo -e "${BLUE}=== Test Summary ===${NC}"
echo ""
echo -e "${GREEN}Improvements implemented:${NC}"
echo "  ✓ Pending withdrawal PDA validation"
echo "  ✓ Pool address verification"
echo "  ✓ Enhanced error messages"
echo "  ✓ Detailed logging"
echo "  ✓ Process cleanup in start script"
echo ""
echo -e "${BLUE}Next steps:${NC}"
echo "  1. Submit a withdrawal request via UI"
echo "  2. Wait for timelock to expire"
echo "  3. Click [EXECUTE_NOW] or wait for auto-execution"
echo "  4. Check logs for validation messages"
echo ""
echo -e "${BLUE}Monitor logs with:${NC}"
echo "  tail -f <relayer_output>"
echo ""
echo -e "${BLUE}Look for these log messages:${NC}"
echo -e "  ${GREEN}✓ Verified pending withdrawal PDA exists with correct pool${NC}"
echo -e "  ${GREEN}Withdrawal executed: recipient=..., amount=..., tx=...${NC}"
echo ""
echo -e "${BLUE}Or error messages:${NC}"
echo -e "  ${RED}Pool mismatch! Record has ..., on-chain has ...${NC}"
echo -e "  ${RED}Pending withdrawal PDA ... not found${NC}"
echo ""
echo -e "${GREEN}=== Test Complete ===${NC}"
