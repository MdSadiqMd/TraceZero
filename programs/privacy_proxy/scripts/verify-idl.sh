#!/bin/bash
# L-06 FIX: Verify IDL addresses match deployed program IDs
# This script checks that IDL files have correct addresses after build

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Expected program IDs
PRIVACY_PROXY_ID="Dzpj74oeEhpyXwaiLUFKgzVz1Dcj4ZobsoczYdHiMaB3"
ZK_VERIFIER_ID="2ntZ79MomBLsLyaExjGW6F7kkYtmprhdzZzQaMXSMZRu"

echo "Verifying IDL addresses..."

# Check privacy_proxy IDL
if [ -f "target/idl/privacy_proxy.json" ]; then
    ACTUAL_ID=$(python3 -c "import json; print(json.load(open('target/idl/privacy_proxy.json'))['address'])")
    
    if [ "$ACTUAL_ID" = "$PRIVACY_PROXY_ID" ]; then
        echo -e "${GREEN}✓ privacy_proxy IDL address correct: $ACTUAL_ID${NC}"
    else
        echo -e "${RED}✗ privacy_proxy IDL address incorrect!${NC}"
        echo -e "  Expected: $PRIVACY_PROXY_ID"
        echo -e "  Actual:   $ACTUAL_ID"
        exit 1
    fi
else
    echo -e "${YELLOW}⚠ privacy_proxy IDL not found${NC}"
fi

# Check zk_verifier IDL
if [ -f "target/idl/zk_verifier.json" ]; then
    ACTUAL_ID=$(python3 -c "import json; print(json.load(open('target/idl/zk_verifier.json'))['address'])")
    
    if [ "$ACTUAL_ID" = "$ZK_VERIFIER_ID" ]; then
        echo -e "${GREEN}✓ zk_verifier IDL address correct: $ACTUAL_ID${NC}"
    else
        echo -e "${RED}✗ zk_verifier IDL address incorrect!${NC}"
        echo -e "  Expected: $ZK_VERIFIER_ID"
        echo -e "  Actual:   $ACTUAL_ID"
        exit 1
    fi
else
    echo -e "${YELLOW}⚠ zk_verifier IDL not found${NC}"
fi

# Check TypeScript types if they exist
if [ -f "target/types/privacy_proxy.ts" ]; then
    if grep -q "$PRIVACY_PROXY_ID" target/types/privacy_proxy.ts; then
        echo -e "${GREEN}✓ TypeScript types address correct${NC}"
    else
        echo -e "${RED}✗ TypeScript types address incorrect!${NC}"
        exit 1
    fi
fi

echo -e "${GREEN}All IDL addresses verified successfully!${NC}"
