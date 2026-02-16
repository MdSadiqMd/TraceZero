#!/bin/bash
# Trusted Setup for Groth16 proofs
#
# This script performs the trusted setup ceremony:
# 1. Powers of Tau ceremony (phase 1) - can use existing ptau files
# 2. Circuit-specific setup (phase 2)
#
# For production, use a proper multi-party ceremony!
# This script is for development/testing only.
#
# Usage: ./scripts/setup.sh [circuit_name] [ptau_power]
#   circuit_name: withdrawal or ownership (default: withdrawal)
#   ptau_power: Power of 2 for constraints (default: 16 = 65536 constraints)

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CIRCUITS_DIR="$(dirname "$SCRIPT_DIR")"
BUILD_DIR="$CIRCUITS_DIR/build"
PTAU_DIR="$CIRCUITS_DIR/ptau"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

CIRCUIT_NAME="${1:-withdrawal}"
PTAU_POWER="${2:-16}"

echo -e "${GREEN}=== Trusted Setup for ${CIRCUIT_NAME} ===${NC}"
echo -e "Powers of Tau: 2^${PTAU_POWER} = $((2**PTAU_POWER)) constraints"

# Check snarkjs
if ! command -v npx &> /dev/null; then
    echo -e "${RED}Error: npx not found. Install Node.js${NC}"
    exit 1
fi

# Check R1CS exists
R1CS_FILE="$BUILD_DIR/${CIRCUIT_NAME}.r1cs"
if [ ! -f "$R1CS_FILE" ]; then
    echo -e "${RED}Error: R1CS not found. Run compile.sh first${NC}"
    exit 1
fi

mkdir -p "$PTAU_DIR"
mkdir -p "$BUILD_DIR/keys"

PTAU_FILE="$PTAU_DIR/pot${PTAU_POWER}_final.ptau"

# ============================================
# Phase 1: Powers of Tau (reusable)
# ============================================

if [ ! -f "$PTAU_FILE" ]; then
    echo -e "\n${YELLOW}=== Phase 1: Powers of Tau ===${NC}"
    echo -e "${YELLOW}WARNING: This is for development only!${NC}"
    echo -e "${YELLOW}For production, use Hermez or Semaphore's trusted setup.${NC}"

    # Start new ceremony
    echo -e "\n${GREEN}Starting new Powers of Tau ceremony...${NC}"
    npx snarkjs powersoftau new bn128 "$PTAU_POWER" "$PTAU_DIR/pot${PTAU_POWER}_0000.ptau" -v

    # Contribute (in production, multiple parties contribute)
    echo -e "\n${GREEN}Contributing to ceremony...${NC}"
    npx snarkjs powersoftau contribute \
        "$PTAU_DIR/pot${PTAU_POWER}_0000.ptau" \
        "$PTAU_DIR/pot${PTAU_POWER}_0001.ptau" \
        --name="Privacy-Proxy Dev Contribution" \
        -e="$(head -c 32 /dev/urandom | xxd -p)"

    # Prepare for phase 2
    echo -e "\n${GREEN}Preparing for phase 2...${NC}"
    npx snarkjs powersoftau prepare phase2 \
        "$PTAU_DIR/pot${PTAU_POWER}_0001.ptau" \
        "$PTAU_FILE" \
        -v

    # Cleanup intermediate files
    rm -f "$PTAU_DIR/pot${PTAU_POWER}_0000.ptau"
    rm -f "$PTAU_DIR/pot${PTAU_POWER}_0001.ptau"

    echo -e "${GREEN}✓ Powers of Tau complete: ${PTAU_FILE}${NC}"
else
    echo -e "${GREEN}Using existing Powers of Tau: ${PTAU_FILE}${NC}"
fi

# ============================================
# Phase 2: Circuit-specific setup
# ============================================

echo -e "\n${YELLOW}=== Phase 2: Circuit-Specific Setup ===${NC}"

ZKEY_0="$BUILD_DIR/keys/${CIRCUIT_NAME}_0000.zkey"
ZKEY_FINAL="$BUILD_DIR/keys/${CIRCUIT_NAME}_final.zkey"
VK_FILE="$BUILD_DIR/keys/${CIRCUIT_NAME}_verification_key.json"

# Generate initial zkey
echo -e "\n${GREEN}Generating initial zkey...${NC}"
npx snarkjs groth16 setup "$R1CS_FILE" "$PTAU_FILE" "$ZKEY_0"

# Contribute to phase 2 (in production, multiple parties)
echo -e "\n${GREEN}Contributing to phase 2...${NC}"
npx snarkjs zkey contribute \
    "$ZKEY_0" \
    "$ZKEY_FINAL" \
    --name="Privacy-Proxy Phase 2 Contribution" \
    -e="$(head -c 32 /dev/urandom | xxd -p)"

# Export verification key
echo -e "\n${GREEN}Exporting verification key...${NC}"
npx snarkjs zkey export verificationkey "$ZKEY_FINAL" "$VK_FILE"

# Verify the zkey
echo -e "\n${GREEN}Verifying zkey...${NC}"
npx snarkjs zkey verify "$R1CS_FILE" "$PTAU_FILE" "$ZKEY_FINAL"

# Cleanup
rm -f "$ZKEY_0"

echo -e "\n${GREEN}=== Setup Complete ===${NC}"
echo -e "Final zkey: ${ZKEY_FINAL}"
echo -e "Verification key: ${VK_FILE}"
echo -e "\n${YELLOW}IMPORTANT: For production, perform a proper multi-party ceremony!${NC}"
