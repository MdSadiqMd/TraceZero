# Network Privacy Layer

How `network` (Rust) and `tor-gateway` (Node.js) work together to provide anonymous network access.

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                              YOUR MACHINE                                        │
│                                                                                  │
│  ┌──────────────────┐     ┌──────────────────┐     ┌──────────────────────────┐ │
│  │   Rust Client    │     │  Browser / App   │     │     Any HTTP Client      │ │
│  │   (SDK, CLI)     │     │   (Frontend)     │     │                          │ │
│  └────────┬─────────┘     └────────┬─────────┘     └────────────┬─────────────┘ │
│           │                        │                            │               │
│           │ SOCKS5                 │ HTTP                       │ HTTP          │
│           │                        │                            │               │
│           │                        ▼                            ▼               │
│           │               ┌────────────────────────────────────────┐            │
│           │               │         tor-gateway (Node.js)          │            │
│           │               │         localhost:3080                 │            │
│           │               │                                        │            │
│           │               │  • /proxy?url=X  → Forward via Tor     │            │
│           │               │  • /ip           → Get Tor exit IP     │            │
│           │               │  • /verify-tor   → Check Tor status    │            │
│           │               └───────────────────┬────────────────────┘            │
│           │                                   │                                 │
│           │                                   │ SOCKS5                          │
│           ▼                                   ▼                                 │
│  ┌─────────────────────────────────────────────────────────────────────────┐   │
│  │                    network crate (Rust Library)                          │   │
│  │                                                                          │   │
│  │  ┌─────────────────┐    ┌─────────────────┐    ┌─────────────────────┐  │   │
│  │  │  SocksClient    │    │  TorHttpClient  │    │      Config         │  │   │
│  │  │                 │    │                 │    │                     │  │   │
│  │  │ • Raw TCP       │    │ • GET/POST      │    │ • socks_addr        │  │   │
│  │  │ • connect()     │    │ • JSON support  │    │ • timeout           │  │   │
│  │  │ • send_receive()│    │ • get_exit_ip() │    │ • verify_tls        │  │   │
│  │  └────────┬────────┘    └────────┬────────┘    └─────────────────────┘  │   │
│  │           │                      │                                       │   │
│  │           └──────────┬───────────┘                                       │   │
│  │                      │ SOCKS5                                            │   │
│  └──────────────────────┼───────────────────────────────────────────────────┘   │
│                         ▼                                                       │
│  ┌─────────────────────────────────────────────────────────────────────────┐   │
│  │                         Tor Proxy (Docker)                               │   │
│  │                         localhost:9050                                   │   │
│  │                                                                          │   │
│  │   • Receives SOCKS5 connections                                          │   │
│  │   • Encrypts traffic with AES-128-CTR                                    │   │
│  │   • Routes through 3 relays (Entry → Middle → Exit)                      │   │
│  └──────────────────────────────────────────────────────────────────────────┘   │
│                         │                                                       │
└─────────────────────────┼───────────────────────────────────────────────────────┘
                          │ Encrypted Tor Cells
                          ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│                              TOR NETWORK                                         │
│                                                                                  │
│   ┌─────────┐         ┌─────────┐         ┌─────────┐                           │
│   │  Entry  │ ──────► │ Middle  │ ──────► │  Exit   │                           │
│   │  Node   │         │  Node   │         │  Node   │                           │
│   └─────────┘         └─────────┘         └────┬────┘                           │
│                                                │                                 │
│   Entry knows: Your IP                         │                                 │
│   Middle knows: Nothing useful                 │                                 │
│   Exit knows: Destination (not you)            │                                 │
└────────────────────────────────────────────────┼─────────────────────────────────┘
                                                 │ Decrypted Request
                                                 ▼
                                    ┌────────────────────────┐
                                    │   Destination Server   │
                                    │   (relayer, API, etc)  │
                                    │                        │
                                    │   Sees: Tor Exit IP    │
                                    │   NOT: Your real IP    │
                                    └────────────────────────┘
```

## Components

### 1. network (Rust Crate)

Core library for Tor-routed network requests.

```rust
use network::{Config, TorHttpClient};

// Create client
let client = TorHttpClient::new(Config::default())?;

// All requests go through Tor
let response = client.get("https://api.example.com/data").await?;

// Verify Tor is working
let is_tor = client.verify_tor_connection().await?; // true
```

**Files:**
- `config.rs` - SOCKS5 address, timeouts
- `socks_client.rs` - Raw TCP through Tor
- `http_client.rs` - HTTP with automatic Tor routing
- `error.rs` - Error types

### 2. tor-gateway (Node.js)

HTTP-to-SOCKS5 bridge for browsers (browsers can't speak SOCKS5 directly).

```typescript
// Browser can call:
fetch('http://localhost:3080/proxy?url=https://api.example.com')

// Gateway forwards through Tor SOCKS5 proxy
```

**Endpoints:**
| Endpoint | Description |
|----------|-------------|
| `GET /health` | Check gateway status |
| `GET /ip` | Get current Tor exit IP |
| `GET /verify-tor` | Verify traffic goes through Tor |
| `ALL /proxy?url=X` | Forward any request through Tor |

### 3. Tor Proxy (Docker)

Standard Tor daemon exposing SOCKS5 on port 9050.

## Data Flow

### Rust Client → Tor
```
1. TorHttpClient creates request
2. reqwest uses SOCKS5 proxy (socks5h://127.0.0.1:9050)
3. Tor encrypts and routes through 3 nodes
4. Exit node sends to destination
5. Response returns through same circuit
```

### Browser → tor-gateway → Tor
```
1. Browser sends HTTP to localhost:3080/proxy?url=X
2. tor-gateway receives request
3. tor-gateway uses socks-proxy-agent to connect to Tor
4. Tor encrypts and routes through 3 nodes
5. Response returns to browser
```

## Why Two Components?

| Component | Use Case | Protocol |
|-----------|----------|----------|
| `network` | Rust apps, SDK, CLI, relayer | SOCKS5 (native) |
| `tor-gateway` | Browsers, web apps | HTTP → SOCKS5 |

Browsers cannot use SOCKS5 directly, so `tor-gateway` acts as a bridge.

## Privacy Guarantees

```
What network observers see:

WITHOUT Tor:
  Your IP ──────────────────────────► Destination
  Observer sees: Source, destination, content

WITH Tor:
  Your IP ──► Entry ──► Middle ──► Exit ──► Destination
  Observer sees: Encrypted cells to Entry node only
```

## Running

```bash
# Start Tor + Gateway
docker-compose -f crates/network/docker-compose.yml up -d

# Verify
curl http://localhost:3080/verify-tor
# {"isTor":true,"exitIp":"185.220.100.240",...}

# Use in Rust
cargo run -p your-app  # Uses network crate

# Use in browser
fetch('http://localhost:3080/proxy?url=https://check.torproject.org/api/ip')
```
