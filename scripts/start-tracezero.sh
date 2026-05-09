#!/bin/bash
# Usage:
#   ./scripts/start-tracezero.sh          Start backend
#   ./scripts/start-tracezero.sh --stop   Stop everything
#   ./scripts/start-tracezero.sh --logs   Tail relayer logs
#   ./scripts/start-tracezero.sh --status Show status
#
# What this does:
#   1. Starts Docker stack (tor, privoxy, relayer, gateway)
#   2. Waits for relayer to be healthy
#   3. Prints local endpoints
#
# The frontend automatically uses localhost:8080 when accessed
# from localhost. No tunnel or manual URL configuration needed.
#
# Prerequisites:
#   - Docker running
#   - Keys in ./keys/ directory
#   - .env.production configured

set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$PROJECT_ROOT"

case "${1:-}" in
  --stop)
    echo -e "${BLUE}=== Stopping TraceZero ===${NC}"
    docker compose -f docker-compose.prod.yml down 2>/dev/null || true
    echo -e "${GREEN}✓ Stopped${NC}"
    exit 0
    ;;
    
  --logs)
    docker logs -f tracezero-relayer 2>&1
    exit 0
    ;;
    
  --status)
    echo -e "${BLUE}=== TraceZero Status ===${NC}"
    echo ""
    docker compose -f docker-compose.prod.yml ps 2>/dev/null || echo "  (not running)"
    echo ""
    
    if curl -sf http://127.0.0.1:8080/health > /dev/null 2>&1; then
      echo -e "${GREEN}✓ Relayer healthy${NC}"
      echo -e "  http://127.0.0.1:8080"
    else
      echo -e "${RED}✗ Relayer not responding${NC}"
    fi
    
    if curl -sf http://127.0.0.1:3080/health > /dev/null 2>&1; then
      echo -e "${GREEN}✓ Tor Gateway healthy${NC}"
      echo -e "  http://127.0.0.1:3080"
    else
      echo -e "${YELLOW}⚠ Tor Gateway not responding${NC}"
    fi
    exit 0
    ;;
    
  --help|-h)
    echo "Usage: $0 [--stop|--logs|--status|--help]"
    echo "  (no args)  Start backend"
    echo "  --stop     Stop all services"
    echo "  --logs     Tail relayer container logs"
    echo "  --status   Show running status"
    exit 0
    ;;
    
  "")
    : # Continue to main start logic
    ;;
    
  *)
    echo -e "${RED}Unknown option: $1${NC}"
    echo "Run with --help for usage"
    exit 1
    ;;
esac

echo -e "${BLUE}  TraceZero Backend${NC}"
echo ""

echo -e "${BLUE}[1/3] Checking prerequisites...${NC}"

if ! docker info > /dev/null 2>&1; then
  echo -e "${RED}✗ Docker is not running. Start Docker Desktop.${NC}"
  exit 1
fi

# Check keys exist
if [ ! -f "./keys/deposit-wallet.json" ] || [ ! -f "./keys/treasury-wallet.json" ]; then
  echo -e "${RED}✗ Missing wallet keys in ./keys/${NC}"
  echo -e "${YELLOW}  Run:${NC}"
  echo -e "    solana-keygen new -o ./keys/deposit-wallet.json --no-bip39-passphrase"
  echo -e "    solana-keygen new -o ./keys/treasury-wallet.json --no-bip39-passphrase"
  exit 1
fi

# Check .env.production
if [ ! -f ".env.production" ]; then
  echo -e "${RED}✗ Missing .env.production${NC}"
  echo -e "${YELLOW}  Run: cp .env.production.example .env.production${NC}"
  exit 1
fi

echo -e "${GREEN}✓ Prerequisites OK${NC}"

echo ""
echo -e "${BLUE}[2/3] Starting Docker stack...${NC}"

# Stop dev stack if running
docker compose -f crates/network/docker-compose.yml down 2>/dev/null || true
# Stop prod stack for clean start
docker compose -f docker-compose.prod.yml down 2>/dev/null || true

# Start prod stack
docker compose -f docker-compose.prod.yml up -d --build 2>&1 | grep -E "(Created|Started|Built|Error|error)" || true

echo ""
echo -e "${BLUE}[3/3] Waiting for relayer...${NC}"

WAITED=0
MAX_WAIT=90
while [ $WAITED -lt $MAX_WAIT ]; do
  if curl -sf http://127.0.0.1:8080/health > /dev/null 2>&1; then
    echo -e "${GREEN}✓ Relayer is healthy${NC}"
    break
  fi
  sleep 3
  WAITED=$((WAITED + 3))
done

if [ $WAITED -ge $MAX_WAIT ]; then
  echo -e "${RED}✗ Relayer failed to start${NC}"
  echo -e "${YELLOW}Check logs: docker logs tracezero-relayer${NC}"
  exit 1
fi

echo ""
echo -e "${GREEN}  TraceZero Backend is running${NC}"
echo ""
echo -e "  ${CYAN}Endpoints:${NC}"
echo -e "    Relayer:     http://127.0.0.1:8080"
echo -e "    Tor Gateway: http://127.0.0.1:3080"
echo ""
echo -e "  ${CYAN}Frontend:${NC}"
echo -e "    The frontend automatically uses localhost:8080 when"
echo -e "    accessed from localhost. Just open your frontend URL."
echo ""
echo -e "  ${CYAN}Commands:${NC}"
echo -e "    $0 --logs     Follow relayer logs"
echo -e "    $0 --status   Show status"
echo -e "    $0 --stop     Stop everything"
echo ""
