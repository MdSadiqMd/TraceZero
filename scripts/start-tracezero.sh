#!/bin/bash
set -e  # Exit on any error

# This script handles all the setup needed to run TRACE_ZERO:
# - Starts Tor network via Docker
# - Builds Solana programs if needed
# - Fixes IDL addresses
# - Verifies program IDs
# - Clears old relayer state
# - Sets up treasury wallet (separate from deposit wallet for privacy)
# - Starts the relayer

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$PROJECT_ROOT"

# STEP 1: Check Prerequisites
echo -e "${BLUE}[STEP_01] Checking prerequisites...${NC}"

if ! docker info > /dev/null 2>&1; then
    echo -e "${RED}✗ Docker is not running. Please start Docker Desktop and try again.${NC}"
    exit 1
fi
echo -e "${GREEN}✓ Docker is running${NC}"

if ! command -v solana &> /dev/null; then
    echo -e "${RED}✗ Solana CLI not found. Install from: https://docs.solana.com/cli/install-solana-cli-tools${NC}"
    exit 1
fi
echo -e "${GREEN}✓ Solana CLI installed${NC}"

if ! command -v anchor &> /dev/null; then
    echo -e "${RED}✗ Anchor not found. Install from: https://www.anchor-lang.com/docs/installation${NC}"
    exit 1
fi
echo -e "${GREEN}✓ Anchor installed${NC}"

if ! command -v cargo &> /dev/null; then
    echo -e "${RED}✗ Rust/Cargo not found. Install from: https://rustup.rs/${NC}"
    exit 1
fi
echo -e "${GREEN}✓ Rust/Cargo installed${NC}"

if ! command -v yarn &> /dev/null; then
    echo -e "${RED}✗ Yarn not found. Install with: npm install -g yarn${NC}"
    exit 1
fi
echo -e "${GREEN}✓ Yarn installed${NC}"

# STEP 1.5: Stop any existing relayer processes
echo ""
echo -e "${BLUE}[STEP_01.5] Checking for existing relayer processes...${NC}"
EXISTING_RELAYER=$(pgrep -f "target/release/relayer" || true)
if [ -n "$EXISTING_RELAYER" ]; then
    echo -e "${YELLOW}Found existing relayer process(es): $EXISTING_RELAYER${NC}"
    echo -e "${YELLOW}Stopping existing relayer...${NC}"
    pkill -f "target/release/relayer" || true
    sleep 2
    echo -e "${GREEN}✓ Stopped existing relayer${NC}"
else
    echo -e "${GREEN}✓ No existing relayer processes found${NC}"
fi

if [ ! -d "$PROJECT_ROOT/programs/privacy_proxy/node_modules" ]; then
    echo -e "${YELLOW}Installing dependencies for init script...${NC}"
    cd "$PROJECT_ROOT/programs/privacy_proxy"
    yarn install --silent
    echo -e "${GREEN}✓ Dependencies installed${NC}"
fi

# STEP 2: Detect Environment (Localhost vs Devnet)
echo ""
echo -e "${BLUE}[STEP_02] Detecting environment...${NC}"

SOLANA_URL=$(solana config get | grep "RPC URL" | awk '{print $3}')
echo -e "Current Solana RPC: ${YELLOW}$SOLANA_URL${NC}"

if [[ "$SOLANA_URL" == *"localhost"* ]] || [[ "$SOLANA_URL" == *"127.0.0.1"* ]]; then
    ENV="localhost"
    RPC_URL="http://localhost:8899"
    echo -e "${GREEN}✓ Running in LOCALHOST mode${NC}"
elif [[ "$SOLANA_URL" == *"devnet"* ]]; then
    ENV="devnet"
    RPC_URL="https://api.devnet.solana.com"
    echo -e "${GREEN}✓ Running in DEVNET mode${NC}"
else
    echo -e "${YELLOW}⚠ Unknown environment. Defaulting to LOCALHOST.${NC}"
    ENV="localhost"
    RPC_URL="http://localhost:8899"
    solana config set --url localhost
fi

# STEP 3: Build Solana Programs (if needed)
echo ""
echo -e "${BLUE}[STEP_03] Checking Solana programs...${NC}"

cd "$PROJECT_ROOT/programs/privacy_proxy"

# Check if programs are built
NEED_BUILD=false
if [ ! -f "target/deploy/privacy_proxy.so" ] || [ ! -f "target/deploy/zk_verifier.so" ]; then
    echo -e "${YELLOW}Programs not found. Building...${NC}"
    NEED_BUILD=true
else
    # Check if source files are newer than built programs
    if [ -n "$(find programs -name '*.rs' -newer target/deploy/privacy_proxy.so 2>/dev/null)" ]; then
        echo -e "${YELLOW}Source files changed. Rebuilding...${NC}"
        NEED_BUILD=true
    else
        echo -e "${GREEN}✓ Programs already built${NC}"
    fi
fi

if [ "$NEED_BUILD" = true ]; then
    echo -e "${CYAN}Building Anchor programs (this may take a few minutes)...${NC}"
    anchor build
    echo -e "${GREEN}✓ Programs built${NC}"
fi

# STEP 4: Fix IDL Addresses (CRITICAL)
echo ""
echo -e "${BLUE}[STEP_04] Fixing IDL addresses...${NC}"

if [ -f "scripts/fix-idl.sh" ]; then
    bash scripts/fix-idl.sh
    echo -e "${GREEN}✓ IDL addresses fixed${NC}"
else
    echo -e "${YELLOW}⚠ fix-idl.sh not found, fixing manually...${NC}"
    python3 -c "
import json
f=open('target/idl/privacy_proxy.json','r')
d=json.load(f)
f.close()
if d['address'] != 'Dzpj74oeEhpyXwaiLUFKgzVz1Dcj4ZobsoczYdHiMaB3':
    d['address']='Dzpj74oeEhpyXwaiLUFKgzVz1Dcj4ZobsoczYdHiMaB3'
    f=open('target/idl/privacy_proxy.json','w')
    json.dump(d,f,indent=2)
    f.close()
    print('Fixed privacy_proxy IDL address')
else:
    print('privacy_proxy IDL address already correct')
"
    echo -e "${GREEN}✓ IDL fixed${NC}"
fi

# STEP 5: Verify Program IDs
echo ""
echo -e "${BLUE}[STEP_05] Verifying program IDs...${NC}"

PRIVACY_PROXY_ID=$(solana address -k target/deploy/privacy_proxy-keypair.json)
ZK_VERIFIER_ID=$(solana address -k target/deploy/zk_verifier-keypair.json)

echo -e "privacy_proxy: ${CYAN}$PRIVACY_PROXY_ID${NC}"
echo -e "zk_verifier:   ${CYAN}$ZK_VERIFIER_ID${NC}"

EXPECTED_PRIVACY_PROXY="Dzpj74oeEhpyXwaiLUFKgzVz1Dcj4ZobsoczYdHiMaB3"
EXPECTED_ZK_VERIFIER_LOCALHOST="AL6EfrDUdBdwqwrrA1gsq3KwfSJs4wLq4BKyABAzsqvA"
EXPECTED_ZK_VERIFIER_DEVNET="2ntZ79MomBLsLyaExjGW6F7kkYtmprhdzZzQaMXSMZRu"

if [ "$PRIVACY_PROXY_ID" != "$EXPECTED_PRIVACY_PROXY" ]; then
    echo -e "${RED}✗ privacy_proxy ID mismatch!${NC}"
    echo -e "  Expected: $EXPECTED_PRIVACY_PROXY"
    echo -e "  Got:      $PRIVACY_PROXY_ID"
    echo -e "${YELLOW}⚠ Update Anchor.toml and crates/relayer/src/config.rs${NC}"
fi

if [ "$ENV" == "localhost" ]; then
    if [ "$ZK_VERIFIER_ID" != "$EXPECTED_ZK_VERIFIER_LOCALHOST" ]; then
        echo -e "${YELLOW}⚠ zk_verifier ID mismatch (localhost)${NC}"
        echo -e "  Expected: $EXPECTED_ZK_VERIFIER_LOCALHOST"
        echo -e "  Got:      $ZK_VERIFIER_ID"
    fi
else
    if [ "$ZK_VERIFIER_ID" != "$EXPECTED_ZK_VERIFIER_DEVNET" ]; then
        echo -e "${YELLOW}⚠ zk_verifier ID mismatch (devnet)${NC}"
        echo -e "  Expected: $EXPECTED_ZK_VERIFIER_DEVNET"
        echo -e "  Got:      $ZK_VERIFIER_ID"
    fi
fi

echo -e "${GREEN}✓ Program IDs verified${NC}"

# STEP 6: Start Tor Network
echo ""
echo -e "${BLUE}[STEP_06] Starting Tor network...${NC}"

cd "$PROJECT_ROOT/crates/network"

if docker ps | grep -q "tracezero-tor"; then
    echo -e "${GREEN}✓ Tor container already running${NC}"
else
    echo -e "${YELLOW}Starting Tor container...${NC}"
    docker compose up -d

    echo -e "${YELLOW}Waiting for Tor to bootstrap (30 seconds)...${NC}"
    sleep 30

    TOR_CHECK=$(curl -s http://localhost:3080/verify-tor 2>/dev/null || echo "failed")
    if [[ "$TOR_CHECK" == *"isTor"* ]]; then
        echo -e "${GREEN}✓ Tor network is running${NC}"
    else
        echo -e "${YELLOW}⚠ Tor may still be bootstrapping. Check with: curl http://localhost:3080/verify-tor${NC}"
    fi
fi

# STEP 7: Initialize Protocol (localhost and devnet)
echo ""
echo -e "${BLUE}[STEP_07] Checking protocol initialization...${NC}"

cd "$PROJECT_ROOT/programs/privacy_proxy"

if [ ! -f "target/idl/privacy_proxy.json" ]; then
    echo -e "${RED}✗ IDL file not found. Programs must be built first.${NC}"
    echo -e "${YELLOW}Building programs now...${NC}"
    anchor build
    bash scripts/fix-idl.sh 2>/dev/null || true
fi

if [ "$ENV" == "localhost" ]; then
    if solana cluster-version --url localhost &> /dev/null; then
        echo -e "${GREEN}✓ Validator is running${NC}"

        echo -e "${YELLOW}Initializing protocol on localhost...${NC}"
        RPC_URL=$RPC_URL npx ts-node scripts/init-program.ts 2>&1 | grep -E "(✓|✗|Error|Success|Already|Initialized)" || true
        echo -e "${GREEN}✓ Protocol initialization complete${NC}"
    else
        echo -e "${RED}✗ Validator not running${NC}"
        echo -e "${YELLOW}Please start the validator first:${NC}"
        echo -e "${CYAN}  surfpool start${NC}"
        echo ""
        echo -e "${YELLOW}Then run this script again.${NC}"
        exit 1
    fi
else
    echo -e "${YELLOW}Initializing protocol on devnet...${NC}"
    echo -e "${CYAN}This may take a moment and cost ~0.5 SOL in fees...${NC}"

    BALANCE=$(solana balance --url devnet 2>/dev/null | awk '{print $1}' || echo "0")
    BALANCE_INT=$(echo "$BALANCE" | cut -d. -f1)

    if [ "$BALANCE_INT" -lt 1 ]; then
        echo -e "${RED}✗ Insufficient balance: ${BALANCE} SOL${NC}"
        echo -e "${YELLOW}You need at least 1 SOL on devnet to initialize the protocol${NC}"
        echo -e "${CYAN}Get devnet SOL from:${NC}"
        echo -e "  • https://faucet.solana.com/"
        echo -e "  • https://faucet.quicknode.com/solana/devnet"
        echo ""
        read -p "Press Enter after funding your wallet, or Ctrl+C to exit..."
    fi

    npx ts-node scripts/init-program.ts 2>&1 | grep -E "(✓|✗|Error|Success|Already|Initialized)" || true

    if [ $? -ne 0 ]; then
        echo -e "${YELLOW}⚠ Initialization may have failed. Check the output above.${NC}"
    else
        echo -e "${GREEN}✓ Protocol initialization complete${NC}"
    fi
fi

# STEP 8: Handle Merkle State (Smart Recovery)
echo ""
echo -e "${BLUE}[STEP_08] Checking merkle state...${NC}"

cd "$PROJECT_ROOT"

# Check if merkle_state exists and has actual data
STATE_HAS_DATA=false
if [ -d "crates/relayer/merkle_state" ]; then
    # Check if any bucket files exist with data
    for bucket_file in crates/relayer/merkle_state/bucket_*.json; do
        if [ -f "$bucket_file" ]; then
            COMMIT_COUNT=$(cat "$bucket_file" | jq '.commitments | length' 2>/dev/null || echo "0")
            if [ "$COMMIT_COUNT" -gt 0 ]; then
                STATE_HAS_DATA=true
                echo -e "${GREEN}✓ Merkle state found with $COMMIT_COUNT commitments - will preserve existing deposits${NC}"
                break
            fi
        fi
    done
fi

if [ "$STATE_HAS_DATA" = false ]; then
    # No valid state data - determine what to do based on environment
    echo -e "${YELLOW}No valid merkle state found (empty or missing)${NC}"
    
    if [ "$ENV" == "localhost" ]; then
        # Localhost: Safe to start fresh (development environment)
        echo -e "${CYAN}  Localhost mode: Starting fresh with empty tree${NC}"
        echo -e "${CYAN}  Setting ALLOW_UNSAFE_EMPTY_TREE=true for development${NC}"
        export ALLOW_UNSAFE_EMPTY_TREE=true
    else
        # Devnet: Check for backups first
        echo -e "${YELLOW}  Devnet mode: Checking for backups...${NC}"
        
        # Look for backups with actual data
        BACKUP_FOUND=false
        
        if ls -d merkle_state_backup_* >/dev/null 2>&1; then
            for backup_dir in $(ls -dt merkle_state_backup_* 2>/dev/null); do
                # Check if this backup has actual data
                for bucket_file in "$backup_dir"/bucket_*.json; do
                    if [ -f "$bucket_file" ]; then
                        COMMIT_COUNT=$(cat "$bucket_file" | jq '.commitments | length' 2>/dev/null || echo "0")
                        if [ "$COMMIT_COUNT" -gt 0 ]; then
                            echo -e "${GREEN}✓ Found backup with data: $backup_dir ($COMMIT_COUNT commitments)${NC}"
                            echo -e "${CYAN}  Restoring from backup...${NC}"
                            mkdir -p crates/relayer/merkle_state
                            cp -r "$backup_dir"/* crates/relayer/merkle_state/
                            BACKUP_FOUND=true
                            echo -e "${GREEN}✓ Restored from backup${NC}"
                            break 2
                        fi
                    fi
                done
            done
        fi
        
        if [ "$BACKUP_FOUND" = false ]; then
            # No backup with data found
            echo -e "${YELLOW}  No backup with data found${NC}"
            echo -e "${YELLOW}  This appears to be a fresh deployment or testing environment${NC}"
            echo -e "${CYAN}  Setting ALLOW_UNSAFE_EMPTY_TREE=true for devnet${NC}"
            echo -e "${YELLOW}  Note: If you have existing deposits, restore merkle_state/ from backup${NC}"
            export ALLOW_UNSAFE_EMPTY_TREE=true
        fi
    fi
fi

# Clean up old state files in wrong locations
STATE_CLEANED=false

if [ -d "merkle_state" ]; then
    echo -e "${YELLOW}Moving merkle_state/ from root to crates/relayer/${NC}"
    mkdir -p crates/relayer/merkle_state
    cp -r merkle_state/* crates/relayer/merkle_state/ 2>/dev/null || true
    rm -rf merkle_state/
    STATE_CLEANED=true
fi

if [ -f "used_tokens.dat" ] || [ -f "used_tokens.checksum" ]; then
    echo -e "${YELLOW}Moving token store files to crates/relayer/${NC}"
    mv used_tokens.dat crates/relayer/ 2>/dev/null || true
    mv used_tokens.checksum crates/relayer/ 2>/dev/null || true
    STATE_CLEANED=true
fi

if [ "$STATE_CLEANED" = true ]; then
    echo -e "${GREEN}✓ State files organized${NC}"
fi

# STEP 9: Setup Treasury Wallet (Privacy)
echo ""
echo -e "${BLUE}[STEP_09] Setting up treasury wallet...${NC}"

cd "$PROJECT_ROOT"

# Use secure location outside project directory
TREASURY_DIR="$HOME/.config/tracezero"
TREASURY_PATH="$TREASURY_DIR/treasury.json"

# Create secure directory if it doesn't exist
if [ ! -d "$TREASURY_DIR" ]; then
    mkdir -p "$TREASURY_DIR"
    chmod 700 "$TREASURY_DIR"
    echo -e "${GREEN}✓ Created secure treasury directory: ${CYAN}$TREASURY_DIR${NC}"
fi

if [ -f "$TREASURY_PATH" ]; then
    TREASURY_PUBKEY=$(solana-keygen pubkey "$TREASURY_PATH")
    echo -e "${GREEN}✓ Treasury wallet exists: ${CYAN}$TREASURY_PUBKEY${NC}"
    
    # Ensure secure permissions
    chmod 600 "$TREASURY_PATH"
else
    # Check if old treasury.json exists in project root
    if [ -f "$PROJECT_ROOT/treasury.json" ]; then
        echo -e "${YELLOW}Found treasury.json in project root. Moving to secure location...${NC}"
        mv "$PROJECT_ROOT/treasury.json" "$TREASURY_PATH"
        chmod 600 "$TREASURY_PATH"
        TREASURY_PUBKEY=$(solana-keygen pubkey "$TREASURY_PATH")
        echo -e "${GREEN}✓ Treasury wallet moved to: ${CYAN}$TREASURY_PATH${NC}"
        echo -e "${GREEN}✓ Treasury pubkey: ${CYAN}$TREASURY_PUBKEY${NC}"
    else
        echo -e "${YELLOW}Generating treasury wallet (separate from deposit wallet for privacy)...${NC}"
        solana-keygen new -o "$TREASURY_PATH" --no-bip39-passphrase --silent
        chmod 600 "$TREASURY_PATH"
        TREASURY_PUBKEY=$(solana-keygen pubkey "$TREASURY_PATH")
        echo -e "${GREEN}✓ Treasury wallet created: ${CYAN}$TREASURY_PUBKEY${NC}"
        echo -e "${YELLOW}  PRIVACY: Credit payments go to this wallet.${NC}"
        echo -e "${YELLOW}  Pool deposits use the main keypair (different address).${NC}"
        echo -e "${YELLOW}  This breaks the on-chain trace chain.${NC}"
    fi
fi

DEPOSIT_PUBKEY=$(solana-keygen pubkey)
echo -e "  Deposit wallet:  ${CYAN}$DEPOSIT_PUBKEY${NC} (pool operations)"
echo -e "  Treasury wallet: ${CYAN}$TREASURY_PUBKEY${NC} (credit payments)"

if [ "$DEPOSIT_PUBKEY" == "$TREASURY_PUBKEY" ]; then
    echo -e "${RED}WARNING: Treasury and deposit wallets are the same!${NC}"
    echo -e "${RED}This defeats the privacy separation. Generate a new treasury.json.${NC}"
fi

# STEP 10: Build Relayer (if needed)
echo ""
echo -e "${BLUE}[STEP_10] Checking relayer build...${NC}"

cd "$PROJECT_ROOT"

NEED_RELAYER_BUILD=false
if [ ! -f "target/release/relayer" ]; then
    echo -e "${YELLOW}Relayer not built. Building...${NC}"
    NEED_RELAYER_BUILD=true
else
    if [ -n "$(find crates/relayer/src -name '*.rs' -newer target/release/relayer 2>/dev/null)" ]; then
        echo -e "${YELLOW}Relayer source changed. Rebuilding...${NC}"
        NEED_RELAYER_BUILD=true
    else
        echo -e "${GREEN}✓ Relayer already built${NC}"
    fi
fi

if [ "$NEED_RELAYER_BUILD" = true ]; then
    echo -e "${CYAN}Building relayer (this may take a few minutes)...${NC}"
    cargo build --release -p relayer 2>&1 | grep -E "(Compiling|Finished|error)" || true
    echo -e "${GREEN}✓ Relayer built${NC}"
fi

# STEP 11: Create Backup Before Starting
echo ""
echo -e "${BLUE}[STEP_11] Creating backup of current state...${NC}"

cd "$PROJECT_ROOT"

# Only backup if there's actual data
SHOULD_BACKUP=false
if [ -d "crates/relayer/merkle_state" ]; then
    for bucket_file in crates/relayer/merkle_state/bucket_*.json; do
        if [ -f "$bucket_file" ]; then
            COMMIT_COUNT=$(cat "$bucket_file" | jq '.commitments | length' 2>/dev/null || echo "0")
            if [ "$COMMIT_COUNT" -gt 0 ]; then
                SHOULD_BACKUP=true
                break
            fi
        fi
    done
fi

if [ "$SHOULD_BACKUP" = true ]; then
    TIMESTAMP=$(date +%Y%m%d_%H%M%S)
    BACKUP_DIR="merkle_state_backup_$TIMESTAMP"
    
    echo -e "${CYAN}Creating backup: $BACKUP_DIR${NC}"
    cp -r crates/relayer/merkle_state "$BACKUP_DIR"
    
    # Keep only last 10 backups
    BACKUP_COUNT=$(ls -d merkle_state_backup_* 2>/dev/null | wc -l)
    if [ "$BACKUP_COUNT" -gt 10 ]; then
        echo -e "${YELLOW}Cleaning up old backups (keeping last 10)...${NC}"
        ls -dt merkle_state_backup_* | tail -n +11 | xargs rm -rf
    fi
    
    echo -e "${GREEN}✓ Backup created${NC}"
else
    echo -e "${YELLOW}No state data to backup (empty or fresh start)${NC}"
fi

# STEP 12: Start Relayer
echo ""
echo -e "${BLUE}[STEP_12] Starting relayer...${NC}"

if pgrep -f "target/release/relayer" > /dev/null; then
    echo -e "${YELLOW}Killing existing relayer process...${NC}"
    pkill -f "target/release/relayer"
    sleep 2
fi

cd "$PROJECT_ROOT/crates/relayer"

echo -e "${GREEN}Starting relayer with RPC_URL=$RPC_URL${NC}"
echo -e "${GREEN}Treasury wallet: $TREASURY_PATH${NC}"
echo -e "${CYAN}State files will be stored in: crates/relayer/${NC}"
echo ""

# Show startup mode
if [ "$ALLOW_UNSAFE_EMPTY_TREE" = "true" ]; then
    echo -e "${YELLOW}  STARTUP MODE: Fresh Start (Empty Tree)${NC}"
    echo -e "${YELLOW}  ALLOW_UNSAFE_EMPTY_TREE=true${NC}"
    if [ "$ENV" == "localhost" ]; then
        echo -e "${GREEN}  ✓ Safe for localhost development${NC}"
    else
        echo -e "${YELLOW}  ⚠ Devnet mode - ensure no existing deposits${NC}"
    fi
else
    echo -e "${GREEN}  STARTUP MODE: Normal (Preserving Existing State)${NC}"
    echo -e "${GREEN}  Existing deposits will remain withdrawable${NC}"
    echo -e "${GREEN}  Automatic backups enabled${NC}"
fi
echo ""
echo -e "${CYAN}Logs will appear below...${NC}"
echo ""

export RPC_URL=$RPC_URL
export RUST_LOG=info
export TREASURY_KEYPAIR_PATH="$TREASURY_PATH"

exec cargo run --release -p relayer
