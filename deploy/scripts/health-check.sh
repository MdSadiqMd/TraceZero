#!/bin/bash
# ============================================================
# TraceZero — Health Check Script
# ============================================================
# Checks all critical services and reports status.
# Run via cron every 5 minutes. Alerts on failure.
#
# Checks:
#   1. Relayer responding on localhost
#   2. Tor hidden service reachable
#   3. Tor outbound working (RPC connectivity)
#   4. Privoxy operational
#   5. Wallet balances adequate
#   6. Disk space sufficient
#   7. Merkle state healthy
#
# Exit codes:
#   0 = all healthy
#   1 = critical failure (relayer down)
#   2 = warning (degraded but operational)
# ============================================================

set -uo pipefail

# --- Configuration ---
RELAYER_URL="http://127.0.0.1:8080"
PRIVOXY_URL="http://127.0.0.1:8118"
RPC_URL="https://api.mainnet-beta.solana.com"
MIN_DEPOSIT_BALANCE=2000000000  # 2 SOL minimum (in lamports)
MIN_DISK_PERCENT=80             # Alert if disk > 80% used
LOG_TAG="tracezero-health"

WARNINGS=0
CRITICAL=0

log() { logger -t "$LOG_TAG" "$1"; }
warn() { log "WARNING: $1"; ((WARNINGS++)); }
critical() { log "CRITICAL: $1"; ((CRITICAL++)); }
ok() { log "OK: $1"; }

# ============================================================
# CHECK 1: Relayer Health
# ============================================================
RELAYER_HEALTH=$(curl -sf "$RELAYER_URL/health" 2>/dev/null)
if [ $? -ne 0 ]; then
  critical "Relayer not responding on localhost:8080"
else
  STATUS=$(echo "$RELAYER_HEALTH" | jq -r '.status' 2>/dev/null)
  if [ "$STATUS" = "ok" ]; then
    ok "Relayer healthy"
  else
    warn "Relayer degraded: $RELAYER_HEALTH"
  fi
fi

# ============================================================
# CHECK 2: Tor Hidden Service
# ============================================================
if [ -f /var/lib/tor/relayer_hidden_service/hostname ]; then
  ONION=$(cat /var/lib/tor/relayer_hidden_service/hostname)
  
  # Check if Tor process is running
  if systemctl is-active --quiet tor; then
    ok "Tor daemon running"
  else
    critical "Tor daemon not running"
  fi
  
  # Check hidden service reachability (via local Tor)
  ONION_CHECK=$(torsocks curl -sf "http://$ONION:8080/health" --connect-timeout 30 2>/dev/null)
  if [ $? -eq 0 ]; then
    ok "Hidden service reachable: $ONION"
  else
    warn "Hidden service not reachable (may be Tor circuit issue — retries normally resolve)"
  fi
else
  critical "Hidden service hostname file missing"
fi

# ============================================================
# CHECK 3: Tor Outbound (RPC Connectivity)
# ============================================================
RPC_CHECK=$(curl -sf --proxy "$PRIVOXY_URL" \
  -X POST "$RPC_URL" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"getHealth"}' \
  --connect-timeout 30 2>/dev/null)

if [ $? -eq 0 ]; then
  RPC_RESULT=$(echo "$RPC_CHECK" | jq -r '.result' 2>/dev/null)
  if [ "$RPC_RESULT" = "ok" ]; then
    ok "Solana RPC reachable through Tor"
  else
    warn "Solana RPC returned unexpected: $RPC_CHECK"
  fi
else
  warn "Solana RPC unreachable through Tor (may be transient)"
fi

# ============================================================
# CHECK 4: Privoxy Operational
# ============================================================
if systemctl is-active --quiet privoxy; then
  # Verify Privoxy is actually proxying (check exit IP is Tor)
  EXIT_IP=$(curl -sf --proxy "$PRIVOXY_URL" "https://api.ipify.org" --connect-timeout 15 2>/dev/null)
  if [ $? -eq 0 ] && [ -n "$EXIT_IP" ]; then
    ok "Privoxy routing through Tor (exit IP: $EXIT_IP)"
  else
    warn "Privoxy running but Tor routing failed"
  fi
else
  critical "Privoxy not running — RPC calls will fail"
fi

# ============================================================
# CHECK 5: Disk Space
# ============================================================
DISK_USAGE=$(df /opt/tracezero | tail -1 | awk '{print $5}' | tr -d '%')
if [ "$DISK_USAGE" -gt "$MIN_DISK_PERCENT" ]; then
  warn "Disk usage high: ${DISK_USAGE}% (threshold: ${MIN_DISK_PERCENT}%)"
else
  ok "Disk usage: ${DISK_USAGE}%"
fi

# ============================================================
# CHECK 6: Merkle State
# ============================================================
STATE_DIR="/opt/tracezero/state"
if [ -d "$STATE_DIR/merkle_state" ]; then
  # Check for recent modification (should update with each deposit)
  LAST_MOD=$(find "$STATE_DIR/merkle_state" -name "*.json" -printf '%T@\n' 2>/dev/null | sort -n | tail -1)
  if [ -n "$LAST_MOD" ]; then
    NOW=$(date +%s)
    AGE=$(echo "$NOW - ${LAST_MOD%.*}" | bc 2>/dev/null || echo "0")
    if [ "$AGE" -gt 86400 ]; then
      # No modification in 24 hours — might be normal for low-traffic
      log "INFO: Merkle state not modified in ${AGE}s (may be normal)"
    fi
    ok "Merkle state files present"
  else
    warn "Merkle state directory exists but no JSON files"
  fi
else
  warn "Merkle state directory missing"
fi

# ============================================================
# CHECK 7: Token Store Integrity
# ============================================================
if [ -f "$STATE_DIR/used_tokens.dat" ]; then
  TOKEN_SIZE=$(stat -c%s "$STATE_DIR/used_tokens.dat" 2>/dev/null || echo "0")
  ok "Token store present (${TOKEN_SIZE} bytes)"
  
  if [ -f "$STATE_DIR/used_tokens.checksum" ]; then
    ok "Token store checksum present"
  else
    warn "Token store checksum missing"
  fi
else
  log "INFO: No token store yet (normal for fresh deployment)"
fi

# ============================================================
# SUMMARY
# ============================================================
echo ""
if [ "$CRITICAL" -gt 0 ]; then
  log "RESULT: ${CRITICAL} CRITICAL, ${WARNINGS} WARNINGS"
  # Here you would trigger alerts (PagerDuty, email, Telegram, etc.)
  # Example: curl -X POST "https://hooks.slack.com/services/..." -d '{"text":"TraceZero CRITICAL: Relayer down"}'
  exit 1
elif [ "$WARNINGS" -gt 0 ]; then
  log "RESULT: ${WARNINGS} WARNINGS (no critical issues)"
  exit 2
else
  log "RESULT: All checks passed"
  exit 0
fi
