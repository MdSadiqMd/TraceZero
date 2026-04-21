#!/bin/bash
# Merkle State Recovery Script
# Recovers merkle tree state from on-chain transaction history

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

echo -e "${CYAN}  Merkle State Recovery Script${NC}"
echo -e "${CYAN}  Recovers tree state from on-chain transaction history${NC}"
echo ""

# Check if merkle_state exists
if [ -d "merkle_state" ]; then
    echo -e "${YELLOW}⚠ merkle_state/ directory exists${NC}"
    echo -e "${YELLOW}  This script will attempt to recover missing state${NC}"
    echo ""
    read -p "Continue? (y/N) " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        echo "Aborted"
        exit 1
    fi
fi

echo -e "${CYAN}Recovery Options:${NC}"
echo ""
echo -e "1. ${GREEN}Use archive node${NC} (recommended for production)"
echo -e "   - Fetches complete transaction history"
echo -e "   - Requires archive RPC endpoint"
echo -e "   - Takes longer but most reliable"
echo ""
echo -e "2. ${YELLOW}Allow unsafe empty tree${NC} (ONLY for fresh deployments)"
echo -e "   - Starts with empty tree"
echo -e "   - Old deposits will be UNWITHDRAWABLE"
echo -e "   - Use ONLY if no deposits exist yet"
echo ""
echo -e "3. ${CYAN}Restore from backup${NC} (if available)"
echo -e "   - Restores from previous backup"
echo -e "   - Most reliable if backup exists"
echo ""

read -p "Choose option (1/2/3): " -n 1 -r
echo
echo ""

case $REPLY in
    1)
        echo -e "${GREEN}Option 1: Using archive node${NC}"
        echo ""
        echo -e "${YELLOW}You need an archive RPC endpoint with full transaction history${NC}"
        echo ""
        echo "Examples:"
        echo "  - Helius: https://mainnet.helius-rpc.com/?api-key=YOUR_KEY"
        echo "  - QuickNode: https://your-endpoint.quiknode.pro/YOUR_KEY/"
        echo "  - Alchemy: https://solana-mainnet.g.alchemy.com/v2/YOUR_KEY"
        echo ""
        read -p "Enter archive RPC URL: " ARCHIVE_RPC
        
        if [ -z "$ARCHIVE_RPC" ]; then
            echo -e "${RED}Error: RPC URL cannot be empty${NC}"
            exit 1
        fi
        
        echo ""
        echo -e "${CYAN}Starting relayer with archive node...${NC}"
        echo -e "${YELLOW}This may take several minutes to sync...${NC}"
        echo ""
        
        # Set environment and start relayer
        export RPC_URL="$ARCHIVE_RPC"
        export RUST_LOG=info
        
        # The relayer will now be able to fetch full history
        cargo run --release -p relayer
        ;;
        
    2)
        echo -e "${RED}Option 2: Allow unsafe empty tree${NC}"
        echo ""
        echo -e "${RED}⚠ WARNING: This will make old deposits UNWITHDRAWABLE!${NC}"
        echo -e "${RED}⚠ Only use this if:${NC}"
        echo -e "${RED}  - This is a fresh deployment with NO existing deposits${NC}"
        echo -e "${RED}  - You are testing in a development environment${NC}"
        echo -e "${RED}  - You understand the risks${NC}"
        echo ""
        read -p "Are you ABSOLUTELY SURE? Type 'yes' to continue: " CONFIRM
        
        if [ "$CONFIRM" != "yes" ]; then
            echo "Aborted"
            exit 1
        fi
        
        echo ""
        echo -e "${YELLOW}Starting relayer with empty tree override...${NC}"
        echo ""
        
        # Set override and start relayer
        export ALLOW_UNSAFE_EMPTY_TREE=true
        export RUST_LOG=info
        
        cargo run --release -p relayer
        ;;
        
    3)
        echo -e "${CYAN}Option 3: Restore from backup${NC}"
        echo ""
        
        # Look for backups
        if [ -d "merkle_state_backup"* ]; then
            echo -e "${GREEN}Found backup directories:${NC}"
            ls -d merkle_state_backup* 2>/dev/null || true
            echo ""
        fi
        
        read -p "Enter backup directory path: " BACKUP_DIR
        
        if [ ! -d "$BACKUP_DIR" ]; then
            echo -e "${RED}Error: Backup directory not found: $BACKUP_DIR${NC}"
            exit 1
        fi
        
        echo ""
        echo -e "${CYAN}Restoring from backup...${NC}"
        
        # Backup current state if it exists
        if [ -d "merkle_state" ]; then
            TIMESTAMP=$(date +%Y%m%d_%H%M%S)
            mv merkle_state "merkle_state_old_$TIMESTAMP"
            echo -e "${YELLOW}Moved existing state to: merkle_state_old_$TIMESTAMP${NC}"
        fi
        
        # Restore from backup
        cp -r "$BACKUP_DIR" merkle_state
        echo -e "${GREEN}✓ Restored from backup${NC}"
        echo ""
        
        # Verify restored state
        echo -e "${CYAN}Verifying restored state...${NC}"
        if [ -f "merkle_state/bucket_0.json" ]; then
            SIZE=$(cat merkle_state/bucket_0.json | jq '.commitments | length' 2>/dev/null || echo "unknown")
            echo -e "${GREEN}✓ Bucket 0: $SIZE commitments${NC}"
        fi
        
        echo ""
        echo -e "${GREEN}Starting relayer with restored state...${NC}"
        export RUST_LOG=info
        cargo run --release -p relayer
        ;;
        
    *)
        echo -e "${RED}Invalid option${NC}"
        exit 1
        ;;
esac
