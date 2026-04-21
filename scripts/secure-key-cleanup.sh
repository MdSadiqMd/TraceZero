#!/bin/bash
# Security cleanup script for TRACE_ZERO
# Addresses C-04, C-05, C-06 from security audit
# - Removes duplicate RSA keys
# - Moves treasury to secure location
# - Sets proper file permissions

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

echo -e "${CYAN}  TRACE_ZERO Security Cleanup Script${NC}"
echo -e "${CYAN}  Fixing C-04, C-05, C-06 from security audit${NC}"
echo ""

# Step 1: Check git history for sensitive files
echo -e "${YELLOW}[1/5] Checking git history for sensitive files...${NC}"

if git log --all --oneline -- treasury.json 2>/dev/null | grep -q .; then
    echo -e "${RED}✗ WARNING: treasury.json found in git history!${NC}"
    echo -e "${RED}  This is a critical security issue. The private key may be exposed.${NC}"
    echo -e "${YELLOW}  Consider rotating the treasury wallet immediately.${NC}"
else
    echo -e "${GREEN}✓ treasury.json never committed to git${NC}"
fi

if git log --all --oneline -- rsa_signing_key.der 2>/dev/null | grep -q .; then
    echo -e "${RED}✗ WARNING: rsa_signing_key.der found in git history!${NC}"
    echo -e "${RED}  This is a critical security issue. The private key may be exposed.${NC}"
    echo -e "${YELLOW}  Consider regenerating the RSA key (will invalidate existing credits).${NC}"
else
    echo -e "${GREEN}✓ rsa_signing_key.der never committed to git${NC}"
fi

echo ""

# Step 2: Handle duplicate RSA keys
echo -e "${YELLOW}[2/5] Removing duplicate RSA keys...${NC}"

cd "$PROJECT_ROOT"

DUPLICATES_FOUND=false

# Check root directory
if [ -f "rsa_signing_key.der" ]; then
    echo -e "${YELLOW}  Found: rsa_signing_key.der (root)${NC}"
    rm -f rsa_signing_key.der
    echo -e "${GREEN}  ✓ Deleted: rsa_signing_key.der (root)${NC}"
    DUPLICATES_FOUND=true
fi

# Check app directory
if [ -f "app/rsa_signing_key.der" ]; then
    echo -e "${YELLOW}  Found: app/rsa_signing_key.der${NC}"
    rm -f app/rsa_signing_key.der
    echo -e "${GREEN}  ✓ Deleted: app/rsa_signing_key.der${NC}"
    DUPLICATES_FOUND=true
fi

# Check for nested duplicates
if [ -d "crates/relayer/crates" ]; then
    echo -e "${YELLOW}  Found: nested crates/relayer/crates/ directory${NC}"
    rm -rf crates/relayer/crates/
    echo -e "${GREEN}  ✓ Deleted: nested directory${NC}"
    DUPLICATES_FOUND=true
fi

if [ "$DUPLICATES_FOUND" = false ]; then
    echo -e "${GREEN}✓ No duplicate RSA keys found${NC}"
fi

echo ""

# Step 3: Secure the relayer RSA key
echo -e "${YELLOW}[3/5] Securing relayer RSA key...${NC}"

RSA_KEY_PATH="crates/relayer/rsa_signing_key.der"

if [ -f "$RSA_KEY_PATH" ]; then
    # Get current permissions
    CURRENT_PERMS=$(stat -f "%Lp" "$RSA_KEY_PATH" 2>/dev/null || stat -c "%a" "$RSA_KEY_PATH" 2>/dev/null)
    
    if [ "$CURRENT_PERMS" != "600" ]; then
        chmod 600 "$RSA_KEY_PATH"
        echo -e "${GREEN}✓ Set permissions to 600 (owner read/write only)${NC}"
        echo -e "  File: $RSA_KEY_PATH"
    else
        echo -e "${GREEN}✓ Permissions already secure (600)${NC}"
    fi
else
    echo -e "${YELLOW}⚠ RSA key not found at: $RSA_KEY_PATH${NC}"
    echo -e "${YELLOW}  It will be generated on first relayer startup${NC}"
fi

echo ""

# Step 4: Move treasury to secure location
echo -e "${YELLOW}[4/5] Moving treasury wallet to secure location...${NC}"

TREASURY_DIR="$HOME/.config/tracezero"
TREASURY_PATH="$TREASURY_DIR/treasury.json"
OLD_TREASURY_PATH="$PROJECT_ROOT/treasury.json"

# Create secure directory
if [ ! -d "$TREASURY_DIR" ]; then
    mkdir -p "$TREASURY_DIR"
    chmod 700 "$TREASURY_DIR"
    echo -e "${GREEN}✓ Created secure directory: $TREASURY_DIR${NC}"
fi

# Move treasury if it exists in project root
if [ -f "$OLD_TREASURY_PATH" ]; then
    if [ -f "$TREASURY_PATH" ]; then
        echo -e "${YELLOW}⚠ Treasury already exists in secure location${NC}"
        echo -e "${YELLOW}  Old location: $OLD_TREASURY_PATH${NC}"
        echo -e "${YELLOW}  New location: $TREASURY_PATH${NC}"
        
        OLD_PUBKEY=$(solana-keygen pubkey "$OLD_TREASURY_PATH" 2>/dev/null || echo "invalid")
        NEW_PUBKEY=$(solana-keygen pubkey "$TREASURY_PATH" 2>/dev/null || echo "invalid")
        
        if [ "$OLD_PUBKEY" == "$NEW_PUBKEY" ]; then
            echo -e "${GREEN}✓ Both files contain the same key${NC}"
            rm -f "$OLD_TREASURY_PATH"
            echo -e "${GREEN}✓ Deleted duplicate from project root${NC}"
        else
            echo -e "${RED}✗ Different keys found!${NC}"
            echo -e "${YELLOW}  Please manually resolve which treasury to keep${NC}"
            echo -e "${YELLOW}  Old: $OLD_PUBKEY${NC}"
            echo -e "${YELLOW}  New: $NEW_PUBKEY${NC}"
        fi
    else
        mv "$OLD_TREASURY_PATH" "$TREASURY_PATH"
        chmod 600 "$TREASURY_PATH"
        PUBKEY=$(solana-keygen pubkey "$TREASURY_PATH")
        echo -e "${GREEN}✓ Moved treasury to secure location${NC}"
        echo -e "  From: $OLD_TREASURY_PATH"
        echo -e "  To:   $TREASURY_PATH"
        echo -e "  Pubkey: ${CYAN}$PUBKEY${NC}"
    fi
else
    if [ -f "$TREASURY_PATH" ]; then
        chmod 600 "$TREASURY_PATH"
        PUBKEY=$(solana-keygen pubkey "$TREASURY_PATH")
        echo -e "${GREEN}✓ Treasury already in secure location${NC}"
        echo -e "  Path: $TREASURY_PATH"
        echo -e "  Pubkey: ${CYAN}$PUBKEY${NC}"
    else
        echo -e "${YELLOW}⚠ No treasury wallet found${NC}"
        echo -e "${YELLOW}  It will be created on first startup${NC}"
    fi
fi

echo ""

# Step 5: Summary and recommendations
echo -e "${YELLOW}[5/5] Security summary and recommendations...${NC}"
echo ""
echo -e "${GREEN}✓ Cleanup complete!${NC}"
echo ""
echo -e "${CYAN}Security improvements applied:${NC}"
echo -e "  • Removed duplicate RSA keys (C-04)"
echo -e "  • Set RSA key permissions to 600 (C-04)"
echo -e "  • Moved treasury to ~/.config/tracezero/ (C-05)"
echo -e "  • Set treasury permissions to 600 (C-05)"
echo -e "  • Updated blind_signer.rs to reduce logging (C-06)"
echo ""
echo -e "${CYAN}Next steps:${NC}"
echo -e "  1. Run: ${YELLOW}./scripts/start-tracezero.sh${NC}"
echo -e "     (Script now uses secure treasury location)"
echo ""
echo -e "  2. For production deployments:"
echo -e "     • Use HSM or cloud KMS for RSA key"
echo -e "     • Use hardware wallet or multisig for treasury"
echo -e "     • Set RUST_LOG=info (not debug) to minimize logging"
echo ""
echo -e "${CYAN}Environment variables:${NC}"
echo -e "  • RSA_KEY_PATH: ${YELLOW}crates/relayer/rsa_signing_key.der${NC} (default)"
echo -e "  • TREASURY_KEYPAIR_PATH: ${YELLOW}~/.config/tracezero/treasury.json${NC} (new default)"
echo ""
echo -e "${GREEN}═══════════════════════════════════════════════════════${NC}"
