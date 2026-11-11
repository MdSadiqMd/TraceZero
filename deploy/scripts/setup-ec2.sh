#!/bin/bash
# ============================================================
# TraceZero EC2 Setup Script (Docker + Caddy HTTPS + Hardening)
# ============================================================
# Prerequisites:
#   - Ubuntu 24.04 t3.small (2 vCPU, 2 GB RAM, 40 GB gp3)
#   - .env.production already created at /opt/tracezero/.env.production
#
# Usage:
#   1. Launch EC2 (t3.small, Ubuntu 24.04, 40GB gp3)
#   2. EC2 → Instances → select your instance
#     - Security tab → click the Security Group link
#     - Edit inbound rules → Add:
#       - HTTP (port 80) from `0.0.0.0/0` - IPV4 and IPV6
#       - HTTPS (port 443) from `0.0.0.0/0` - IPV4 and IPV6
#       - TCP (port 8080) from `0.0.0.0/0` - IPV4 and IPV6
#       - TCP (port 3080) from `0.0.0.0/0` - IPV4 and IPV6
#   3. SSH in: ssh ubuntu@<ec2-ip>
#   4. Clone:  sudo git clone https://github.com/MdSadiqMd/TraceZero.git /opt/tracezero
#   5. Create your .env.production:
#        sudo nano /opt/tracezero/.env.production
#   6. Run:   sudo /opt/tracezero/deploy/scripts/setup-ec2.sh
#
# After running, the script prints:
#   VITE_RELAYER_URL=https://<public-ip>.nip.io
# ============================================================

set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

REPO_URL="https://github.com/MdSadiqMd/TraceZero.git"
INSTALL_DIR="/opt/tracezero"

echo -e "${GREEN}============================================================${NC}"
echo -e "${GREEN}  TraceZero EC2 Setup (Docker + Caddy HTTPS + Hardening)${NC}"
echo -e "${GREEN}============================================================${NC}"
echo ""

if [ "$EUID" -ne 0 ]; then
  echo -e "${RED}ERROR: Run this script as root (sudo)${NC}"
  exit 1
fi

# ============================================================
# STEP 0: Swap (t3.small has only 2GB RAM — Rust compilation needs more)
# ============================================================
if [ ! -f /swapfile ]; then
  echo -e "${YELLOW}[0/10] Creating 4GB swap file...${NC}"
  fallocate -l 4G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
  grep -q '/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
  echo -e "${GREEN}  4GB swap enabled${NC}"
else
  swapon /swapfile 2>/dev/null || true
  echo -e "${GREEN}  Swap already configured${NC}"
fi

# ============================================================
# STEP 1: System Updates & Docker Installation
# ============================================================
echo -e "${YELLOW}[1/10] Installing Docker and dependencies...${NC}"

apt-get update -qq
apt-get upgrade -y -qq
apt-get install -y -qq \
  ca-certificates curl git jq \
  ufw fail2ban unattended-upgrades \
  net-tools pkg-config libssl-dev

# Install Docker (official method)
if ! command -v docker &>/dev/null; then
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
  chmod a+r /etc/apt/keyrings/docker.asc

  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" > /etc/apt/sources.list.d/docker.list

  apt-get update -qq
  apt-get install -y -qq docker-ce docker-ce-cli containerd.io docker-compose-plugin
  systemctl enable docker
  systemctl start docker
  echo -e "${GREEN}  Docker installed${NC}"
else
  echo -e "${GREEN}  Docker already installed${NC}"
fi

usermod -aG docker ubuntu 2>/dev/null || true
echo -e "${GREEN}  Done${NC}"

# ============================================================
# STEP 2: Network Security Hardening
# ============================================================
echo -e "${YELLOW}[2/10] Hardening network security...${NC}"

# --- UFW Firewall ---
ufw --force reset >/dev/null 2>&1
ufw default deny incoming
ufw default allow outgoing
ufw limit 22/tcp comment "SSH rate-limited"
ufw allow 80/tcp comment "HTTP (Caddy ACME)"
ufw allow 443/tcp comment "HTTPS (Caddy)"
ufw allow 8080/tcp comment "TraceZero Relayer"
ufw allow 3080/tcp comment "TraceZero Tor Gateway"
ufw --force enable
echo -e "${GREEN}  UFW: deny all except SSH(22), HTTP(80), HTTPS(443), 8080, 3080${NC}"

# --- Fail2Ban ---
cat > /etc/fail2ban/jail.local << 'F2B'
[DEFAULT]
bantime = 3600
findtime = 600
maxretry = 3
backend = systemd

[sshd]
enabled = true
port = ssh
filter = sshd
logpath = /var/log/auth.log
maxretry = 3
bantime = 3600
F2B

systemctl enable fail2ban
systemctl restart fail2ban
echo -e "${GREEN}  Fail2Ban: 3 failed SSH attempts = 1 hour ban${NC}"

# --- Kernel hardening ---
cat > /etc/sysctl.d/99-tracezero-hardening.conf << 'SYSCTL'
net.ipv4.ip_forward = 0
net.ipv6.conf.all.forwarding = 0
net.ipv4.conf.all.accept_source_route = 0
net.ipv4.conf.default.accept_source_route = 0
net.ipv6.conf.all.accept_source_route = 0
net.ipv4.tcp_syncookies = 1
net.ipv4.tcp_max_syn_backlog = 2048
net.ipv4.tcp_synack_retries = 2
net.ipv4.tcp_syn_retries = 5
net.ipv4.conf.all.accept_redirects = 0
net.ipv4.conf.default.accept_redirects = 0
net.ipv4.conf.all.send_redirects = 0
net.ipv4.conf.default.send_redirects = 0
net.ipv6.conf.all.accept_redirects = 0
net.ipv4.conf.all.log_martians = 1
net.ipv4.conf.default.log_martians = 1
net.ipv4.icmp_echo_ignore_broadcasts = 1
net.ipv4.icmp_ignore_bogus_error_responses = 1
net.ipv4.conf.all.rp_filter = 1
net.ipv4.conf.default.rp_filter = 1
fs.suid_dumpable = 0
kernel.kptr_restrict = 2
kernel.dmesg_restrict = 1
kernel.yama.ptrace_scope = 2
net.ipv4.tcp_timestamps = 0
net.ipv4.tcp_rfc1337 = 1
SYSCTL

sysctl -p /etc/sysctl.d/99-tracezero-hardening.conf >/dev/null 2>&1
echo -e "${GREEN}  Kernel hardened${NC}"

# --- Core dumps ---
grep -q "hard core 0" /etc/security/limits.conf || echo "* hard core 0" >> /etc/security/limits.conf
grep -q "soft core 0" /etc/security/limits.conf || echo "* soft core 0" >> /etc/security/limits.conf

# --- SSH Hardening ---
sed -i 's/#\?PermitRootLogin.*/PermitRootLogin no/' /etc/ssh/sshd_config
sed -i 's/#\?PasswordAuthentication.*/PasswordAuthentication no/' /etc/ssh/sshd_config
sed -i 's/#\?PermitEmptyPasswords.*/PermitEmptyPasswords no/' /etc/ssh/sshd_config
sed -i 's/#\?X11Forwarding.*/X11Forwarding no/' /etc/ssh/sshd_config
sed -i 's/#\?MaxAuthTries.*/MaxAuthTries 3/' /etc/ssh/sshd_config
sed -i 's/#\?ClientAliveInterval.*/ClientAliveInterval 300/' /etc/ssh/sshd_config
sed -i 's/#\?ClientAliveCountMax.*/ClientAliveCountMax 2/' /etc/ssh/sshd_config

if ! grep -q "^AllowUsers" /etc/ssh/sshd_config; then
  echo "AllowUsers ubuntu" >> /etc/ssh/sshd_config
fi

systemctl restart sshd
echo -e "${GREEN}  SSH hardened${NC}"

# --- Auto security updates ---
cat > /etc/apt/apt.conf.d/50unattended-upgrades << 'UNATTENDED'
Unattended-Upgrade::Allowed-Origins {
    "${distro_id}:${distro_codename}-security";
};
Unattended-Upgrade::AutoFixInterruptedDpkg "true";
Unattended-Upgrade::Remove-Unused-Dependencies "true";
Unattended-Upgrade::Automatic-Reboot "false";
UNATTENDED

systemctl enable unattended-upgrades
echo -e "${GREEN}  Automatic security updates enabled${NC}"

# --- Docker daemon hardening ---
mkdir -p /etc/docker
cat > /etc/docker/daemon.json << 'DOCKERD'
{
  "icc": false,
  "no-new-privileges": true,
  "log-driver": "json-file",
  "log-opts": {
    "max-size": "50m",
    "max-file": "3"
  },
  "live-restore": true,
  "userland-proxy": false
}
DOCKERD

systemctl restart docker
echo -e "${GREEN}  Docker daemon hardened${NC}"
echo -e "${GREEN}  Network security hardening complete${NC}"

# ============================================================
# STEP 3: Setup Repository
# ============================================================
echo -e "${YELLOW}[3/10] Setting up repository...${NC}"

if [ -d "$INSTALL_DIR/.git" ]; then
  echo -e "${YELLOW}  $INSTALL_DIR exists, pulling latest...${NC}"
  cd "$INSTALL_DIR"
  git pull --ff-only 2>/dev/null || true
else
  if [ -d "$INSTALL_DIR" ] && [ ! -d "$INSTALL_DIR/.git" ]; then
    cd "$INSTALL_DIR"
  else
    git clone "$REPO_URL" "$INSTALL_DIR"
    cd "$INSTALL_DIR"
  fi
fi

chown -R ubuntu:ubuntu "$INSTALL_DIR"
echo -e "${GREEN}  Repository ready at $INSTALL_DIR${NC}"

# ============================================================
# STEP 4: Verify .env.production
# ============================================================
echo -e "${YELLOW}[4/10] Checking .env.production...${NC}"

if [ ! -f "$INSTALL_DIR/.env.production" ]; then
  echo -e "${RED}============================================================${NC}"
  echo -e "${RED}  ERROR: .env.production not found!${NC}"
  echo -e "${RED}============================================================${NC}"
  echo ""
  echo -e "  Create it before running this script:"
  echo -e "    ${YELLOW}sudo nano $INSTALL_DIR/.env.production${NC}"
  echo ""
  echo -e "  Required fields:"
  echo -e "    RPC_URL=https://api.devnet.solana.com"
  echo -e "    KEYPAIR_PATH=/app/keys/deposit-wallet.json"
  echo -e "    TREASURY_KEYPAIR_PATH=/app/keys/treasury-wallet.json"
  echo -e "    PROGRAM_ID=Dzpj74oeEhpyXwaiLUFKgzVz1Dcj4ZobsoczYdHiMaB3"
  echo -e "    ZK_VERIFIER_ID=2ntZ79MomBLsLyaExjGW6F7kkYtmprhdzZzQaMXSMZRu"
  echo -e "    HOST=0.0.0.0"
  echo -e "    PORT=8080"
  echo -e "    FEE_BPS=50"
  echo -e "    RSA_KEY_BITS=2048"
  echo -e "    ALLOW_UNSAFE_EMPTY_TREE=true"
  echo -e "    ACCEPT_MERKLE_DATA_LOSS=true"
  echo ""
  echo -e "  Then re-run: ${YELLOW}sudo $0${NC}"
  exit 1
fi

chmod 600 "$INSTALL_DIR/.env.production"
echo -e "${GREEN}  .env.production found${NC}"

# ============================================================
# STEP 5: Generate Wallet Keys
# ============================================================
echo -e "${YELLOW}[5/10] Generating wallet keys...${NC}"

mkdir -p "$INSTALL_DIR/keys"

# Install solana-keygen if not present
if ! command -v solana-keygen &>/dev/null; then
  echo -e "${YELLOW}  Installing Solana CLI tools...${NC}"
  su - ubuntu -c 'sh -c "$(curl -sSfL https://release.anza.xyz/stable/install)"' 2>/dev/null || true
  export PATH="/home/ubuntu/.local/share/solana/install/active_release/bin:$PATH"
fi

if [ ! -f "$INSTALL_DIR/keys/deposit-wallet.json" ]; then
  solana-keygen new -o "$INSTALL_DIR/keys/deposit-wallet.json" --no-bip39-passphrase --force
  echo -e "${GREEN}  Generated deposit wallet${NC}"
else
  echo -e "${GREEN}  Deposit wallet already exists${NC}"
fi

if [ ! -f "$INSTALL_DIR/keys/treasury-wallet.json" ]; then
  solana-keygen new -o "$INSTALL_DIR/keys/treasury-wallet.json" --no-bip39-passphrase --force
  echo -e "${GREEN}  Generated treasury wallet${NC}"
else
  echo -e "${GREEN}  Treasury wallet already exists${NC}"
fi

# Container runs as UID 10001 (relayer user) — keys must be readable by that UID
chown 10001:10001 "$INSTALL_DIR/keys/"*.json
chmod 600 "$INSTALL_DIR/keys/"*.json

DEPOSIT_PUBKEY=$(solana-keygen pubkey "$INSTALL_DIR/keys/deposit-wallet.json")
TREASURY_PUBKEY=$(solana-keygen pubkey "$INSTALL_DIR/keys/treasury-wallet.json")

echo -e "${CYAN}  Deposit wallet:  $DEPOSIT_PUBKEY${NC}"
echo -e "${CYAN}  Treasury wallet: $TREASURY_PUBKEY${NC}"

if [ "$DEPOSIT_PUBKEY" = "$TREASURY_PUBKEY" ]; then
  echo -e "${RED}  CRITICAL: Wallets are the same! Regenerating treasury...${NC}"
  rm -f "$INSTALL_DIR/keys/treasury-wallet.json"
  solana-keygen new -o "$INSTALL_DIR/keys/treasury-wallet.json" --no-bip39-passphrase --force
  chown 10001:10001 "$INSTALL_DIR/keys/treasury-wallet.json"
  chmod 600 "$INSTALL_DIR/keys/treasury-wallet.json"
  TREASURY_PUBKEY=$(solana-keygen pubkey "$INSTALL_DIR/keys/treasury-wallet.json")
  echo -e "${GREEN}  New treasury wallet: $TREASURY_PUBKEY${NC}"
fi

echo -e "${GREEN}  Keys ready${NC}"

# ============================================================
# STEP 6: Build and Start Docker Stack
# ============================================================
echo -e "${YELLOW}[6/10] Building and starting Docker stack...${NC}"
echo -e "${YELLOW}  This may take 5-10 minutes on first run (Rust compilation)...${NC}"

cd "$INSTALL_DIR"
rm -f "$INSTALL_DIR/docker-compose.override.yml"

sudo docker compose -f docker-compose.prod.yml up -d --build --remove-orphans 2>&1 | tail -20

echo -e "${GREEN}  Docker stack started${NC}"

# ============================================================
# STEP 7: Install Caddy (HTTPS reverse proxy)
# ============================================================
echo -e "${YELLOW}[7/10] Installing Caddy for HTTPS...${NC}"

if ! command -v caddy &>/dev/null; then
  apt-get install -y -qq debian-keyring debian-archive-keyring apt-transport-https
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | tee /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -qq
  apt-get install -y -qq caddy
  echo -e "${GREEN}  Caddy installed${NC}"
else
  echo -e "${GREEN}  Caddy already installed${NC}"
fi

# Get public IP for nip.io domain (auto-TLS without buying a domain)
CADDY_IP=$(curl -s --connect-timeout 3 https://api.ipify.org 2>/dev/null || echo "")
if [ -z "$CADDY_IP" ]; then
  IMDS_TOKEN=$(curl -s --connect-timeout 2 -X PUT "http://169.254.169.254/latest/api/token" -H "X-aws-ec2-metadata-token-ttl-seconds: 60" 2>/dev/null || echo "")
  if [ -n "$IMDS_TOKEN" ]; then
    CADDY_IP=$(curl -s --connect-timeout 3 -H "X-aws-ec2-metadata-token: $IMDS_TOKEN" http://169.254.169.254/latest/meta-data/public-ipv4 2>/dev/null || echo "")
  fi
fi

if [ -n "$CADDY_IP" ]; then
  NIP_DOMAIN="${CADDY_IP}.nip.io"

  # Caddy config: HTTPS termination, NO CORS headers (backend handles CORS)
  # /tor-gateway/* routes to the Tor gateway on port 3080
  # Everything else routes to the relayer on port 8080
  cat > /etc/caddy/Caddyfile << EOF
${NIP_DOMAIN} {
    handle_path /tor-gateway/* {
        reverse_proxy 127.0.0.1:3080
    }

    handle {
        reverse_proxy 127.0.0.1:8080
    }
}
EOF

  systemctl enable caddy
  systemctl restart caddy

  echo -e "${GREEN}  Caddy configured: https://${NIP_DOMAIN}${NC}"
else
  NIP_DOMAIN=""
  echo -e "${YELLOW}  Could not determine public IP — skipping Caddy setup${NC}"
  echo -e "${YELLOW}  Run manually after: caddy reverse-proxy --from <ip>.nip.io --to 127.0.0.1:8080${NC}"
fi

# ============================================================
# STEP 8: Wait for Services to be Healthy
# ============================================================
echo -e "${YELLOW}[8/10] Waiting for services to become healthy...${NC}"

MAX_WAIT=300
ELAPSED=0
HEALTH="unhealthy"
while [ $ELAPSED -lt $MAX_WAIT ]; do
  HEALTH=$(curl -s http://127.0.0.1:8080/health 2>/dev/null | jq -r '.status' 2>/dev/null || echo "unhealthy")
  if [ "$HEALTH" = "ok" ]; then
    echo -e "${GREEN}  Relayer is healthy!${NC}"
    break
  fi
  sleep 10
  ELAPSED=$((ELAPSED + 10))
  echo -e "  Waiting... (${ELAPSED}s / ${MAX_WAIT}s)"
done

if [ "$HEALTH" != "ok" ]; then
  echo -e "${RED}  WARNING: Relayer did not become healthy within ${MAX_WAIT}s${NC}"
  echo -e "${YELLOW}  Check logs: cd $INSTALL_DIR && sudo docker compose -f docker-compose.prod.yml logs relayer${NC}"
fi

GW_HEALTH=$(curl -s http://127.0.0.1:3080/health 2>/dev/null | jq -r '.status' 2>/dev/null || echo "unhealthy")
if [ "$GW_HEALTH" = "ok" ]; then
  echo -e "${GREEN}  Tor Gateway is healthy!${NC}"
else
  echo -e "${YELLOW}  Tor Gateway not yet ready (may take 60s for Tor circuits)${NC}"
fi

# ============================================================
# STEP 9: Auto-restart on Reboot
# ============================================================
echo -e "${YELLOW}[9/10] Configuring auto-restart on boot...${NC}"

cat > /etc/systemd/system/tracezero-docker.service << 'SYSTEMD'
[Unit]
Description=TraceZero Docker Stack
After=docker.service
Requires=docker.service

[Service]
Type=oneshot
RemainAfterExit=yes
WorkingDirectory=/opt/tracezero
ExecStart=/usr/bin/docker compose -f docker-compose.prod.yml up -d
ExecStop=/usr/bin/docker compose -f docker-compose.prod.yml down
User=root
Group=root

[Install]
WantedBy=multi-user.target
SYSTEMD

systemctl daemon-reload
systemctl enable tracezero-docker
echo -e "${GREEN}  Docker stack will auto-start on reboot${NC}"

# ============================================================
# STEP 10: Print Configuration
# ============================================================
echo ""
echo -e "${GREEN}============================================================${NC}"
echo -e "${GREEN}  SETUP COMPLETE${NC}"
echo -e "${GREEN}============================================================${NC}"
echo ""

# Get public IP
IMDS_TOKEN=$(curl -s --connect-timeout 2 -X PUT "http://169.254.169.254/latest/api/token" -H "X-aws-ec2-metadata-token-ttl-seconds: 60" 2>/dev/null || echo "")
PUBLIC_IP=""
if [ -n "$IMDS_TOKEN" ]; then
  PUBLIC_IP=$(curl -s --connect-timeout 3 -H "X-aws-ec2-metadata-token: $IMDS_TOKEN" http://169.254.169.254/latest/meta-data/public-ipv4 2>/dev/null || echo "")
fi
if [ -z "$PUBLIC_IP" ]; then
  PUBLIC_IP=$(curl -s --connect-timeout 3 https://api.ipify.org 2>/dev/null || echo "")
fi
if [ -z "$PUBLIC_IP" ]; then
  PUBLIC_IP=$(curl -s --connect-timeout 3 https://ifconfig.me 2>/dev/null || echo "<YOUR-EC2-PUBLIC-IP>")
fi

HTTPS_URL=""
if [ -n "$NIP_DOMAIN" ]; then
  HTTPS_URL="https://${NIP_DOMAIN}"
fi

echo -e "${CYAN}  Services:${NC}"
if [ -n "$HTTPS_URL" ]; then
  echo -e "    Relayer (HTTPS): ${HTTPS_URL}"
  echo -e "    Health:          ${HTTPS_URL}/health"
fi
echo -e "    Relayer (HTTP):  http://${PUBLIC_IP}:8080"
echo -e "    Tor Gateway:     http://${PUBLIC_IP}:3080"
echo ""
echo -e "${CYAN}  Security:${NC}"
echo -e "    UFW:        deny all except SSH(22), HTTP(80), HTTPS(443), 8080, 3080"
echo -e "    Fail2Ban:   3 failed SSH = 1hr ban"
echo -e "    SSH:        key-only, root disabled, max 3 attempts"
echo -e "    Kernel:     SYN flood, spoofing, ICMP hardened"
echo -e "    Docker:     icc=false, no-new-privileges"
echo -e "    HTTPS:      auto Let's Encrypt via Caddy + nip.io"
echo -e "    Updates:    automatic security patches"
echo ""
echo -e "${CYAN}  Wallets (fund on devnet):${NC}"
echo -e "    Deposit:  ${DEPOSIT_PUBKEY}"
echo -e "    Treasury: ${TREASURY_PUBKEY}"
echo ""
echo -e "    Fund deposit wallet:"
echo -e "      ${YELLOW}solana airdrop 5 ${DEPOSIT_PUBKEY} --url devnet${NC}"
echo ""
echo -e "${GREEN}============================================================${NC}"
echo -e "${GREEN}  PUT THIS IN YOUR FRONTEND:${NC}"
echo -e "${GREEN}============================================================${NC}"
echo ""
echo -e "  In ${CYAN}app/.env${NC}:"
if [ -n "$HTTPS_URL" ]; then
  echo -e "    ${CYAN}VITE_RELAYER_URL=${HTTPS_URL}${NC}"
else
  echo -e "    ${CYAN}VITE_RELAYER_URL=http://${PUBLIC_IP}:8080${NC}"
  echo -e "    ${YELLOW}(HTTP only — will have mixed content issues on HTTPS frontends)${NC}"
fi
echo ""
echo -e "  Then rebuild and deploy:"
echo -e "    ${YELLOW}cd app && npm run build && npx wrangler deploy${NC}"
echo ""
echo -e "${GREEN}============================================================${NC}"
echo ""
echo -e "${CYAN}  Useful commands:${NC}"
echo -e "    Status:     cd $INSTALL_DIR && sudo docker compose -f docker-compose.prod.yml ps"
echo -e "    Logs:       cd $INSTALL_DIR && sudo docker compose -f docker-compose.prod.yml logs -f relayer"
echo -e "    Stop:       cd $INSTALL_DIR && sudo docker compose -f docker-compose.prod.yml down"
echo -e "    Restart:    cd $INSTALL_DIR && sudo docker compose -f docker-compose.prod.yml restart relayer"
echo -e "    Caddy logs: sudo journalctl -u caddy -f"
echo ""
echo -e "${YELLOW}  Security audit:${NC}"
echo -e "    UFW status:    sudo ufw status verbose"
echo -e "    Fail2Ban:      sudo fail2ban-client status sshd"
echo -e "    Open ports:    sudo ss -tlnp"
echo -e "    Caddy certs:   sudo caddy list-certificates"
echo ""
