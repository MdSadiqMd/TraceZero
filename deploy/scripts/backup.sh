#!/bin/bash
# ============================================================
# TraceZero — Automated State Backup
# ============================================================
# Backs up critical relayer state to S3 (encrypted with SSE).
# Run via cron every hour.
#
# What's backed up:
#   - merkle_state/ (deposit tree — loss = permanent fund loss)
#   - used_tokens.dat (redeemed tokens — loss = double-spend risk)
#   - Tor hidden service keys (loss = .onion address changes)
#
# What's NOT backed up here (manual/separate process):
#   - RSA signing key (backed up on initial setup)
#   - Wallet keypairs (backed up on initial setup)
#   - Relayer binary (stored in S3 /bin/ separately)
#
# Retention: 7 days of hourly backups (168 snapshots)
# ============================================================

set -euo pipefail

# --- Configuration ---
BUCKET="${TRACEZERO_BACKUP_BUCKET:-tracezero-backups-CHANGE-ME}"
STATE_DIR="/opt/tracezero/state"
TOR_DIR="/var/lib/tor/relayer_hidden_service"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
LOG_TAG="tracezero-backup"

log() {
  logger -t "$LOG_TAG" "$1"
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1"
}

error() {
  logger -t "$LOG_TAG" "ERROR: $1"
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] ERROR: $1" >&2
}

# --- Backup Merkle State ---
if [ -d "$STATE_DIR/merkle_state" ]; then
  MERKLE_FILE="/tmp/merkle_state_${TIMESTAMP}.tar.gz"
  tar czf "$MERKLE_FILE" -C "$STATE_DIR" merkle_state/ 2>/dev/null
  
  if aws s3 cp "$MERKLE_FILE" "s3://$BUCKET/state/merkle/" --sse --quiet 2>/dev/null; then
    log "Merkle state backed up: merkle_state_${TIMESTAMP}.tar.gz"
  else
    error "Failed to upload merkle state to S3"
  fi
  
  rm -f "$MERKLE_FILE"
else
  log "No merkle_state directory found — skipping"
fi

# --- Backup Token Store ---
if [ -f "$STATE_DIR/used_tokens.dat" ]; then
  if aws s3 cp "$STATE_DIR/used_tokens.dat" "s3://$BUCKET/state/tokens/used_tokens_${TIMESTAMP}.dat" --sse --quiet 2>/dev/null; then
    log "Token store backed up: used_tokens_${TIMESTAMP}.dat"
  else
    error "Failed to upload token store to S3"
  fi
  
  if [ -f "$STATE_DIR/used_tokens.checksum" ]; then
    aws s3 cp "$STATE_DIR/used_tokens.checksum" "s3://$BUCKET/state/tokens/used_tokens_${TIMESTAMP}.checksum" --sse --quiet 2>/dev/null || true
  fi
else
  log "No used_tokens.dat found — skipping"
fi

# --- Backup Tor Hidden Service Keys (daily only) ---
HOUR=$(date +%H)
if [ "$HOUR" = "03" ]; then
  # Only backup Tor keys once per day (at 3 AM)
  if [ -d "$TOR_DIR" ]; then
    TOR_FILE="/tmp/tor_keys_${TIMESTAMP}.tar.gz"
    tar czf "$TOR_FILE" -C /var/lib/tor relayer_hidden_service/ 2>/dev/null
    
    if aws s3 cp "$TOR_FILE" "s3://$BUCKET/tor-keys/tor_keys_${TIMESTAMP}.tar.gz" --sse --quiet 2>/dev/null; then
      log "Tor hidden service keys backed up"
    else
      error "Failed to backup Tor keys"
    fi
    
    rm -f "$TOR_FILE"
  fi
fi

# --- Retention: Keep Last 7 Days ---
# Merkle state: keep last 168 files (7 days * 24 hours)
aws s3 ls "s3://$BUCKET/state/merkle/" 2>/dev/null | sort | head -n -168 | awk '{print $4}' | \
  while IFS= read -r file; do
    [ -n "$file" ] && aws s3 rm "s3://$BUCKET/state/merkle/$file" --quiet 2>/dev/null || true
  done

# Token store: keep last 168 files
aws s3 ls "s3://$BUCKET/state/tokens/" 2>/dev/null | sort | head -n -336 | awk '{print $4}' | \
  while IFS= read -r file; do
    [ -n "$file" ] && aws s3 rm "s3://$BUCKET/state/tokens/$file" --quiet 2>/dev/null || true
  done

# Tor keys: keep last 30 daily backups
aws s3 ls "s3://$BUCKET/tor-keys/" 2>/dev/null | sort | head -n -30 | awk '{print $4}' | \
  while IFS= read -r file; do
    [ -n "$file" ] && aws s3 rm "s3://$BUCKET/tor-keys/$file" --quiet 2>/dev/null || true
  done

log "Backup cycle complete"
