#!/bin/bash
# Compile Circom circuits to R1CS and WASM
#
# Prerequisites:
#   - circom 2.2.x installed (cargo install circom)
#   - Node.js 18+ with yarn/npm
#
# Usage: ./scripts/compile.sh [circuit_name]
#   If no circuit specified, compiles all circuits

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CIRCUITS_DIR="$(dirname "$SCRIPT_DIR")"
BUILD_DIR="$CIRCUITS_DIR/build"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${GREEN}=== Privacy-Proxy Circuit Compiler ===${NC}"

# Check circom is installed
if ! command -v circom &> /dev/null; then
    echo -e "${RED}Error: circom not found${NC}"
    echo "Install with: cargo install circom"
    exit 1
fi

# Check circom version
CIRCOM_VERSION=$(circom --version | head -n1)
echo -e "Using: ${YELLOW}$CIRCOM_VERSION${NC}"

# Install npm dependencies if needed
if [ ! -d "$CIRCUITS_DIR/node_modules" ]; then
    echo -e "${YELLOW}Installing npm dependencies...${NC}"
    cd "$CIRCUITS_DIR"
    yarn install || npm install
fi

# Create build directory
mkdir -p "$BUILD_DIR"

# Function to compile a single circuit
compile_circuit() {
    local circuit_name=$1
    local circuit_file="$CIRCUITS_DIR/${circuit_name}.circom"

    if [ ! -f "$circuit_file" ]; then
        echo -e "${RED}Error: Circuit file not found: $circuit_file${NC}"
        return 1
    fi

    echo -e "\n${GREEN}Compiling: ${circuit_name}${NC}"

    # Compile with circom
    # --r1cs: Output R1CS constraint system
    # --wasm: Output WASM for witness generation
    # --sym: Output symbol file for debugging
    # --O2: Full optimization
    circom "$circuit_file" \
        --r1cs \
        --wasm \
        --sym \
        --O2 \
        -o "$BUILD_DIR" \
        -l "$CIRCUITS_DIR/node_modules"

    # Check outputs
    if [ -f "$BUILD_DIR/${circuit_name}.r1cs" ]; then
        echo -e "${GREEN}✓ R1CS: ${BUILD_DIR}/${circuit_name}.r1cs${NC}"
    fi

    if [ -d "$BUILD_DIR/${circuit_name}_js" ]; then
        echo -e "${GREEN}✓ WASM: ${BUILD_DIR}/${circuit_name}_js/${NC}"
    fi

    if [ -f "$BUILD_DIR/${circuit_name}.sym" ]; then
        echo -e "${GREEN}✓ Symbols: ${BUILD_DIR}/${circuit_name}.sym${NC}"
    fi

    # Print constraint count
    if command -v snarkjs &> /dev/null; then
        echo -e "${YELLOW}Constraint info:${NC}"
        npx snarkjs r1cs info "$BUILD_DIR/${circuit_name}.r1cs" 2>/dev/null || true
    fi
}

# Compile specified circuit or all circuits
if [ -n "$1" ]; then
    compile_circuit "$1"
else
    echo -e "${YELLOW}Compiling all circuits...${NC}"

    # Compile main circuits
    compile_circuit "withdrawal"
    compile_circuit "ownership"
fi

echo -e "\n${GREEN}=== Compilation Complete ===${NC}"
echo -e "Build artifacts in: ${BUILD_DIR}"
