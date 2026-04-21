#!/bin/bash
# Test script to verify security fixes for C-04, C-05, C-06
# This script validates that all security improvements are working correctly

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

echo -e "${CYAN}═══════════════════════════════════════════════════════${NC}"
echo -e "${CYAN}  TRACE_ZERO Security Fixes Validation${NC}"
echo -e "${CYAN}  Testing C-04, C-05, C-06 remediation${NC}"
echo -e "${CYAN}═══════════════════════════════════════════════════════${NC}"
echo ""

TESTS_PASSED=0
TESTS_FAILED=0

# Test 1: Verify no duplicate RSA keys exist
echo -e "${YELLOW}[Test 1] Checking for duplicate RSA keys...${NC}"
DUPLICATES=0

if [ -f "$PROJECT_ROOT/rsa_signing_key.der" ]; then
    echo -e "${RED}✗ FAIL: rsa_signing_key.der found in project root${NC}"
    DUPLICATES=$((DUPLICATES + 1))
fi

if [ -f "$PROJECT_ROOT/app/rsa_signing_key.der" ]; then
    echo -e "${RED}✗ FAIL: rsa_signing_key.der found in app directory${NC}"
    DUPLICATES=$((DUPLICATES + 1))
fi

if [ -d "$PROJECT_ROOT/crates/relayer/crates" ]; then
    echo -e "${RED}✗ FAIL: nested crates/relayer/crates/ directory exists${NC}"
    DUPLICATES=$((DUPLICATES + 1))
fi

if [ $DUPLICATES -eq 0 ]; then
    echo -e "${GREEN}✓ PASS: No duplicate RSA keys found${NC}"
    TESTS_PASSED=$((TESTS_PASSED + 1))
else
    echo -e "${RED}✗ FAIL: Found $DUPLICATES duplicate RSA key(s) or nested directories${NC}"
    TESTS_FAILED=$((TESTS_FAILED + 1))
fi
echo ""

# Test 2: Verify RSA key has secure permissions (600)
echo -e "${YELLOW}[Test 2] Checking RSA key permissions...${NC}"
RSA_KEY_PATH="$PROJECT_ROOT/crates/relayer/rsa_signing_key.der"

if [ -f "$RSA_KEY_PATH" ]; then
    PERMS=$(stat -f "%Lp" "$RSA_KEY_PATH" 2>/dev/null || stat -c "%a" "$RSA_KEY_PATH" 2>/dev/null)
    
    if [ "$PERMS" == "600" ]; then
        echo -e "${GREEN}✓ PASS: RSA key has secure permissions (600)${NC}"
        TESTS_PASSED=$((TESTS_PASSED + 1))
    else
        echo -e "${RED}✗ FAIL: RSA key has insecure permissions ($PERMS, expected 600)${NC}"
        TESTS_FAILED=$((TESTS_FAILED + 1))
    fi
else
    echo -e "${YELLOW}⚠ SKIP: RSA key not found (will be generated on startup)${NC}"
fi
echo ""

# Test 3: Verify treasury is NOT in project root
echo -e "${YELLOW}[Test 3] Checking treasury location...${NC}"
if [ -f "$PROJECT_ROOT/treasury.json" ]; then
    echo -e "${RED}✗ FAIL: treasury.json still in project root${NC}"
    TESTS_FAILED=$((TESTS_FAILED + 1))
else
    echo -e "${GREEN}✓ PASS: treasury.json not in project root${NC}"
    TESTS_PASSED=$((TESTS_PASSED + 1))
fi
echo ""

# Test 4: Verify treasury is in secure location with proper permissions
echo -e "${YELLOW}[Test 4] Checking treasury in secure location...${NC}"
TREASURY_PATH="$HOME/.config/tracezero/treasury.json"

if [ -f "$TREASURY_PATH" ]; then
    PERMS=$(stat -f "%Lp" "$TREASURY_PATH" 2>/dev/null || stat -c "%a" "$TREASURY_PATH" 2>/dev/null)
    
    if [ "$PERMS" == "600" ]; then
        echo -e "${GREEN}✓ PASS: Treasury has secure permissions (600)${NC}"
        TESTS_PASSED=$((TESTS_PASSED + 1))
    else
        echo -e "${RED}✗ FAIL: Treasury has insecure permissions ($PERMS, expected 600)${NC}"
        TESTS_FAILED=$((TESTS_FAILED + 1))
    fi
else
    echo -e "${YELLOW}⚠ SKIP: Treasury not found (will be created on startup)${NC}"
fi
echo ""

# Test 5: Verify secure directory permissions
echo -e "${YELLOW}[Test 5] Checking secure directory permissions...${NC}"
TREASURY_DIR="$HOME/.config/tracezero"

if [ -d "$TREASURY_DIR" ]; then
    DIR_PERMS=$(stat -f "%Lp" "$TREASURY_DIR" 2>/dev/null || stat -c "%a" "$TREASURY_DIR" 2>/dev/null)
    
    if [ "$DIR_PERMS" == "700" ]; then
        echo -e "${GREEN}✓ PASS: Secure directory has proper permissions (700)${NC}"
        TESTS_PASSED=$((TESTS_PASSED + 1))
    else
        echo -e "${RED}✗ FAIL: Secure directory has insecure permissions ($DIR_PERMS, expected 700)${NC}"
        TESTS_FAILED=$((TESTS_FAILED + 1))
    fi
else
    echo -e "${YELLOW}⚠ SKIP: Secure directory not found${NC}"
fi
echo ""

# Test 6: Verify blind_signer.rs uses correct default path
echo -e "${YELLOW}[Test 6] Checking blind_signer.rs default path...${NC}"
if grep -q 'DEFAULT_RSA_KEY_PATH: &str = "crates/relayer/rsa_signing_key.der"' "$PROJECT_ROOT/crates/relayer/src/blind_signer.rs"; then
    echo -e "${GREEN}✓ PASS: blind_signer.rs uses correct default path${NC}"
    TESTS_PASSED=$((TESTS_PASSED + 1))
else
    echo -e "${RED}✗ FAIL: blind_signer.rs has incorrect default path${NC}"
    TESTS_FAILED=$((TESTS_FAILED + 1))
fi
echo ""

# Test 7: Verify blind_signer.rs has secure permission setting code
echo -e "${YELLOW}[Test 7] Checking blind_signer.rs permission setting...${NC}"
if grep -q "std::fs::Permissions::from_mode(0o600)" "$PROJECT_ROOT/crates/relayer/src/blind_signer.rs"; then
    echo -e "${GREEN}✓ PASS: blind_signer.rs sets secure permissions on key creation${NC}"
    TESTS_PASSED=$((TESTS_PASSED + 1))
else
    echo -e "${RED}✗ FAIL: blind_signer.rs missing permission setting code${NC}"
    TESTS_FAILED=$((TESTS_FAILED + 1))
fi
echo ""

# Test 8: Verify blind_signer.rs uses debug logging for paths
echo -e "${YELLOW}[Test 8] Checking blind_signer.rs logging level...${NC}"
if grep -q 'debug!("RSA key' "$PROJECT_ROOT/crates/relayer/src/blind_signer.rs"; then
    echo -e "${GREEN}✓ PASS: blind_signer.rs uses debug level for path logging${NC}"
    TESTS_PASSED=$((TESTS_PASSED + 1))
else
    echo -e "${RED}✗ FAIL: blind_signer.rs may be logging paths at info level${NC}"
    TESTS_FAILED=$((TESTS_FAILED + 1))
fi
echo ""

# Test 9: Verify start script uses secure treasury location
echo -e "${YELLOW}[Test 9] Checking start script treasury configuration...${NC}"
if grep -q 'TREASURY_DIR="\$HOME/.config/tracezero"' "$PROJECT_ROOT/scripts/start-tracezero.sh"; then
    echo -e "${GREEN}✓ PASS: start script uses secure treasury location${NC}"
    TESTS_PASSED=$((TESTS_PASSED + 1))
else
    echo -e "${RED}✗ FAIL: start script not updated for secure treasury location${NC}"
    TESTS_FAILED=$((TESTS_FAILED + 1))
fi
echo ""

# Test 10: Verify files are in .gitignore
echo -e "${YELLOW}[Test 10] Checking .gitignore entries...${NC}"
GITIGNORE_OK=true

if ! grep -q "rsa_signing_key.der" "$PROJECT_ROOT/.gitignore"; then
    echo -e "${RED}✗ FAIL: rsa_signing_key.der not in .gitignore${NC}"
    GITIGNORE_OK=false
fi

if ! grep -q "treasury.json" "$PROJECT_ROOT/.gitignore"; then
    echo -e "${RED}✗ FAIL: treasury.json not in .gitignore${NC}"
    GITIGNORE_OK=false
fi

if [ "$GITIGNORE_OK" = true ]; then
    echo -e "${GREEN}✓ PASS: Sensitive files are in .gitignore${NC}"
    TESTS_PASSED=$((TESTS_PASSED + 1))
else
    TESTS_FAILED=$((TESTS_FAILED + 1))
fi
echo ""

# Summary
echo -e "${CYAN}  Test Results${NC}"
echo ""
echo -e "Tests Passed: ${GREEN}$TESTS_PASSED${NC}"
echo -e "Tests Failed: ${RED}$TESTS_FAILED${NC}"
echo ""

if [ $TESTS_FAILED -eq 0 ]; then
    echo -e "${GREEN}✓ All security fixes validated successfully!${NC}"
    echo ""
    echo -e "${CYAN}Security improvements confirmed:${NC}"
    echo -e "  • C-04: RSA key duplication eliminated"
    echo -e "  • C-04: RSA key permissions secured (600)"
    echo -e "  • C-04: Auto-permission setting on key generation"
    echo -e "  • C-05: Treasury moved to secure location"
    echo -e "  • C-05: Treasury permissions secured (600)"
    echo -e "  • C-06: RSA key path logging reduced to debug level"
    echo ""
    exit 0
else
    echo -e "${RED}✗ Some tests failed. Please review the output above.${NC}"
    echo ""
    exit 1
fi
