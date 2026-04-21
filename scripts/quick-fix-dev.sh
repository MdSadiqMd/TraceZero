#!/bin/bash
# Quick fix for development environment
# This allows the relayer to start with empty tree for testing

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

echo -e "${CYAN}  Quick Fix for Development Environment${NC}"
echo ""

echo -e "${YELLOW}Current situation:${NC}"
echo -e "  - Relayer found 24 existing deposits on-chain"
echo -e "  - Local merkle_state/ is missing or empty"
echo -e "  - 100 transactions in history (too many to scan)"
echo ""

echo -e "${RED}⚠ WARNING:${NC}"
echo -e "  If you continue with empty tree, those 24 deposits will be UNWITHDRAWABLE"
echo -e "  This is OK for development/testing, but NOT for production"
echo ""

read -p "Is this a development/testing environment? (y/N) " -n 1 -r
echo
echo ""

if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo -e "${YELLOW}For production, use one of these options:${NC}"
    echo ""
    echo -e "1. ${GREEN}Restore from backup:${NC}"
    echo -e "   cp -r /path/to/backup/merkle_state/ ./merkle_state/"
    echo ""
    echo -e "2. ${GREEN}Use archive node:${NC}"
    echo -e "   export RPC_URL='https://archive-node-url'"
    echo -e "   cargo run --release -p relayer"
    echo ""
    echo -e "3. ${GREEN}Run recovery script:${NC}"
    echo -e "   ./scripts/recover-merkle-state.sh"
    echo ""
    exit 0
fi

echo -e "${YELLOW}Starting relayer with ALLOW_UNSAFE_EMPTY_TREE=true${NC}"
echo -e "${YELLOW}Old deposits will NOT be withdrawable${NC}"
echo ""

# Check if we should clear old state
if [ -d "merkle_state" ]; then
    echo -e "${YELLOW}Backing up existing merkle_state/...${NC}"
    TIMESTAMP=$(date +%Y%m%d_%H%M%S)
    mv merkle_state "merkle_state_backup_$TIMESTAMP"
    echo -e "${GREEN}✓ Backed up to: merkle_state_backup_$TIMESTAMP${NC}"
    echo ""
fi

# Set environment variables
export ALLOW_UNSAFE_EMPTY_TREE=true
export RUST_LOG=info
export RPC_URL="${RPC_URL:-http://localhost:8899}"

echo -e "${GREEN}Starting relayer...${NC}"
echo -e "${CYAN}Environment:${NC}"
echo -e "  ALLOW_UNSAFE_EMPTY_TREE=true"
echo -e "  RPC_URL=$RPC_URL"
echo ""

# Start relayer
cargo run --release -p relayer
